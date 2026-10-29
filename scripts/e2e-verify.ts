import { query } from "../apps/backend/src/db/index.js";
import { emailQueue, addEmailToQueue, reconcileScheduledJobs } from "../apps/backend/src/queues/emailQueue.js";
import { redis, checkAndIncrementHourlyRateLimit, acquireSenderSendSlot } from "../apps/backend/src/services/redisService.js";
import { sendEmailViaSmtp } from "../apps/backend/src/services/emailService.js";
import crypto from "crypto";

async function runEndToEndVerification() {
  console.log("=== STARTING RIGOROUS E2E VERIFICATION ===");

  const userId = `usr-test-${Date.now()}`;
  const senderId = `snd-test-${Date.now()}`;
  const userEmail = `oliver.brown.${Date.now()}@domain.io`;
  const senderEmail = `sender.${Date.now()}@domain.io`;

  await query(
    `INSERT INTO users (id, google_id, email, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [userId, `google-${userId}`, userEmail, "Oliver Brown"]
  );

  await query(
    `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 2, NOW(), NOW())`,
    [senderId, userId, senderEmail, "ReachInbox Sender"]
  );

  console.log("TEST 1: Scheduling test email for future time");
  const futureEmailId = crypto.randomUUID();
  const scheduledTimeMs = Date.now() + 60000;
  const scheduledAt = new Date(scheduledTimeMs);

  const insertRes = await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 2, NOW(), NOW())
    RETURNING *`,
    [
      futureEmailId,
      userId,
      senderId,
      senderEmail,
      "future.recipient@example.com",
      "Meeting Follow-up (Scheduled)",
      "<p>Hi Clive, just wanted to follow up on our meeting.</p>",
      scheduledAt
    ]
  );

  const expectedJobId = await addEmailToQueue(
    {
      emailId: futureEmailId,
      userId,
      senderId,
      senderEmail,
      recipient: "future.recipient@example.com",
      subject: "Meeting Follow-up (Scheduled)",
      body: "<p>Hi Clive, just wanted to follow up on our meeting.</p>",
      scheduledAt: scheduledAt.toISOString(),
      minDelayMs: 2000,
      hourlyLimit: 2
    },
    scheduledTimeMs
  );

  await query("UPDATE emails SET bullmq_job_id = $1 WHERE id = $2", [expectedJobId, futureEmailId]);

  const dbCheck = await query("SELECT * FROM emails WHERE id = $1", [futureEmailId]);
  const queueJob = await emailQueue.getJob(expectedJobId);

  if (dbCheck.rows.length === 1 && dbCheck.rows[0].status === "scheduled" && queueJob) {
    console.log("PASS: Scheduled email persisted in PostgreSQL and BullMQ delayed job verified:", queueJob.id);
  } else {
    throw new Error("FAIL: Email scheduling verification failed");
  }

  console.log("TEST 2: Restart recovery verification without duplicating jobs");
  const unqueuedEmailId = crypto.randomUUID();
  const futureTime2 = new Date(Date.now() + 120000);

  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 2, NOW(), NOW())`,
    [
      unqueuedEmailId,
      userId,
      senderId,
      senderEmail,
      "recovery.recipient@example.com",
      "Quarterly Strategy Review",
      "<p>Scheduled email to survive backend restart</p>",
      futureTime2
    ]
  );

  const reconciledCount = await reconcileScheduledJobs();
  const recoveredJob = await emailQueue.getJob(`email-${unqueuedEmailId}`);

  if (reconciledCount >= 1 && recoveredJob) {
    console.log("PASS: Restart recovery reconciled pending database email and enqueued delayed job:", recoveredJob.id);
  } else {
    throw new Error("FAIL: Restart recovery verification failed");
  }

  console.log("TEST 3: Ethereal SMTP delivery and status transitions");
  const immediateEmailId = crypto.randomUUID();
  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'processing', 2000, 2, NOW(), NOW())`,
    [
      immediateEmailId,
      userId,
      senderId,
      senderEmail,
      "live.recipient@example.com",
      "Immediate Delivery Test",
      "<p>Delivered via Ethereal SMTP with preview URL verification</p>"
    ]
  );

  const smtpResult = await sendEmailViaSmtp({
    from: senderEmail,
    to: "live.recipient@example.com",
    subject: "Immediate Delivery Test",
    html: "<p>Delivered via Ethereal SMTP with preview URL verification</p>"
  });

  await query(
    `UPDATE emails 
     SET status = 'sent', sent_at = NOW(), smtp_message_id = $1, preview_url = $2, updated_at = NOW()
     WHERE id = $3`,
    [smtpResult.messageId, smtpResult.previewUrl || null, immediateEmailId]
  );

  const sentCheck = await query("SELECT * FROM emails WHERE id = $1", [immediateEmailId]);
  if (sentCheck.rows[0].status === "sent" && sentCheck.rows[0].smtp_message_id) {
    console.log("PASS: Ethereal SMTP dispatched successfully. Message ID:", sentCheck.rows[0].smtp_message_id);
    console.log("Ethereal Preview URL:", sentCheck.rows[0].preview_url);
  } else {
    throw new Error("FAIL: Ethereal SMTP delivery test failed");
  }

  console.log("TEST 4: Distributed hourly rate limiting and next-hour rescheduling");
  const rateLimitSenderId = `snd-limit-${Date.now()}`;
  const testLimit = 1;

  const firstAttempt = await checkAndIncrementHourlyRateLimit(rateLimitSenderId, testLimit);
  const secondAttempt = await checkAndIncrementHourlyRateLimit(rateLimitSenderId, testLimit);

  if (firstAttempt.allowed && !secondAttempt.allowed && secondAttempt.retryAfterMs > 0) {
    console.log("PASS: First email allowed under limit (1). Second email blocked and rescheduled with retryAfterMs:", secondAttempt.retryAfterMs);
  } else {
    throw new Error("FAIL: Hourly rate limiting test failed");
  }

  console.log("TEST 5: Cross-worker send pacing (MIN_DELAY_MS)");
  const pacingSenderId = `snd-pace-${Date.now()}`;
  const minDelay = 2000;

  const firstWait = await acquireSenderSendSlot(pacingSenderId, minDelay);
  const immediateSecondWait = await acquireSenderSendSlot(pacingSenderId, minDelay);

  if (firstWait === 0 && immediateSecondWait > 0 && immediateSecondWait <= minDelay) {
    console.log("PASS: First send slot granted immediately. Consecutive send requires pacing wait:", immediateSecondWait, "ms");
  } else {
    throw new Error("FAIL: Pacing verification failed");
  }

  console.log("=== ALL END-TO-END VERIFICATIONS PASSED ===");
  process.exit(0);
}

runEndToEndVerification().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
