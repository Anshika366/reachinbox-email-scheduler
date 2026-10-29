export type EmailStatus = "scheduled" | "processing" | "sent" | "failed";

export interface User {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Sender {
  id: string;
  user_id: string;
  email: string;
  name: string;
  hourly_limit: number;
  created_at: Date;
  updated_at: Date;
}

export interface EmailRecord {
  id: string;
  user_id: string;
  sender_id: string;
  sender_email: string;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  status: EmailStatus;
  bullmq_job_id: string | null;
  idempotency_key: string | null;
  min_delay_ms: number;
  hourly_limit: number;
  sent_at: Date | null;
  retry_count: number;
  error_details: string | null;
  smtp_message_id: string | null;
  preview_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SlackIntegration {
  id: string;
  user_id: string;
  team_id: string;
  team_name: string;
  channel_id: string | null;
  channel_name: string | null;
  access_token_encrypted: string;
  bot_user_id: string | null;
  is_connected: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmailJobData {
  emailId: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: string;
  minDelayMs: number;
  hourlyLimit: number;
  idempotencyKey?: string;
}

export interface ScheduleCampaignRequest {
  senderId: string;
  recipients: string[];
  subject: string;
  body: string;
  scheduledAt: string;
  minDelayMs?: number;
  hourlyLimit?: number;
  idempotencyKey?: string;
}
