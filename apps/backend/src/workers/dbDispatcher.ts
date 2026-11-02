import { query } from "../db/index.js";
import { EmailRecord } from "../types/index.js";
import { sendEmailViaSmtp } from "../services/emailService.js";
import { updateEmailDocumentStatus } from "../services/elasticsearchService.js";
import { maskRecipientEmail } from "./emailWorker.js";

let isPolling = false;

export function startDatabaseEmailDispatcher(): void {
  console.log("Database background email dispatcher started (3s interval).");

  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      // 1. If an email stuck in 'processing' for > 2 minutes already recorded an smtp_message_id,
      // the SMTP relay accepted it before a crash. Finalize status to 'sent' rather than resending!
      await query(
        `UPDATE emails
         SET status = 'sent', updated_at = NOW()
         WHERE status = 'processing'
           AND smtp_message_id IS NOT NULL
           AND updated_at < NOW() - INTERVAL '2 minutes'`
      );

      // 2. If an email stuck in 'processing' for > 2 minutes lacks smtp_message_id,
      // its external delivery status is uncertain. Never blindly reset to 'scheduled' or resend!
      // Mark as 'failed' with explicit delivery uncertainty notice requiring manual operator review.
      await query(
        `UPDATE emails
         SET status = 'failed',
             error_details = 'Processing lease expired after 2 minutes with no SMTP confirmation. Automatic resend suppressed to prevent duplicate delivery (delivery status uncertain).',
             updated_at = NOW()
         WHERE status = 'processing'
           AND smtp_message_id IS NULL
           AND updated_at < NOW() - INTERVAL '2 minutes'`
      );

      // 3. Clear any legacy generic preview URLs that forced users to ethereal login
      await query(
        `UPDATE emails
         SET preview_url = NULL
         WHERE preview_url IN ('https://ethereal.email/messages', 'https://ethereal.email', 'https://ethereal.email/login')`
      );

      // 4. Process up to 5 due scheduled emails in this tick
      for (let i = 0; i < 5; i++) {
        const res = await query<EmailRecord>(
          `UPDATE emails
           SET status = 'processing', updated_at = NOW()
           WHERE id = (
             SELECT id FROM emails
             WHERE status = 'scheduled' AND scheduled_at <= NOW()
             ORDER BY scheduled_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           RETURNING *`
        );

        if (res.rows.length === 0) {
          break;
        }

        const email = res.rows[0];

        try {
          const sendResult = await sendEmailViaSmtp({
            from: email.sender_email,
            to: email.recipient,
            subject: email.subject,
            html: email.body
          });

          const previewUrl = sendResult.previewUrl ? sendResult.previewUrl : null;
          const sentAt = new Date();

          await query(
            `UPDATE emails
             SET status = 'sent', sent_at = $1, smtp_message_id = $2, preview_url = $3, updated_at = NOW()
             WHERE id = $4`,
            [sentAt, sendResult.messageId, previewUrl, email.id]
          );

          await updateEmailDocumentStatus(email.id, "sent", sentAt);
          console.log(`[Dispatcher] Successfully delivered scheduled email ${email.id} to ${maskRecipientEmail(email.recipient)}`);
        } catch (sendErr: any) {
          console.error(`[Dispatcher] Delivery error for email ${email.id}:`, sendErr?.message || sendErr);
          await query(
            `UPDATE emails
             SET status = 'failed', error_details = $1, updated_at = NOW()
             WHERE id = $2`,
            [sendErr?.message || "Delivery error", email.id]
          );
          await updateEmailDocumentStatus(email.id, "failed");
        }
      }
    } catch {
      // Silence intermittent DB polling errors to avoid noisy logs
    } finally {
      isPolling = false;
    }
  }, 3000);
}

