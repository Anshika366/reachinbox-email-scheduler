import { Worker, Job } from "bullmq";
import { config } from "../config/index.js";
import { redis, checkAndIncrementHourlyRateLimit, acquireSenderSendSlot, getHourlyWindowKey } from "../services/redisService.js";
import { sendEmailViaSmtp } from "../services/emailService.js";
import { updateEmailDocumentStatus } from "../services/elasticsearchService.js";
import { sendRateLimitSlackAlert } from "../services/slackService.js";
import { QUEUE_NAME, emailQueue } from "../queues/emailQueue.js";
import { EmailJobData, EmailRecord } from "../types/index.js";
import { query } from "../db/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

      await query(
        "UPDATE emails SET status = 'processing', updated_at = NOW() WHERE id = $1",
        [data.emailId]
      );

      try {
        const sendResult = await sendEmailViaSmtp({
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
      } catch (err: any) {
        const errorDetails = err?.message || String(err);
        const retryCount = (email.retry_count || 0) + 1;

        if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
          await query(
            `UPDATE emails 
             SET status = 'failed', retry_count = $1, error_details = $2, updated_at = NOW() 
             WHERE id = $3`,
            [retryCount, errorDetails, data.emailId]
          );

          await updateEmailDocumentStatus(data.emailId, "failed");
        } else {
          await query(
            `UPDATE emails 
             SET retry_count = $1, error_details = $2, updated_at = NOW() 
             WHERE id = $3`,
            [retryCount, errorDetails, data.emailId]
          );
        }

        throw err;
      }
    },
    {
      connection: redis as any,
      concurrency: config.workerConcurrency,
      lockDuration: 30000,
      stalledInterval: 30000
    }
  );

  return worker;
}
