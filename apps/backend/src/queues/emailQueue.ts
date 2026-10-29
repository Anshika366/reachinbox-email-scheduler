import { Queue, JobsOptions } from "bullmq";
import { config } from "../config/index.js";
import { redis } from "../services/redisService.js";
import { EmailJobData, EmailRecord } from "../types/index.js";
import { query } from "../db/index.js";

export const QUEUE_NAME = "email-dispatch-queue";

export const emailQueue = new Queue<EmailJobData>(QUEUE_NAME, {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000
    },
    removeOnComplete: false,
    removeOnFail: false
  }
});

export async function addEmailToQueue(
  data: EmailJobData,
  scheduledTimeMs: number
): Promise<string> {
  const now = Date.now();
  const delay = Math.max(0, scheduledTimeMs - now);
  const jobId = `email-${data.emailId}`;

  const jobOptions: JobsOptions = {
    jobId,
    delay
  };

  await emailQueue.add("send-scheduled-email", data, jobOptions);
  return jobId;
}

export async function reconcileScheduledJobs(): Promise<number> {
  const res = await query<EmailRecord>(
    "SELECT * FROM emails WHERE status IN ('scheduled', 'processing')"
  );

  let reconciledCount = 0;

  for (const email of res.rows) {
    // If email was marked 'processing' but already recorded an smtp_message_id,
    // SMTP succeeded before the crash. Finalize status to 'sent' rather than resending.
    if (email.status === "processing" && email.smtp_message_id) {
      await query(
        "UPDATE emails SET status = 'sent', updated_at = NOW() WHERE id = $1",
        [email.id]
      );
      continue;
    }

    const expectedJobId = `email-${email.id}`;
    const existingJob = await emailQueue.getJob(expectedJobId);

    if (!existingJob) {
      const scheduledTime = new Date(email.scheduled_at).getTime();
      const delay = Math.max(0, scheduledTime - Date.now());

      const jobData: EmailJobData = {
        emailId: email.id,
        userId: email.user_id,
        senderId: email.sender_id,
        senderEmail: email.sender_email,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        scheduledAt: email.scheduled_at.toISOString(),
        minDelayMs: email.min_delay_ms,
        hourlyLimit: email.hourly_limit,
        idempotencyKey: email.idempotency_key || undefined
      };

      await emailQueue.add("send-scheduled-email", jobData, {
        jobId: expectedJobId,
        delay
      });

      await query(
        "UPDATE emails SET bullmq_job_id = $1, status = 'scheduled', updated_at = NOW() WHERE id = $2",
        [expectedJobId, email.id]
      );

      reconciledCount++;
    }
  }

  return reconciledCount;
}
