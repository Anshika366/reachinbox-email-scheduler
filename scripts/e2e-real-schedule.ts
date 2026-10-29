import crypto from "crypto";
import { query } from "../apps/backend/src/db/index.js";
import { emailQueue, addEmailToQueue, reconcileScheduledJobs } from "../apps/backend/src/queues/emailQueue.js";
import { scheduleEmailSchema } from "../apps/backend/src/validators/emailValidator.js";
import { sendEmailViaSmtp } from "../apps/backend/src/services/emailService.js";
import { checkAndIncrementHourlyRateLimit, acquireSenderSendSlot } from "../apps/backend/src/services/redisService.js";
import { sendRateLimitSlackAlert } from "../apps/backend/src/services/slackService.js";
import { EmailRecord, Sender, User } from "../apps/backend/src/types/index.js";

async function runRealEmailSchedulingAudit() {
  console.log("=== STARTING REAL EMAIL SCHEDULING & WORKER AUDIT ===");

  const timestamp = Date.now();
  const testUserId = `usr-audit-${timestamp}`;
  const testUserEmail = `audit.user.${timestamp}@reachinbox.test`;
  const testSenderId = `snd-audit-${timestamp}`;
  const testSenderEmail = `audit.sender.${timestamp}@reachinbox.test`;

  await query<User>(
    `INSERT INTO users (id, google_id, email, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [testUserId, `gid-${timestamp}`, testUserEmail, "Audit User"]
  );

  await query<Sender>(
    `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 2, NOW(), NOW())`,
    [testSenderId, testUserId, testSenderEmail, "Audit Sender"]
  );

  console.log("1. Testing Validation Boundaries (Invalid Recipient, Missing Fields, Past Date)");
  const invalidEmailResult = scheduleEmailSchema.safeParse({
    senderId: testSenderId,
    recipients: ["invalid-recipient-format"],
    subject: "Test",
    body: "Body",
    scheduledAt: new Date(Date.now() + 60000).toISOString()
  });
  console.log("   - Invalid email rejected:", !invalidEmailResult.success);

  const missingFieldsResult = scheduleEmailSchema.safeParse({
    senderId: testSenderId,
    recipients: [],
    subject: "",
    body: "",
    scheduledAt: new Date(Date.now() + 60000).toISOString()
  });
  console.log("   - Missing fields rejected:", !missingFieldsResult.success);

  const pastDateResult = scheduleEmailSchema.safeParse({
    senderId: testSenderId,
    recipients: ["valid@example.com"],
    subject: "Past Test",
    body: "Past Body",
    scheduledAt: new Date(Date.now() - 3600000).toISOString()
  });
  console.log("   - Past date rejected:", !pastDateResult.success);

  console.log("2. Testing Real Email Scheduling, BullMQ Delayed Job & Ethereal SMTP Dispatch");
  const testEmailId = crypto.randomUUID();
  const scheduledTimeMs = Date.now() + 2000;
  const scheduledAtDate = new Date(scheduledTimeMs);

  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 50, NOW(), NOW())`,
    [
      testEmailId,
      testUserId,
      testSenderId,
      testSenderEmail,
      "test.recipient@ethereal.email",
      `ReachInbox Scheduling Test [${timestamp}]`,
      `<p>This is a real ReachInbox scheduled email dispatch test executed at ${new Date().toISOString()}</p>`,
      scheduledAtDate
    ]
  );

  const jobId = await addEmailToQueue(
    {
      emailId: testEmailId,
      userId: testUserId,
      senderId: testSenderId,
      senderEmail: testSenderEmail,
      recipient: "test.recipient@ethereal.email",
      subject: `ReachInbox Scheduling Test [${timestamp}]`,
      body: `<p>This is a real ReachInbox scheduled email dispatch test executed at ${new Date().toISOString()}</p>`,
      scheduledAt: scheduledAtDate.toISOString(),
      minDelayMs: 2000,
      hourlyLimit: 50
    },
    scheduledTimeMs
  );
  await query("UPDATE emails SET bullmq_job_id = $1 WHERE id = $2", [jobId, testEmailId]);
  console.log(`   - Scheduled email persisted in PostgreSQL: ${testEmailId}`);
  console.log(`   - BullMQ delayed job registered: ${jobId}`);

  console.log("3. Waiting for BullMQ worker to process scheduled email...");
  let finalEmail: EmailRecord | null = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 15000) {
    const res = await query<EmailRecord>("SELECT * FROM emails WHERE id = $1", [testEmailId]);
    if (res.rows[0]?.status === "sent") {
      finalEmail = res.rows[0];
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (finalEmail) {
    console.log("   - Scheduled email successfully SENT at scheduled time!");
    console.log(`   - SMTP Message ID: ${finalEmail.smtp_message_id}`);
    console.log(`   - Ethereal Preview URL: ${finalEmail.preview_url}`);
    console.log(`   - Sent timestamp: ${finalEmail.sent_at}`);
  } else {
    const check = await query<EmailRecord>("SELECT * FROM emails WHERE id = $1", [testEmailId]);
    console.error("   - Failed to observe 'sent' status within timeout. Current status:", check.rows[0]?.status);
  }

  console.log("4. Testing Pending Job Recovery Across Server Restarts (Reconciliation)");
  const unqueuedEmailId = crypto.randomUUID();
  const unqueuedScheduledTime = new Date(Date.now() + 30000);
  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 50, NOW(), NOW())`,
    [
      unqueuedEmailId,
      testUserId,
      testSenderId,
      testSenderEmail,
      "recovery.test@ethereal.email",
      "Restart Recovery Test",
      "<p>Testing recovery</p>",
      unqueuedScheduledTime
    ]
  );
  const recoveredCount = await reconcileScheduledJobs();
  const recoveredRecord = await query<EmailRecord>("SELECT bullmq_job_id FROM emails WHERE id = $1", [unqueuedEmailId]);
  console.log(`   - Reconciled jobs count: ${recoveredCount}`);
  console.log(`   - Recovered email now has BullMQ job ID: ${recoveredRecord.rows[0]?.bullmq_job_id}`);

  console.log("5. Testing Concurrency Pacing (Minimum Delay Reservation)");
  const slot1 = await acquireSenderSendSlot(testSenderId, 2000);
  const slot2 = await acquireSenderSendSlot(testSenderId, 2000);
  const slot3 = await acquireSenderSendSlot(testSenderId, 2000);
  console.log(`   - Slot 1: ${slot1}, Slot 2: ${slot2}, Slot 3: ${slot3}`);
  console.log(`   - Slot 2 - Slot 1 diff ms: ${slot2 - slot1} (>= 2000: ${slot2 - slot1 >= 2000})`);
  console.log(`   - Slot 3 - Slot 2 diff ms: ${slot3 - slot2} (>= 2000: ${slot3 - slot2 >= 2000})`);

  console.log("6. Testing Per-Sender Hourly Rate Limiting & Slack Alert Trigger");
  const limitSenderId = `snd-limit-${timestamp}`;
  const rateLimitAllowed1 = await checkAndIncrementHourlyRateLimit(limitSenderId, 1);
  const rateLimitAllowed2 = await checkAndIncrementHourlyRateLimit(limitSenderId, 1);
  console.log(`   - Request 1 allowed (limit=1): ${rateLimitAllowed1.allowed} (count: ${rateLimitAllowed1.currentCount})`);
  console.log(`   - Request 2 allowed (limit=1): ${rateLimitAllowed2.allowed} (count: ${rateLimitAllowed2.currentCount})`);

  const alertSent = await sendRateLimitSlackAlert(
    testUserId,
    limitSenderId,
    testSenderEmail,
    rateLimitAllowed2.windowKey,
    1,
    new Date(Date.now() + rateLimitAllowed2.msRemaining)
  );
  console.log(`   - Rate limit Slack alert trigger evaluated (alertSent: ${alertSent})`);

  console.log("7. Cleaning up test data...");
  await query("DELETE FROM emails WHERE user_id = $1", [testUserId]);
  await query("DELETE FROM senders WHERE user_id = $1", [testUserId]);
  await query("DELETE FROM users WHERE id = $1", [testUserId]);
  await emailQueue.close();

  console.log("=== REAL EMAIL SCHEDULING & WORKER AUDIT COMPLETE ===");
  process.exit(0);
}

runRealEmailSchedulingAudit().catch((err) => {
  console.error("Audit failure:", err);
  process.exit(1);
});
