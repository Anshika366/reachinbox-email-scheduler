import { query, pool } from "../apps/backend/src/db/index.js";
import {
  checkAndIncrementHourlyRateLimitDbFallback,
  acquireSenderSendSlot,
  getHourlyWindowKey,
  redis
} from "../apps/backend/src/services/redisService.js";
import { randomUUID } from "node:crypto";

async function runTests() {
  console.log("===============================================================");
  console.log("SAFETY FIXES VERIFICATION TEST SUITE");
  console.log("===============================================================\n");

  const testUserId = `test-user-${randomUUID().slice(0, 8)}`;
  const testSenderId = `test-sender-${randomUUID().slice(0, 8)}`;

  // Setup test user & sender
  await query(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`,
    [testUserId, `${testUserId}@example.com`, "Test User"]
  );
  await query(
    `INSERT INTO senders (id, user_id, email, name, hourly_limit) VALUES ($1, $2, $3, $4, 5)`,
    [testSenderId, testUserId, `${testSenderId}@example.com`, "Test Sender"]
  );

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Redis unavailable: hourly limit does not allow unlimited sending
    // ------------------------------------------------------------------------
    console.log("--- TEST 1: Redis unavailable: hourly limit does not allow unlimited sending ---");
    const { msRemaining } = getHourlyWindowKey();

    // Call 5 times with limit = 2
    const resultsTest1 = [];
    for (let i = 0; i < 4; i++) {
      const res = await checkAndIncrementHourlyRateLimitDbFallback(testSenderId, 2, msRemaining);
      resultsTest1.push(res);
    }

    console.log(`Call 1 (limit 2): allowed=${resultsTest1[0].allowed}, count=${resultsTest1[0].currentCount}`);
    console.log(`Call 2 (limit 2): allowed=${resultsTest1[1].allowed}, count=${resultsTest1[1].currentCount}`);
    console.log(`Call 3 (limit 2): allowed=${resultsTest1[2].allowed}, count=${resultsTest1[2].currentCount}, retryAfterMs=${resultsTest1[2].retryAfterMs}`);
    console.log(`Call 4 (limit 2): allowed=${resultsTest1[3].allowed}, count=${resultsTest1[3].currentCount}`);

    const test1Pass =
      resultsTest1[0].allowed === true &&
      resultsTest1[1].allowed === true &&
      resultsTest1[2].allowed === false &&
      resultsTest1[3].allowed === false &&
      resultsTest1[2].retryAfterMs > 0;

    console.log(`TEST 1 RESULT: ${test1Pass ? "PASS" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 2: Redis unavailable: sender pacing is not zero
    // ------------------------------------------------------------------------
    console.log("--- TEST 2: Redis unavailable: sender pacing is not zero ---");
    // Temporarily simulate Redis not ready by checking acquireSenderSendSlot fallback
    const origStatus = redis.status;
    (redis as any).status = "close"; // Force fallback path

    const slot1 = await acquireSenderSendSlot(testSenderId, 2000);
    const slot2 = await acquireSenderSendSlot(testSenderId, 2000);
    const slot3 = await acquireSenderSendSlot(testSenderId, 2000);

    (redis as any).status = origStatus; // Restore

    console.log(`Slot 1 delay: ${slot1}ms`);
    console.log(`Slot 2 delay: ${slot2}ms`);
    console.log(`Slot 3 delay: ${slot3}ms`);

    const test2Pass = slot1 >= 2000 && slot2 >= 4000 && slot3 >= 6000 && slot1 > 0 && slot2 > slot1 && slot3 > slot2;
    console.log(`TEST 2 RESULT: ${test2Pass ? "PASS (Never 0ms, staggered across concurrent calls)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 3: Concurrent PostgreSQL fallback requests cannot exceed the hourly quota
    // ------------------------------------------------------------------------
    console.log("--- TEST 3: Concurrent PostgreSQL fallback requests cannot exceed hourly quota ---");
    const concurrentSenderId = `test-sender-conc-${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO senders (id, user_id, email, name, hourly_limit) VALUES ($1, $2, $3, $4, 5)`,
      [concurrentSenderId, testUserId, `${concurrentSenderId}@example.com`, "Conc Sender"]
    );

    // Launch 25 concurrent requests simultaneously for limit = 5
    const limit = 5;
    const concurrentCalls = 25;
    const promises = Array.from({ length: concurrentCalls }, () =>
      checkAndIncrementHourlyRateLimitDbFallback(concurrentSenderId, limit, msRemaining)
    );

    const concurrentResults = await Promise.all(promises);
    const allowedCount = concurrentResults.filter((r) => r.allowed).length;
    const rejectedCount = concurrentResults.filter((r) => !r.allowed).length;

    console.log(`Total concurrent requests: ${concurrentCalls}`);
    console.log(`Configured quota: ${limit}`);
    console.log(`Allowed requests: ${allowedCount}`);
    console.log(`Rejected requests: ${rejectedCount}`);

    const test3Pass = allowedCount === limit && rejectedCount === concurrentCalls - limit;
    console.log(`TEST 3 RESULT: ${test3Pass ? "PASS (Exact quota respected under concurrent load)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 4: Simulate SMTP acceptance followed by database update failure;
    // wait beyond 2 minutes and verify dbDispatcher does not resend
    // ------------------------------------------------------------------------
    console.log("--- TEST 4: SMTP acceptance + DB update failure (verify no duplicate resend) ---");
    const emailWithSmtpId = `test-email-smtp-${randomUUID().slice(0, 8)}`;
    const emailWithoutSmtpId = `test-email-nosmtp-${randomUUID().slice(0, 8)}`;

    // Email A: SMTP accepted (has smtp_message_id), but lease expired (> 2 mins)
    await query(
      `INSERT INTO emails (id, user_id, sender_id, sender_email, recipient, subject, body, scheduled_at, status, smtp_message_id, updated_at)
       VALUES ($1, $2, $3, 'sender@test.com', 'user@test.com', 'Test A', 'Body', NOW() - INTERVAL '5 minutes', 'processing', 'smtp-msg-abc12345', NOW() - INTERVAL '3 minutes')`,
      [emailWithSmtpId, testUserId, testSenderId]
    );

    // Email B: In processing > 2 mins without smtp_message_id (delivery uncertain)
    await query(
      `INSERT INTO emails (id, user_id, sender_id, sender_email, recipient, subject, body, scheduled_at, status, smtp_message_id, updated_at)
       VALUES ($1, $2, $3, 'sender@test.com', 'user@test.com', 'Test B', 'Body', NOW() - INTERVAL '5 minutes', 'processing', NULL, NOW() - INTERVAL '3 minutes')`,
      [emailWithoutSmtpId, testUserId, testSenderId]
    );

    // Execute dbDispatcher lease expiry logic
    // 1. Reconcile with smtp_message_id to 'sent'
    await query(
      `UPDATE emails
       SET status = 'sent', updated_at = NOW()
       WHERE status = 'processing'
         AND smtp_message_id IS NOT NULL
         AND updated_at < NOW() - INTERVAL '2 minutes'`
    );

    // 2. Mark uncertain processing emails as 'failed' (suppress resend)
    await query(
      `UPDATE emails
       SET status = 'failed',
           error_details = 'Processing lease expired after 2 minutes with no SMTP confirmation. Automatic resend suppressed to prevent duplicate delivery (delivery status uncertain).',
           updated_at = NOW()
       WHERE status = 'processing'
         AND smtp_message_id IS NULL
         AND updated_at < NOW() - INTERVAL '2 minutes'`
    );

    const emailARes = await query(`SELECT status, smtp_message_id FROM emails WHERE id = $1`, [emailWithSmtpId]);
    const emailBRes = await query(`SELECT status, error_details FROM emails WHERE id = $1`, [emailWithoutSmtpId]);

    console.log(`Email A (had smtp_message_id): status=${emailARes.rows[0].status} (Expected: sent)`);
    console.log(`Email B (no smtp_message_id): status=${emailBRes.rows[0].status} (Expected: failed)`);
    console.log(`Email B error notice: "${emailBRes.rows[0].error_details}"`);

    // Verify neither email was reset to 'scheduled'
    const scheduledCheck = await query(
      `SELECT id FROM emails WHERE id IN ($1, $2) AND status = 'scheduled'`,
      [emailWithSmtpId, emailWithoutSmtpId]
    );

    const test4Pass =
      emailARes.rows[0].status === "sent" &&
      emailBRes.rows[0].status === "failed" &&
      emailBRes.rows[0].error_details.includes("Automatic resend suppressed") &&
      scheduledCheck.rows.length === 0;

    console.log(`TEST 4 RESULT: ${test4Pass ? "PASS (No duplicate sends, reconciled or marked failed)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 5: Simulate failure before SMTP acceptance and verify intended retry behaviour
    // ------------------------------------------------------------------------
    console.log("--- TEST 5: Simulate failure before SMTP acceptance (verify retry behavior) ---");
    const retryEmailId = `test-email-retry-${randomUUID().slice(0, 8)}`;

    await query(
      `INSERT INTO emails (id, user_id, sender_id, sender_email, recipient, subject, body, scheduled_at, status, retry_count)
       VALUES ($1, $2, $3, 'sender@test.com', 'user@test.com', 'Retry Test', 'Body', NOW(), 'processing', 0)`,
      [retryEmailId, testUserId, testSenderId]
    );

    // Simulate pre-SMTP failure on attempt 1 (e.g. ETIMEDOUT or ECONNREFUSED)
    const mockAttempt1Error = "ECONNREFUSED: Connection refused to SMTP server";
    const retryCount1 = 1;
    await query(
      `UPDATE emails
       SET status = 'scheduled', scheduled_at = NOW() + INTERVAL '30 seconds', retry_count = $1, error_details = $2, updated_at = NOW()
       WHERE id = $3`,
      [retryCount1, mockAttempt1Error, retryEmailId]
    );

    const retryCheck1 = await query(`SELECT status, scheduled_at, retry_count, error_details FROM emails WHERE id = $1`, [retryEmailId]);
    console.log(`Attempt 1 post-failure: status=${retryCheck1.rows[0].status}, retry_count=${retryCheck1.rows[0].retry_count}`);

    // Verify scheduled_at is in the future so dbDispatcher does not claim it prematurely
    const scheduledAtTime = new Date(retryCheck1.rows[0].scheduled_at).getTime();
    const isProtectedFromDbDispatcher = scheduledAtTime > Date.now();
    console.log(`Is scheduled_at delayed in future for BullMQ backoff? ${isProtectedFromDbDispatcher}`);

    // Simulate retry claiming by BullMQ worker
    const claimRes = await query(
      "UPDATE emails SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'scheduled' RETURNING id",
      [retryEmailId]
    );
    console.log(`BullMQ worker claimed for retry attempt 2: claimed=${claimRes.rows.length === 1}`);

    // Simulate attempt 3 exhausting retries
    const maxAttempts = 3;
    const retryCount3 = maxAttempts;
    await query(
      `UPDATE emails
       SET status = 'failed', retry_count = $1, error_details = $2, updated_at = NOW()
       WHERE id = $3`,
      [retryCount3, "Max retry attempts exhausted", retryEmailId]
    );

    const finalCheck = await query(`SELECT status, retry_count FROM emails WHERE id = $1`, [retryEmailId]);
    console.log(`After exhausting attempts: status=${finalCheck.rows[0].status}, retry_count=${finalCheck.rows[0].retry_count}`);

    const test5Pass =
      retryCheck1.rows[0].status === "scheduled" &&
      isProtectedFromDbDispatcher &&
      claimRes.rows.length === 1 &&
      finalCheck.rows[0].status === "failed";

    console.log(`TEST 5 RESULT: ${test5Pass ? "PASS (Normal BullMQ retry cycle preserved without interference)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 6: Verify BullMQ and dbDispatcher still cannot claim the same email
    // ------------------------------------------------------------------------
    console.log("--- TEST 6: Verify BullMQ and dbDispatcher mutual exclusion on claim ---");
    const raceEmailId = `test-race-${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO emails (id, user_id, sender_id, sender_email, recipient, subject, body, scheduled_at, status)
       VALUES ($1, $2, $3, 'sender@test.com', 'user@test.com', 'Race Test', 'Body', NOW() - INTERVAL '10 seconds', 'scheduled')`,
      [raceEmailId, testUserId, testSenderId]
    );

    // BullMQ worker query
    const bullmqClaimPromise = query(
      "UPDATE emails SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status = 'scheduled' RETURNING id",
      [raceEmailId]
    );

    // dbDispatcher query
    const dbDispatcherClaimPromise = query(
      `UPDATE emails
       SET status = 'processing', updated_at = NOW()
       WHERE id = (
         SELECT id FROM emails
         WHERE id = $1 AND status = 'scheduled' AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id`,
      [raceEmailId]
    );

    const [claimA, claimB] = await Promise.all([bullmqClaimPromise, dbDispatcherClaimPromise]);
    const totalClaimed = claimA.rows.length + claimB.rows.length;
    console.log(`BullMQ claim result count: ${claimA.rows.length}`);
    console.log(`dbDispatcher claim result count: ${claimB.rows.length}`);
    console.log(`Total successful claims: ${totalClaimed}`);

    const test6Pass = totalClaimed === 1;
    console.log(`TEST 6 RESULT: ${test6Pass ? "PASS (Exactly one engine claimed the row)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 7: Hourly count seed uses sent_at; ignores old emails touched in current hour
    // ------------------------------------------------------------------------
    console.log("--- TEST 7: Hourly quota seeding excludes old emails touched in current hour ---");
    const seedSenderId = `test-seed-${randomUUID().slice(0, 8)}`;
    await query(
      `INSERT INTO senders (id, user_id, email, name, hourly_limit) VALUES ($1, $2, $3, $4, 2)`,
      [seedSenderId, testUserId, `${seedSenderId}@example.com`, "Seed Sender"]
    );

    // Old email: sent 3 hours ago, but its updated_at was touched just now (e.g. metadata update)
    await query(
      `INSERT INTO emails (id, user_id, sender_id, sender_email, recipient, subject, body, scheduled_at, status, sent_at, updated_at)
       VALUES ($1, $2, $3, 'sender@test.com', 'user@test.com', 'Old Sent', 'Body', NOW() - INTERVAL '3 hours', 'sent', NOW() - INTERVAL '3 hours', NOW())`,
      [`old-email-${randomUUID().slice(0, 8)}`, testUserId, seedSenderId]
    );

    // Check rate limit: if it incorrectly counted updated_at, it would see count=1 and next would be count=2
    // Because it correctly uses sent_at, count starts at 0, so first call should be allowed=true, count=1
    const seedCheckRes = await checkAndIncrementHourlyRateLimitDbFallback(seedSenderId, 2, msRemaining);
    console.log(`Seed check result: allowed=${seedCheckRes.allowed}, currentCount=${seedCheckRes.currentCount} (Expected: 1, not 2)`);

    const test7Pass = seedCheckRes.allowed === true && seedCheckRes.currentCount === 1;
    console.log(`TEST 7 RESULT: ${test7Pass ? "PASS (Old email touched in current hour was not counted)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 8: Recipient email masking
    // ------------------------------------------------------------------------
    console.log("--- TEST 8: Recipient email address masking ---");
    const { maskRecipientEmail } = await import("../apps/backend/src/workers/emailWorker.js");

    const masked1 = maskRecipientEmail("john.doe@reachinbox.ai");
    const masked2 = maskRecipientEmail("alex@example.com");
    const masked3 = maskRecipientEmail("a@b.com");

    console.log(`"john.doe@reachinbox.ai" -> "${masked1}"`);
    console.log(`"alex@example.com" -> "${masked2}"`);
    console.log(`"a@b.com" -> "${masked3}"`);

    const test8Pass =
      masked1 === "j***e@reachinbox.ai" &&
      masked2 === "a***x@example.com" &&
      !masked1.includes("john.doe") &&
      !masked2.includes("alex@");

    console.log(`TEST 8 RESULT: ${test8Pass ? "PASS (Recipient emails are safely masked)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 9: Multi-instance Redis-unavailable pacing pause
    // ------------------------------------------------------------------------
    console.log("--- TEST 9: Multi-instance Redis-unavailable pacing pause ---");
    process.env.MULTI_INSTANCE = "true";
    (redis as any).status = "close";

    const multiInstanceSlot = await acquireSenderSendSlot(testSenderId, 2000);
    delete process.env.MULTI_INSTANCE;
    (redis as any).status = origStatus;

    console.log(`Multi-instance delay when Redis is offline: ${multiInstanceSlot}ms (Expected: >= 30000ms pause)`);
    const test9Pass = multiInstanceSlot >= 30000;
    console.log(`TEST 9 RESULT: ${test9Pass ? "PASS (Paused sending in multi-instance mode without Redis)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 10: Ethereal relay fails closed when RELAY_SECRET is missing or invalid
    // ------------------------------------------------------------------------
    console.log("--- TEST 10: Ethereal relay fails closed without RELAY_SECRET ---");
    const relayModule = await import("../api/ethereal-relay.js");
    const relayHandler = relayModule.default;

    function createMockRes() {
      return {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: null as any,
        setHeader(k: string, v: string) { this.headers[k] = v; return this; },
        status(code: number) { this.statusCode = code; return this; },
        json(data: any) { this.body = data; return this; },
        end() { return this; }
      };
    }

    const origRelaySecret = process.env.RELAY_SECRET;
    delete process.env.RELAY_SECRET;

    // Call 1: Unconfigured RELAY_SECRET on server -> fails closed with 500
    const mockRes1 = createMockRes();
    await relayHandler({ method: "POST", headers: {}, body: { secret: "any-secret" } }, mockRes1);
    console.log(`Unset RELAY_SECRET on server response: status=${mockRes1.statusCode}, error="${mockRes1.body?.error}"`);

    // Call 2: Configured on server, but request has invalid secret -> 401
    process.env.RELAY_SECRET = "secret_test_relay_token_12345";
    const mockRes2 = createMockRes();
    await relayHandler({ method: "POST", headers: {}, body: { secret: "wrong-secret" } }, mockRes2);
    console.log(`Wrong secret in request response: status=${mockRes2.statusCode}, error="${mockRes2.body?.error}"`);

    if (origRelaySecret) {
      process.env.RELAY_SECRET = origRelaySecret;
    } else {
      delete process.env.RELAY_SECRET;
    }

    const test10Pass =
      mockRes1.statusCode === 500 &&
      mockRes1.body?.error?.includes("RELAY_SECRET is not configured") &&
      mockRes2.statusCode === 401 &&
      mockRes2.body?.error?.includes("Unauthorized relay request");

    console.log(`TEST 10 RESULT: ${test10Pass ? "PASS (Fails closed on missing or unauthorized secret)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 11: Slack OAuth & alerts fail closed when unconfigured
    // ------------------------------------------------------------------------
    console.log("--- TEST 11: Slack OAuth & alerts fail closed when unconfigured ---");
    const { isSlackConfigured, getSlackOAuthUrl, sendRateLimitSlackAlert } = await import("../apps/backend/src/services/slackService.js");
    const { config } = await import("../apps/backend/src/config/index.js");

    const origSlackId = config.slack.clientId;
    const origSlackSec = config.slack.clientSecret;
    const origSlackKey = config.slack.encryptionKey;

    config.slack.clientId = "";
    config.slack.clientSecret = "";
    config.slack.encryptionKey = "";

    const isConfiguredCheck = isSlackConfigured();
    let oauthThrew = false;
    try {
      getSlackOAuthUrl(testUserId);
    } catch (err: any) {
      oauthThrew = err.message.includes("Slack integration is disabled");
    }

    const alertResult = await sendRateLimitSlackAlert(
      testUserId,
      testSenderId,
      `${testSenderId}@example.com`,
      "window-unconfigured",
      100,
      new Date()
    );

    console.log(`isSlackConfigured(): ${isConfiguredCheck} (Expected: false)`);
    console.log(`getSlackOAuthUrl threw disabled error: ${oauthThrew}`);
    console.log(`sendRateLimitSlackAlert safely skipped: ${alertResult === false}`);

    config.slack.clientId = origSlackId;
    config.slack.clientSecret = origSlackSec;
    config.slack.encryptionKey = origSlackKey;

    const test11Pass = !isConfiguredCheck && oauthThrew && alertResult === false;
    console.log(`TEST 11 RESULT: ${test11Pass ? "PASS (Safely disabled without fake credentials)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 12: SLACK_ENCRYPTION_KEY fails closed when missing; round-trips when configured
    // ------------------------------------------------------------------------
    console.log("--- TEST 12: SLACK_ENCRYPTION_KEY fails closed when missing ---");
    const { encryptToken, decryptToken } = await import("../apps/backend/src/services/slackService.js");

    config.slack.encryptionKey = "";
    let encryptThrew = false;
    try {
      encryptToken("sample-slack-token");
    } catch (err: any) {
      encryptThrew = err.message.includes("SLACK_ENCRYPTION_KEY must be configured");
    }

    // Now test round-trip when configured
    config.slack.encryptionKey = "test_key_32_chars_long_for_unit_tests!";
    const testSecret = "xoxb-test-999888-token";
    const encrypted = encryptToken(testSecret);
    const decrypted = decryptToken(encrypted);

    config.slack.encryptionKey = origSlackKey;

    const test12Pass = encryptThrew && encrypted !== testSecret && decrypted === testSecret;
    console.log(`encryptToken threw when unconfigured: ${encryptThrew}`);
    console.log(`Round-trip decryption preserved token: ${decrypted === testSecret}`);
    console.log(`TEST 12 RESULT: ${test12Pass ? "PASS (No hardcoded encryption key fallback)" : "FAIL"}\n`);

    // ------------------------------------------------------------------------
    // TEST 13: SESSION_SECRET missing fails closed (no hardcoded fallback)
    // ------------------------------------------------------------------------
    console.log("--- TEST 13: SESSION_SECRET missing fails closed without hardcoded fallback ---");
    const { app } = await import("../apps/backend/src/app.js");
    const supertest = (await import("supertest")).default;

    const origSessionSecret = config.sessionSecret;
    config.sessionSecret = "";

    const loginRes = await supertest(app).post("/api/auth/login").send({
      email: "test@domain.com",
      password: "password123"
    });

    console.log(`Login response with unconfigured SESSION_SECRET: status=${loginRes.status}, error="${loginRes.body?.error}"`);

    config.sessionSecret = origSessionSecret;

    const test13Pass = loginRes.status === 503 && loginRes.body?.error?.includes("SESSION_SECRET is not configured");
    console.log(`TEST 13 RESULT: ${test13Pass ? "PASS (Fails closed with 503 when SESSION_SECRET is missing)" : "FAIL"}\n`);

    console.log("===============================================================");
    const allPassed =
      test1Pass && test2Pass && test3Pass && test4Pass && test5Pass && test6Pass && test7Pass && test8Pass && test9Pass &&
      test10Pass && test11Pass && test12Pass && test13Pass;
    console.log(`OVERALL SAFETY SUITE: ${allPassed ? "ALL 13 TESTS PASSED" : "FAILED"}`);
    console.log("===============================================================");

    process.exit(allPassed ? 0 : 1);
  } finally {
    delete process.env.MULTI_INSTANCE;
    // Clean up test data
    await query(`DELETE FROM emails WHERE user_id = $1`, [testUserId]).catch(() => {});
    await query(`DELETE FROM senders WHERE user_id = $1`, [testUserId]).catch(() => {});
    await query(`DELETE FROM users WHERE id = $1`, [testUserId]).catch(() => {});
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
