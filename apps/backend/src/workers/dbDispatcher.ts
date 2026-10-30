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
      // 1. Recover any emails stuck in 'processing' for > 2 minutes (e.g. from container restarts)
      await query(
        `UPDATE emails
         SET status = 'scheduled', updated_at = NOW()
         WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '2 minutes'`
      );

      // 2. Auto-recover any emails that failed recently with Connection timeout so they deliver
      await query(
        `UPDATE emails
         SET status = 'scheduled', scheduled_at = NOW(), error_details = NULL, updated_at = NOW()
         WHERE status = 'failed' 
           AND (error_details ILIKE '%timeout%' OR error_details ILIKE '%ETIMEDOUT%' OR error_details ILIKE '%ECONN%')
           AND updated_at >= NOW() - INTERVAL '12 hours'`
      );

      // 3. Migrate any legacy generic preview URLs to direct public preview URLs
      await query(
        `UPDATE emails
         SET preview_url = 'https://reachinbox-email-scheduler-csri.onrender.com/api/emails/preview/' || id
         WHERE (preview_url = 'https://ethereal.email/messages' OR preview_url IS NULL) AND status = 'sent'`
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

          const directPreviewUrl = `https://reachinbox-email-scheduler-csri.onrender.com/api/emails/preview/${email.id}`;
          const previewUrl = sendResult.previewUrl && sendResult.previewUrl.includes("/message/")
            ? sendResult.previewUrl
            : directPreviewUrl;
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

