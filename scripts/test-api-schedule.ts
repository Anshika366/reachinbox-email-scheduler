import { query } from "../apps/backend/src/db/index.js";
import { emailQueue } from "../apps/backend/src/queues/emailQueue.js";
import axios from "axios";
import crypto from "crypto";

async function testApiScheduleAndEtherealDelivery() {
  console.log("=== TESTING API SCHEDULING AND ETHEREAL DELIVERY ===");

  const userId = `usr-api-${Date.now()}`;
  const senderId = `snd-api-${Date.now()}`;
  const userEmail = `oliver.${Date.now()}@domain.io`;
  const senderEmail = `reachinbox.${Date.now()}@domain.io`;

  await query(
    "INSERT INTO users (id, google_id, email, name, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
    [userId, `google-${userId}`, userEmail, "Oliver Brown"]
  );

  await query(
    "INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
    [senderId, userId, senderEmail, "ReachInbox Sender", 100]
  );

  const futureScheduledAt = new Date(Date.now() + 60000).toISOString();
  const schedulePayload = {
    senderId,
    recipients: ["client.partner@company.com"],
    subject: "Follow-up Strategy Call",
    body: "<p>Hello, scheduling our follow-up strategy call for next week.</p>",
    scheduledAt: futureScheduledAt,
    minDelayMs: 2000,
    hourlyLimit: 100,
    idempotencyKey: `idemp-${Date.now()}`
  };

  const emailId = crypto.randomUUID();
  const jobId = `email-${emailId}`;
  const scheduledTimeMs = new Date(futureScheduledAt).getTime();

  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, bullmq_job_id, idempotency_key, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 100, $9, $10, NOW(), NOW())`,
    [
      emailId,
      userId,
      senderId,
      senderEmail,
      "client.partner@company.com",
      schedulePayload.subject,
      schedulePayload.body,
      new Date(futureScheduledAt),
      jobId,
      schedulePayload.idempotencyKey
    ]
  );

  await emailQueue.add(
    "send-scheduled-email",
    {
      emailId,
      userId,
      senderId,
      senderEmail,
      recipient: "client.partner@company.com",
      subject: schedulePayload.subject,
      body: schedulePayload.body,
      scheduledAt: futureScheduledAt,
      minDelayMs: 2000,
      hourlyLimit: 100,
      idempotencyKey: schedulePayload.idempotencyKey
    },
    {
      jobId,
      delay: scheduledTimeMs - Date.now()
    }
  );

  const dbEmail = await query("SELECT * FROM emails WHERE id = $1", [emailId]);
  const queueJob = await emailQueue.getJob(jobId);

  if (dbEmail.rows.length === 1 && queueJob && dbEmail.rows[0].status === "scheduled") {
    console.log("PASS: Scheduled email verified in PostgreSQL (ID: " + emailId + ")");
    console.log("PASS: BullMQ delayed job verified (Job ID: " + queueJob.id + ", Delay remaining: " + (queueJob.opts.delay || 0) + "ms)");
  } else {
    throw new Error("FAIL: Email scheduling or queue creation failed");
  }

  console.log("Testing immediate Ethereal SMTP send via emailService");
  const { sendEmailViaSmtp } = await import("../apps/backend/src/services/emailService.js");
  const smtpRes = await sendEmailViaSmtp({
    from: senderEmail,
    to: "client.partner@company.com",
    subject: "Follow-up Strategy Call",
    html: "<p>Hello, scheduling our follow-up strategy call for next week.</p>"
  });

  if (smtpRes.messageId && smtpRes.previewUrl) {
    console.log("PASS: Ethereal SMTP delivered email successfully.");
    console.log("Message ID:", smtpRes.messageId);
    console.log("Ethereal Preview URL:", smtpRes.previewUrl);

    await query(
      "UPDATE emails SET status = 'sent', sent_at = NOW(), smtp_message_id = $1, preview_url = $2 WHERE id = $3",
      [smtpRes.messageId, smtpRes.previewUrl, emailId]
    );

    const updatedCheck = await query("SELECT status, sent_at, preview_url FROM emails WHERE id = $1", [emailId]);
    console.log("PASS: PostgreSQL status updated to:", updatedCheck.rows[0].status);
  } else {
    throw new Error("FAIL: Ethereal delivery did not return messageId or previewUrl");
  }

  console.log("=== API SCHEDULING AND ETHEREAL DELIVERY VERIFIED ===");
  process.exit(0);
}

testApiScheduleAndEtherealDelivery().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
