import { query } from "../apps/backend/src/db/index.js";
import { emailQueue, reconcileScheduledJobs } from "../apps/backend/src/queues/emailQueue.js";
import crypto from "crypto";

async function verifyStopAndRestartRecovery() {
  console.log("=== STARTING REAL BACKEND STOP-AND-RESTART RECOVERY TEST ===");

  const userId = `usr-restart-${Date.now()}`;
  const senderId = `snd-restart-${Date.now()}`;
  const userEmail = `user.${Date.now()}@domain.io`;
  const senderEmail = `sender.${Date.now()}@domain.io`;

  await query(
    "INSERT INTO users (id, google_id, email, name, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
    [userId, `google-${userId}`, userEmail, "Restart Tester"]
  );

  await query(
    "INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at) VALUES ($1, $2, $3, $4, 100, NOW(), NOW())",
    [senderId, userId, senderEmail, "Restart Sender"]
  );

  const futureMs = 8000;
  const targetTime = new Date(Date.now() + futureMs);
  const emailId = crypto.randomUUID();
  const expectedJobId = `email-${emailId}`;

  await query(
    `INSERT INTO emails (
      id, user_id, sender_id, sender_email, recipient, subject, body,
      scheduled_at, status, min_delay_ms, hourly_limit, bullmq_job_id, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 100, $9, NOW(), NOW())`,
    [
      emailId,
      userId,
      senderId,
      senderEmail,
      "future.client@partner.io",
      "Restart Resilience Email",
      "<p>This email was pending when backend was stopped</p>",
      targetTime,
      expectedJobId
    ]
  );

  console.log(`Created email ${emailId} scheduled for ${targetTime.toISOString()}`);
  console.log("Simulating server restart: running reconcileScheduledJobs()...");

  const count = await reconcileScheduledJobs();
  console.log(`Reconciled count: ${count}`);

  const job = await emailQueue.getJob(expectedJobId);
  if (!job) {
    throw new Error("FAIL: Reconciled job not found in queue");
  }
  console.log(`PASS: BullMQ delayed job verified after reconciliation: ${job.id}, Delay: ${job.opts.delay}ms`);

  console.log("Verifying no duplicate jobs exist for email ID...");
  const secondReconcile = await reconcileScheduledJobs();
  if (secondReconcile !== 0) {
    throw new Error(`FAIL: Second reconciliation created duplicate jobs! Count: ${secondReconcile}`);
  }
  console.log("PASS: Re-reconciliation is strictly idempotent. 0 duplicate jobs created.");

  console.log("=== BACKEND STOP-AND-RESTART TEST PASSED ===");
  process.exit(0);
}

verifyStopAndRestartRecovery().catch((err) => {
  console.error("RESTART TEST ERROR:", err);
  process.exit(1);
});
