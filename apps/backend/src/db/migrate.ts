import { query } from "./index.js";

export async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      google_id VARCHAR(128) UNIQUE,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      password_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

    CREATE TABLE IF NOT EXISTS senders (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      hourly_limit INT NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_sender_email UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS emails (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_id VARCHAR(64) NOT NULL REFERENCES senders(id) ON DELETE CASCADE,
      sender_email VARCHAR(255) NOT NULL,
      recipient VARCHAR(255) NOT NULL,
      subject VARCHAR(500) NOT NULL,
      body TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
      bullmq_job_id VARCHAR(128) UNIQUE,
      idempotency_key VARCHAR(128) UNIQUE,
      min_delay_ms INT NOT NULL DEFAULT 2000,
      hourly_limit INT NOT NULL DEFAULT 100,
      sent_at TIMESTAMPTZ,
      retry_count INT NOT NULL DEFAULT 0,
      error_details TEXT,
      smtp_message_id VARCHAR(255),
      preview_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS slack_integrations (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      team_id VARCHAR(64) NOT NULL,
      team_name VARCHAR(255) NOT NULL,
      channel_id VARCHAR(64),
      channel_name VARCHAR(255),
      access_token_encrypted TEXT NOT NULL,
      bot_user_id VARCHAR(64),
      is_connected BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rate_limit_notifications (
      id VARCHAR(64) PRIMARY KEY,
      sender_id VARCHAR(64) NOT NULL,
      hourly_window VARCHAR(64) NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_sender_hourly_window UNIQUE(sender_id, hourly_window)
    );

    CREATE TABLE IF NOT EXISTS idempotency_records (
      key VARCHAR(128) PRIMARY KEY,
      response_payload TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
    CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    CREATE INDEX IF NOT EXISTS idx_emails_sender_id ON emails(sender_id);
    CREATE INDEX IF NOT EXISTS idx_emails_scheduled_at ON emails(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_emails_job_id ON emails(bullmq_job_id);
  `);
}
