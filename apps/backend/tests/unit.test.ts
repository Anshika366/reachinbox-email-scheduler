import { scheduleEmailSchema, createSenderSchema } from "../src/validators/emailValidator.js";
import { getHourlyWindowKey } from "../src/services/redisService.js";
import { encryptToken, decryptToken, isSlackConfigured } from "../src/services/slackService.js";
import { config } from "../src/config/index.js";
import { parse } from "csv-parse/sync";

describe("Validation and Utility Unit Tests", () => {
  test("scheduleEmailSchema validates correct campaign data", () => {
    const validData = {
      senderId: "sender-123",
      recipients: ["user1@example.com", "user2@example.com"],
      subject: "Test Subject",
      body: "<p>Hello World</p>",
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
      minDelayMs: 2000,
      hourlyLimit: 50
    };

    const result = scheduleEmailSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test("scheduleEmailSchema rejects invalid email recipient", () => {
    const invalidData = {
      senderId: "sender-123",
      recipients: ["user1@example.com", "not-an-email"],
      subject: "Test Subject",
      body: "<p>Hello World</p>",
      scheduledAt: new Date().toISOString()
    };

    const result = scheduleEmailSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  test("createSenderSchema validates name and email", () => {
    const validSender = {
      name: "Support Team",
      email: "support@reachinbox.io",
      hourlyLimit: 100
    };

    const result = createSenderSchema.safeParse(validSender);
    expect(result.success).toBe(true);
  });

  test("getHourlyWindowKey returns positive msRemaining and valid windowKey", () => {
    const info = getHourlyWindowKey(1700000000000);
    expect(info.windowKey).toBeDefined();
    expect(info.msRemaining).toBeGreaterThan(0);
    expect(info.msRemaining).toBeLessThanOrEqual(3600000);
  });

  test("isSlackConfigured and encryptToken fail closed when unconfigured", () => {
    const origKey = config.slack.encryptionKey;
    const origId = config.slack.clientId;
    const origSec = config.slack.clientSecret;

    // Simulate unconfigured Slack
    config.slack.encryptionKey = "";
    config.slack.clientId = "";
    config.slack.clientSecret = "";

    expect(isSlackConfigured()).toBe(false);
    expect(() => encryptToken("raw-secret")).toThrow(/SLACK_ENCRYPTION_KEY must be configured/);
    expect(() => decryptToken("iv:encrypted")).toThrow(/SLACK_ENCRYPTION_KEY must be configured/);

    // Restore configured test key
    config.slack.encryptionKey = origKey;
    config.slack.clientId = origId;
    config.slack.clientSecret = origSec;
  });

  test("encryptToken and decryptToken round-trip securely when configured", () => {
    const origKey = config.slack.encryptionKey;
    config.slack.encryptionKey = "test_key_32_characters_for_unit_tests!";

    const rawToken = "xoxb-1234567890-test-slack-secret";
    const encrypted = encryptToken(rawToken);
    expect(encrypted).not.toBe(rawToken);
    expect(encrypted).toContain(":");

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(rawToken);

    config.slack.encryptionKey = origKey;
  });

  test("CSV email extraction accurately parses headers and rows", () => {
    const csvData = `Name,Email,Company\nAlice,alice@example.com,Acme\nBob,bob@domain.org,Globex\nBad,invalid-email,None`;
    const records = parse(csvData, { skip_empty_lines: true }) as string[][];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const row of records) {
      for (const cell of row) {
        const val = cell.trim();
        if (emailRegex.test(val)) {
          valid.push(val);
        } else if (val.toLowerCase() !== "name" && val.toLowerCase() !== "email" && val.toLowerCase() !== "company") {
          invalid.push(val);
        }
      }
    }

    expect(valid).toEqual(["alice@example.com", "bob@domain.org"]);
    expect(invalid).toContain("invalid-email");
  });
});
