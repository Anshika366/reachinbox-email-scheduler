import axios from "axios";
import { User, Sender, EmailRecord, SlackStatus } from "../types";

const API_BASE_URL = ((import.meta as any).env?.VITE_API_URL as string) || "http://localhost:4000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

export const authApi = {
  getGoogleAuthUrl: async () => {
    const res = await api.get<{ url: string }>("/auth/google/url");
    return res.data.url;
  },
  login: async (email: string, password: string) => {
    const res = await api.post<{ success: boolean; user: User }>("/auth/login", { email, password });
    return res.data;
  },
  getMe: async () => {
    const res = await api.get<{ user: User | null; senders: Sender[] }>("/auth/me");
    return res.data;
  },
  logout: async () => {
    await api.post("/auth/logout");
  }
};

export const emailApi = {
  getCounts: async () => {
    const res = await api.get<{ scheduled: number; sent: number }>("/emails/counts");
    return res.data;
  },
  getScheduled: async (page = 1, limit = 50) => {
    const res = await api.get<{ emails: EmailRecord[]; total: number }>("/emails/scheduled", {
      params: { page, limit }
    });
    return res.data;
  },
  getSent: async (page = 1, limit = 50) => {
    const res = await api.get<{ emails: EmailRecord[]; total: number }>("/emails/sent", {
      params: { page, limit }
    });
    return res.data;
  },
  getEmailById: async (id: string) => {
    const res = await api.get<{ email: EmailRecord }>(`/emails/${id}`);
    return res.data.email;
  },
  searchEmails: async (q: string, status?: string) => {
    const res = await api.get<{ emails: EmailRecord[]; total: number }>("/emails/search", {
      params: { q, status }
    });
    return res.data;
  },
  scheduleCampaign: async (data: {
    senderId: string;
    recipients: string[];
    subject: string;
    body: string;
    scheduledAt: string;
    minDelayMs?: number;
    hourlyLimit?: number;
    idempotencyKey?: string;
  }) => {
    const res = await api.post<{ success: boolean; count: number; emailIds: string[] }>(
      "/emails/schedule",
      data
    );
    return res.data;
  },
  uploadCsv: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await api.post<{
      validRecipients: string[];
      invalidEntries: string[];
      totalValid: number;
      totalInvalid: number;
    }>("/emails/upload-csv", formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return res.data;
  }
};

export const senderApi = {
  getSenders: async () => {
    const res = await api.get<{ senders: Sender[] }>("/senders");
    return res.data.senders;
  },
  createSender: async (data: { name: string; email: string; hourlyLimit?: number }) => {
    const res = await api.post<{ sender: Sender }>("/senders", data);
    return res.data.sender;
  }
};

export const slackApi = {
  getStatus: async () => {
    const res = await api.get<SlackStatus>("/integrations/slack/status");
    return res.data;
  },
  getAuthUrl: async () => {
    const res = await api.get<{ url: string }>("/integrations/slack/url");
    return res.data.url;
  },
  disconnect: async () => {
    const res = await api.post("/integrations/slack/disconnect");
    return res.data;
  }
};
