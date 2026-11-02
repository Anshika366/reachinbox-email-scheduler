import { Worker, Job } from "bullmq";
import { config } from "../config/index.js";
import { bullmqConnection, checkAndIncrementHourlyRateLimit, acquireSenderSendSlot, getHourlyWindowKey } from "../services/redisService.js";
import { sendEmailViaSmtp } from "../services/emailService.js";
import { updateEmailDocumentStatus } from "../services/elasticsearchService.js";
import { sendRateLimitSlackAlert } from "../services/slackService.js";
import { QUEUE_NAME, emailQueue } from "../queues/emailQueue.js";
import { EmailJobData, EmailRecord } from "../types/index.js";
import { query } from "../db/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function maskRecipientEmail(email: string): string {
  if (!email || typeof email !== "string") return "***";
  const [localPart, domain] = email.split("@");
  if (!domain) return "***";
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
      const data = job.data;

      const currentEmailRes = await query<EmailRecord>(
        "SELECT * FROM emails WHERE id = $1",
        [data.emailId]
      );

      if (currentEmailRes.rows.length === 0) {
        return;
      }

      const email = currentEmailRes.rows[0];
      if (email.status === "sent") {
        return;
      }

      const limit = data.hourlyLimit || config.maxEmailsPerHourPerSender;
      const rateLimitResult = await checkAndIncrementHourlyRateLimit(
        data.senderId,
        limit
      );

      if (!rateLimitResult.allowed) {
        const rescheduleDelayMs = rateLimitResult.retryAfterMs;
        const newScheduledAt = new Date(Date.now() + rescheduleDelayMs);

        await query(
          "UPDATE emails SET scheduled_at = $1, status = 'scheduled', updated_at = NOW() WHERE id = $2",
          [newScheduledAt, data.emailId]
        );

        const { windowKey } = getHourlyWindowKey();
        await sendRateLimitSlackAlert(
          data.userId,
          data.senderId,
          data.senderEmail,
          windowKey,
          limit,
          newScheduledAt
        );

        const newJobId = `email-${data.emailId}-rescheduled-${Date.now()}`;
        await emailQueue.add(
          "send-scheduled-email",
          {
            ...data,
            scheduledAt: newScheduledAt.toISOString()
          },
          {
            jobId: newJobId,
            delay: rescheduleDelayMs
          }
        );

        await query(
          "UPDATE emails SET bullmq_job_id = $1 WHERE id = $2",
          [newJobId, data.emailId]
        );

        return;
      }

      const minDelay = data.minDelayMs || config.minDelayMs;
      const pacingWaitMs = await acquireSenderSendSlot(data.senderId, minDelay);
      if (pacingWaitMs > 0) {
        await sleep(pacingWaitMs);
      }

      const claimResult = await query(
        "UPDATE emails SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'scheduled' RETURNING id",
        [data.emailId]
      );

      if (claimResult.rows.length === 0) {
        return;
      }

      console.log(`[BullMQ Worker] Claimed and processing job ${job.id} for email ${data.emailId}`);

      let sendResult: { messageId: string; previewUrl: string | false } | null = null;
      try {
        sendResult = await sendEmailViaSmtp({
          from: data.senderEmail,
          to: data.recipient,
          subject: data.subject,
          html: data.body
        });

        const previewUrl = sendResult.previewUrl ? sendResult.previewUrl : null;
        const sentAt = new Date();

        await query(
          `UPDATE emails 
           SET status = 'sent', sent_at = $1, smtp_message_id = $2, preview_url = $3, updated_at = NOW() 
           WHERE id = $4`,
          [sentAt, sendResult.messageId, previewUrl, data.emailId]
        );

        await updateEmailDocumentStatus(data.emailId, "sent", sentAt);
        console.log(`[BullMQ Worker] Successfully dispatched email ${data.emailId} to ${maskRecipientEmail(data.recipient)}`);
      } catch (err: any) {
        const errorDetails = err?.message || String(err);
        const retryCount = (email.retry_count || 0) + 1;

        if (sendResult?.messageId) {
          // SMTP accepted the email (messageId exists), but DB update failed.
          // NEVER reset status to 'scheduled' or retry via SMTP, because the email was already delivered!
          // Persist smtp_message_id and mark failed with delivery notice so operator knows it was sent.
          await query(
            `UPDATE emails
             SET status = 'failed', smtp_message_id = $1, retry_count = $2,
                 error_details = 'SMTP relay accepted message (${sendResult.messageId}) but database update encountered error: ${errorDetails}. Automatic resend suppressed to prevent duplicate.',
                 updated_at = NOW()
             WHERE id = $3`,
            [sendResult.messageId, retryCount, data.emailId]
          );
          await updateEmailDocumentStatus(data.emailId, "failed");
          return; // Suppress retry
        }

        if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
          await query(
            `UPDATE emails 
             SET status = 'failed', retry_count = $1, error_details = $2, updated_at = NOW() 
             WHERE id = $3`,
            [retryCount, errorDetails, data.emailId]
          );

          await updateEmailDocumentStatus(data.emailId, "failed");
        } else {
          // Failure occurred BEFORE SMTP acceptance (e.g. connection refused, network timeout).
          // Reset status to 'scheduled' with delayed scheduled_at so BullMQ backoff retry can claim and retry safely
          // without dbDispatcher interfering during the backoff window.
          await query(
            `UPDATE emails 
             SET status = 'scheduled', scheduled_at = NOW() + INTERVAL '30 seconds', retry_count = $1, error_details = $2, updated_at = NOW()
             WHERE id = $3`,
            [retryCount, errorDetails, data.emailId]
          );
        }

        throw err;
      }
    },
    {
      connection: bullmqConnection,
      concurrency: config.workerConcurrency,
      lockDuration: 30000,
      stalledInterval: 30000
    }
  );

  return worker;
}
