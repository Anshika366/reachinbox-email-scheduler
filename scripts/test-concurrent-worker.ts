import { Worker, Job, Queue } from "bullmq";
import { redis, checkAndIncrementHourlyRateLimit, acquireSenderSendSlot } from "../apps/backend/src/services/redisService.js";
import { query } from "../apps/backend/src/db/index.js";
import { EmailJobData, EmailRecord } from "../apps/backend/src/types/index.js";
import crypto from "crypto";

const TEST_QUEUE = `test-concurrent-${Date.now()}`;

async function runConcurrentWorkerTest() {
  console.log("=== STARTING CONCURRENT WORKER TEST ===");

  const queue = new Queue<EmailJobData>(TEST_QUEUE, {
    connection: redis as any
  });

  const sendTimes: number[] = [];
  const senderId = `concurrent-snd-${Date.now()}`;
  const minDelayMs = 1500;
  const testLimit = 2;

  const worker = new Worker<EmailJobData>(
    TEST_QUEUE,
    async (job: Job<EmailJobData>) => {
      const data = job.data;

      const rateLimitCheck = await checkAndIncrementHourlyRateLimit(data.senderId, data.hourlyLimit);
      if (!rateLimitCheck.allowed) {
        console.log(`Worker detected hourly rate limit hit for job ${job.id}. Rescheduling into next hour window (delay: ${rateLimitCheck.retryAfterMs}ms)`);
        await query(
          "UPDATE emails SET status = 'scheduled', updated_at = NOW() WHERE id = $1",
          [data.emailId]
        );
        return { status: "rescheduled", retryAfterMs: rateLimitCheck.retryAfterMs };
      }

      const wait = await acquireSenderSendSlot(data.senderId, data.minDelayMs);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }

      const timestamp = Date.now();
      sendTimes.push(timestamp);
      console.log(`Worker processed email ${data.emailId} at ${timestamp}`);

      await query(
        "UPDATE emails SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1",
        [data.emailId]
      );

      return { status: "sent", sentAt: timestamp };
    },
    {
      connection: redis as any,
      concurrency: 5
    }
  );

  const userId = `usr-worker-${Date.now()}`;
  await query(
    "INSERT INTO users (id, google_id, email, name, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
    [userId, `gid-${userId}`, `worker.test.${Date.now()}@domain.io`, "Worker Test User"]
  );

  await query(
    "INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
    [senderId, userId, "sender@domain.io", "Sender Test", testLimit]
  );

  const emailIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const emailId = crypto.randomUUID();
    emailIds.push(emailId);
    await query(
      `INSERT INTO emails (
        id, user_id, sender_id, sender_email, recipient, subject, body,
        scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'scheduled', $8, $9, NOW(), NOW())`,
      [
        emailId,
        userId,
        senderId,
        "sender@domain.io",
        `recipient${i}@example.com`,
        `Concurrent Job ${i}`,
        `<p>Concurrent send test ${i}</p>`,
        minDelayMs,
        testLimit
      ]
    );

    await queue.add(
      "test-send",
      {
        emailId,
        userId,
        senderId,
        senderEmail: "sender@domain.io",
        recipient: `recipient${i}@example.com`,
        subject: `Concurrent Job ${i}`,
        body: `<p>Concurrent send test ${i}</p>`,
        scheduledAt: new Date().toISOString(),
        minDelayMs,
        hourlyLimit: testLimit
      },
      { jobId: `job-${emailId}` }
    );
  }

  await new Promise((r) => setTimeout(r, 6000));

  await worker.close();
  await queue.close();

  console.log(`Total sent jobs: ${sendTimes.length}`);
  if (sendTimes.length !== 2) {
    throw new Error(`FAIL: Expected exactly 2 jobs sent under limit 2, got ${sendTimes.length}`);
  }

  const diff = sendTimes[1] - sendTimes[0];
  console.log(`Inter-send delay measured: ${diff}ms (configured minimum: ${minDelayMs}ms)`);
  if (diff < minDelayMs - 100) {
    throw new Error(`FAIL: Send pacing violation. Expected >= ${minDelayMs}ms, got ${diff}ms`);
  }
  console.log("PASS: Inter-send delay enforced across parallel worker slots.");

  const thirdEmail = await query<EmailRecord>("SELECT * FROM emails WHERE id = $1", [emailIds[2]]);
  if (thirdEmail.rows[0].status === "scheduled") {
    console.log("PASS: Third email was rescheduled, NOT dropped or marked failed. Status:", thirdEmail.rows[0].status);
  } else {
    throw new Error(`FAIL: Third email unexpected status: ${thirdEmail.rows[0].status}`);
  }

  console.log("=== CONCURRENT WORKER TEST COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runConcurrentWorkerTest().catch((err) => {
  console.error("CONCURRENT TEST ERROR:", err);
  process.exit(1);
});
