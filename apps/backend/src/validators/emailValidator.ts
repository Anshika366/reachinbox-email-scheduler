import { z } from "zod";

export const scheduleEmailSchema = z.object({
  senderId: z.string().min(1, "Sender ID is required"),
  recipients: z.array(z.string().email("Invalid email recipient")).min(1, "At least one recipient is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  scheduledAt: z.string().refine((val) => {
    const ts = Date.parse(val);
    return !isNaN(ts);
  }, "Scheduled time must be a valid date"),
  minDelayMs: z.number().int().nonnegative().optional(),
  hourlyLimit: z.number().int().positive().optional(),
  idempotencyKey: z.string().optional()
});

export const createSenderSchema = z.object({
  name: z.string().min(1, "Sender name is required"),
  email: z.string().email("Invalid sender email"),
  hourlyLimit: z.number().int().positive().optional()
});
