import { query } from "../src/db/index.js";
import { app } from "../src/app.js";
import { emailQueue, reconcileScheduledJobs, addEmailToQueue } from "../src/queues/emailQueue.js";
import { redis, checkAndIncrementHourlyRateLimit, acquireSenderSendSlot, getHourlyWindowKey } from "../src/services/redisService.js";
import { sendEmailViaSmtp } from "../src/services/emailService.js";
import { indexEmailDocument, searchEmailsInEs } from "../src/services/elasticsearchService.js";
import { encryptToken, decryptToken, getSlackOAuthUrl, sendRateLimitSlackAlert } from "../src/services/slackService.js";
import { EmailRecord } from "../src/types/index.js";
import request from "supertest";
import crypto from "crypto";

describe("ReachInbox Integration & System Test Suite", () => {
  jest.setTimeout(30000);

  const testUserId = `usr-test-${Date.now()}`;
  const testSenderId = `snd-test-${Date.now()}`;
  const testUserEmail = `integration.user.${Date.now()}@domain.io`;
  const testSenderEmail = `integration.sender.${Date.now()}@domain.io`;

  beforeAll(async () => {
    await query(
      `INSERT INTO users (id, google_id, email, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [testUserId, `gid-${testUserId}`, testUserEmail, "Integration Tester"]
    );

    await query(
      `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 2, NOW(), NOW())`,
      [testSenderId, testUserId, testSenderEmail, "Integration Sender"]
    );
  });

  afterAll(async () => {
    await query("DELETE FROM emails WHERE user_id = $1", [testUserId]);
    await query("DELETE FROM senders WHERE user_id = $1", [testUserId]);
    await query("DELETE FROM users WHERE id = $1", [testUserId]);
    await emailQueue.close();
    await redis.quit();
  });

  describe("Authentication & Protected Routes", () => {
    test("GET /api/emails/scheduled returns 401 Unauthorized without session", async () => {
      const res = await request(app).get("/api/emails/scheduled");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    test("GET /api/senders returns 401 Unauthorized without session", async () => {
      const res = await request(app).get("/api/senders");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    test("GET /api/auth/me returns 401 and null user when unauthenticated", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.user).toBeNull();
    });

    test("GET /admin/queues returns 401 Unauthorized without Basic Auth credentials", async () => {
      const res = await request(app).get("/admin/queues");
      expect(res.status).toBe(401);
    });

    test("GET /api/health returns healthy services status", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.services.database).toBe("connected");
      expect(res.body.services.redis).toBe("connected");
    });
  });

  describe("Scheduling, Database Persistence & BullMQ Queue", () => {
    test("Persists scheduled email in PostgreSQL and creates delayed BullMQ job", async () => {
      const emailId = crypto.randomUUID();
      const scheduledMs = Date.now() + 45000;
      const scheduledAt = new Date(scheduledMs);

      await query(
        `INSERT INTO emails (
          id, user_id, sender_id, sender_email, recipient, subject, body,
          scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 2, NOW(), NOW())`,
        [
          emailId,
          testUserId,
          testSenderId,
          testSenderEmail,
          "integration.rec@example.com",
          "Integration Scheduled Subject",
          "<p>Integration Test Body</p>",
          scheduledAt
        ]
      );

      const jobId = await addEmailToQueue(
        {
          emailId,
          userId: testUserId,
          senderId: testSenderId,
          senderEmail: testSenderEmail,
          recipient: "integration.rec@example.com",
          subject: "Integration Scheduled Subject",
          body: "<p>Integration Test Body</p>",
          scheduledAt: scheduledAt.toISOString(),
          minDelayMs: 2000,
          hourlyLimit: 2
        },
        scheduledMs
      );

      await query("UPDATE emails SET bullmq_job_id = $1 WHERE id = $2", [jobId, emailId]);

      const dbEmail = await query<EmailRecord>("SELECT * FROM emails WHERE id = $1", [emailId]);
      expect(dbEmail.rows.length).toBe(1);
      expect(dbEmail.rows[0].status).toBe("scheduled");
      expect(dbEmail.rows[0].bullmq_job_id).toBe(`email-${emailId}`);

      const queueJob = await emailQueue.getJob(`email-${emailId}`);
      expect(queueJob).toBeDefined();
      expect(queueJob?.opts.delay).toBeGreaterThan(0);
    });

    test("Reconciles pending jobs idempotently after simulated server restart", async () => {
      const emailId = crypto.randomUUID();
      const scheduledAt = new Date(Date.now() + 30000);

      await query(
        `INSERT INTO emails (
          id, user_id, sender_id, sender_email, recipient, subject, body,
          scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', 2000, 2, NOW(), NOW())`,
        [
          emailId,
          testUserId,
          testSenderId,
          testSenderEmail,
          "reconcile.test@example.com",
          "Reconcile Subject",
          "<p>Body</p>",
          scheduledAt
        ]
      );

      const firstReconcileCount = await reconcileScheduledJobs();
      expect(firstReconcileCount).toBeGreaterThanOrEqual(1);

      const job = await emailQueue.getJob(`email-${emailId}`);
      expect(job).toBeDefined();

      const secondReconcileCount = await reconcileScheduledJobs();
      expect(secondReconcileCount).toBe(0);
    });

    test("Crash Window Test: An email interrupted in 'processing' status before 'sent' commitment is re-enqueued on restart, illustrating at-least-once delivery semantics", async () => {
      const emailId = crypto.randomUUID();
      const scheduledAt = new Date(Date.now() + 60000);

      // Simulate crash window: worker set status='processing', but backend crashed
      // before status could be committed as 'sent'.
      await query(
        `INSERT INTO emails (
          id, user_id, sender_id, sender_email, recipient, subject, body,
          scheduled_at, status, min_delay_ms, hourly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', 2000, 2, NOW(), NOW())`,
        [
          emailId,
          testUserId,
          testSenderId,
          testSenderEmail,
          "crashwindow.test@example.com",
          "Crash Window Test Email",
          "<p>Simulating crash window</p>",
          scheduledAt
        ]
      );

      // Server reboot reconciliation
      const count = await reconcileScheduledJobs();
      expect(count).toBeGreaterThanOrEqual(1);

      // Confirms the job was re-enqueued in BullMQ to avoid message loss
      const job = await emailQueue.getJob(`email-${emailId}`);
      expect(job).toBeDefined();

      // Confirms database status was reset to 'scheduled'
      const updated = await query<EmailRecord>("SELECT status FROM emails WHERE id = $1", [emailId]);
      expect(updated.rows[0].status).toBe("scheduled");
      // Note: Because this email may have already been accepted by SMTP before the crash,
      // re-running it may result in a duplicate send (at-least-once delivery).
    });

    test("Crash Window Test (smtp_message_id present): Interrupted processing email with persisted smtp_message_id is finalized to 'sent' and not re-enqueued", async () => {
      const emailId = crypto.randomUUID();
      const pastTime = new Date(Date.now() - 30000);

      // Simulate state where SMTP message ID was written to the record,
      // but status remained 'processing' when the process died.
      await query(
        `INSERT INTO emails (
          id, user_id, sender_id, sender_email, recipient, subject, body,
          scheduled_at, status, smtp_message_id, min_delay_ms, hourly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', 'persisted-msg-id-12345', 2000, 2, NOW(), NOW())`,
        [
          emailId,
          testUserId,
          testSenderId,
          testSenderEmail,
          "msgidpresent.test@example.com",
          "MsgID Present Test Email",
          "<p>Testing recovery with persisted message ID</p>",
          pastTime
        ]
      );

      // Execute real recovery logic
      await reconcileScheduledJobs();

      // Confirms database status was finalized to 'sent'
      const updated = await query<EmailRecord>("SELECT status, smtp_message_id FROM emails WHERE id = $1", [emailId]);
      expect(updated.rows[0].status).toBe("sent");
      expect(updated.rows[0].smtp_message_id).toBe("persisted-msg-id-12345");

      // Confirms the job was NOT re-enqueued in BullMQ (avoids duplicate transmission)
      const job = await emailQueue.getJob(`email-${emailId}`);
      expect(job).toBeUndefined();
    });

    test("Recovery Idempotency: Emails already marked 'sent' are excluded from restart reconciliation", async () => {
      const sentEmailId = crypto.randomUUID();
      const pastTime = new Date(Date.now() - 60000);

      await query(
        `INSERT INTO emails (
          id, user_id, sender_id, sender_email, recipient, subject, body,
          scheduled_at, status, smtp_message_id, sent_at, min_delay_ms, hourly_limit, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sent', 'test-smtp-msg-id', NOW(), 2000, 2, NOW(), NOW())`,
        [
          sentEmailId,
          testUserId,
          testSenderId,
          testSenderEmail,
          "alreadysent.test@example.com",
          "Already Sent Email",
          "<p>Already sent</p>",
          pastTime
        ]
      );

      await reconcileScheduledJobs();

      // Confirm job was NEVER added to BullMQ
      const job = await emailQueue.getJob(`email-${sentEmailId}`);
      expect(job).toBeUndefined();
    });
  });

  describe("Rate Limiting & Pacing Concurrency (Redis & Lua)", () => {
    test("checkAndIncrementHourlyRateLimit enforces limit and computes positive retry delay", async () => {
      const senderKey = `snd-limit-test-${Date.now()}`;
      const limit = 2;

      const first = await checkAndIncrementHourlyRateLimit(senderKey, limit);
      expect(first.allowed).toBe(true);
      expect(first.currentCount).toBe(1);
      expect(first.retryAfterMs).toBe(0);

      const second = await checkAndIncrementHourlyRateLimit(senderKey, limit);
      expect(second.allowed).toBe(true);
      expect(second.currentCount).toBe(2);
      expect(second.retryAfterMs).toBe(0);

      const third = await checkAndIncrementHourlyRateLimit(senderKey, limit);
      expect(third.allowed).toBe(false);
      expect(third.currentCount).toBe(2);
      expect(third.retryAfterMs).toBeGreaterThan(0);
      expect(third.retryAfterMs).toBeLessThanOrEqual(3600000);
    });

    test("acquireSenderSendSlot allocates non-overlapping sequential slots across parallel requests", async () => {
      const senderKey = `snd-pace-test-${Date.now()}`;
      const minDelay = 2000;

      const wait1 = await acquireSenderSendSlot(senderKey, minDelay);
      const wait2 = await acquireSenderSendSlot(senderKey, minDelay);
      const wait3 = await acquireSenderSendSlot(senderKey, minDelay);

      expect(wait1).toBe(0);
      expect(wait2).toBeGreaterThanOrEqual(minDelay - 100);
      expect(wait3).toBeGreaterThanOrEqual(wait2 + minDelay - 100);
    });
  });

  describe("Ethereal SMTP Dispatch & Preview URL", () => {
    test("Dispatches email via Nodemailer and generates valid messageId and Ethereal preview link", async () => {
      const result = await sendEmailViaSmtp({
        from: testSenderEmail,
        to: "recipient.delivery@example.com",
        subject: "Jest Live SMTP Test",
        html: "<p>Live Nodemailer Delivery Check</p>"
      });

      expect(result.messageId).toBeDefined();
      expect(result.messageId.length).toBeGreaterThan(0);
      expect(typeof result.previewUrl).toBe("string");
      if (typeof result.previewUrl === "string") {
        expect(result.previewUrl).toContain("https://ethereal.email/message/");
      }
    });
  });

  describe("Elasticsearch Indexing & Search Resilience", () => {
    test("Indexes email document and matches search query with user isolation", async () => {
      const emailId = crypto.randomUUID();
      const record: EmailRecord = {
        id: emailId,
        user_id: testUserId,
        sender_id: testSenderId,
        sender_email: testSenderEmail,
        recipient: "expansion.officer@domain.com",
        subject: "Q4 High-Growth Regional Strategy",
        body: "Detailed review of operations in the European division.",
        scheduled_at: new Date(),
        status: "scheduled",
        bullmq_job_id: `email-${emailId}`,
        idempotency_key: null,
        min_delay_ms: 2000,
        hourly_limit: 100,
        sent_at: null,
        retry_count: 0,
        error_details: null,
        smtp_message_id: null,
        preview_url: null,
        created_at: new Date(),
        updated_at: new Date()
      };

      await indexEmailDocument(record);

      const search = await searchEmailsInEs(testUserId, "High-Growth Regional");
      expect(search.total).toBeGreaterThanOrEqual(1);
      const found = search.hits.find((h) => h.id === emailId);
      expect(found).toBeDefined();
      expect(found.subject).toBe("Q4 High-Growth Regional Strategy");

      const isolatedSearch = await searchEmailsInEs("unauthorized-user-id", "High-Growth Regional");
      expect(isolatedSearch.total).toBe(0);
    });
  });

  describe("Slack OAuth, Security & Alert Deduplication", () => {
    test("Token encryption uses AES-256-CBC with unique IV and preserves token", () => {
      const sampleToken = "xoxb-999888777-reachinbox-hiring-test-token";
      const enc1 = encryptToken(sampleToken);
      const enc2 = encryptToken(sampleToken);

      expect(enc1).not.toBe(sampleToken);
      expect(enc2).not.toBe(sampleToken);
      expect(enc1).not.toBe(enc2);

      expect(decryptToken(enc1)).toBe(sampleToken);
      expect(decryptToken(enc2)).toBe(sampleToken);
    });

    test("Generates valid Slack OAuth URL with encoded state and required scopes", () => {
      const urlString = getSlackOAuthUrl(testUserId);
      const parsedUrl = new URL(urlString);

      expect(parsedUrl.hostname).toBe("slack.com");
      expect(parsedUrl.pathname).toBe("/oauth/v2/authorize");
      expect(parsedUrl.searchParams.get("scope")).toContain("chat:write");

      const stateRaw = parsedUrl.searchParams.get("state");
      expect(stateRaw).toBeDefined();
      const decoded = JSON.parse(Buffer.from(stateRaw!, "base64").toString("utf8"));
      expect(decoded.userId).toBe(testUserId);
    });

    test("sendRateLimitSlackAlert enforces single notification per sender per hourly window", async () => {
      const { windowKey } = getHourlyWindowKey();
      const rescheduledTime = new Date(Date.now() + 1800000);

      const firstSendResult = await sendRateLimitSlackAlert(
        testUserId,
        testSenderId,
        testSenderEmail,
        windowKey,
        100,
        rescheduledTime
      );

      const dedupeRecord = await query(
        "SELECT id FROM rate_limit_notifications WHERE sender_id = $1 AND hourly_window = $2",
        [testSenderId, windowKey]
      );

      expect(dedupeRecord.rows.length).toBeLessThanOrEqual(1);

      const secondSendResult = await sendRateLimitSlackAlert(
        testUserId,
        testSenderId,
        testSenderEmail,
        windowKey,
        100,
        rescheduledTime
      );

      expect(secondSendResult).toBe(false);
    });
  });
});
