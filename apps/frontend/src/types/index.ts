export type EmailStatus = "scheduled" | "processing" | "sent" | "failed";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  user_id: string;
  email: string;
  name: string;
  hourly_limit: number;
}

export interface EmailRecord {
  id: string;
  user_id: string;
  sender_id: string;
  sender_email: string;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: EmailStatus;
  bullmq_job_id: string | null;
  idempotency_key: string | null;
  min_delay_ms: number;
  hourly_limit: number;
  sent_at: string | null;
  retry_count: number;
  error_details: string | null;
  smtp_message_id: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlackStatus {
  isConnected: boolean;
  teamName?: string;
  channelName?: string;
}
