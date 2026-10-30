import { query } from "../db/index.js";
import { EmailRecord } from "../types/index.js";
import { sendEmailViaSmtp } from "../services/emailService.js";
import { updateEmailDocumentStatus } from "../services/elasticsearchService.js";

let isPolling = false;

export function startDatabaseEmailDispatcher(): void {
  console.log("Database background email dispatcher started (3s interval).");

  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      // Atomically claim the oldest due scheduled email using PostgreSQL FOR UPDATE SKIP LOCKED
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
        isPolling = false;
        return;
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
        console.log(`[Dispatcher] Successfully delivered scheduled email ${email.id} to ${email.recipient}`);
      } catch (sendErr: any) {
        console.error(`[Dispatcher] Delivery error for email ${email.id}:`, sendErr?.message || sendErr);
        await query(
          `UPDATE emails
           SET status = 'failed', error_details = $1, updated_at = NOW()
           WHERE id = $2`,
          [sendErr?.message || "SMTP transmission error", email.id]
        );
        await updateEmailDocumentStatus(email.id, "failed");
      }
    } catch (err: any) {
      // Silence intermittent DB polling errors to avoid noisy logs
    } finally {
      isPolling = false;
    }
  }, 3000);
}
