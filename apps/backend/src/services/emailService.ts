import nodemailer, { Transporter } from "nodemailer";
import axios from "axios";
import { config } from "../config/index.js";

let transporter: Transporter | null = null;
let dynamicTestAccount: { user: string; pass: string } | null = null;

export async function getEmailTransporter(): Promise<Transporter> {
  if (transporter) {
    return transporter;
  }

  let user = config.ethereal.user;
  let pass = config.ethereal.pass;

  if (!user || !pass) {
    if (!dynamicTestAccount) {
      try {
        console.log("[EmailService] No static Ethereal credentials found. Creating dynamic test account...");
        dynamicTestAccount = await nodemailer.createTestAccount();
        console.log(`[EmailService] Dynamic Ethereal test account created: ${dynamicTestAccount.user}`);
      } catch (err: any) {
        console.error("[EmailService] Error creating dynamic Ethereal test account:", err?.message || err);
      }
    }
    if (dynamicTestAccount) {
      user = dynamicTestAccount.user;
      pass = dynamicTestAccount.pass;
    }
  }

  transporter = nodemailer.createTransport({
    host: config.ethereal.host,
    port: config.ethereal.port,
    secure: false,
    auth: {
      user: user || "test@ethereal.email",
      pass: pass || "testpassword"
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000
  });

  return transporter;
}

export async function sendEmailViaSmtp(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string; previewUrl: string | false }> {
  const isHtml = /<[a-z][\s\S]*>/i.test(options.html);
  const formattedHtml = isHtml
    ? options.html
    : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e1e1e; white-space: pre-wrap;">${options.html}</div>`;

  const plainText = options.html.replace(/<[^>]+>/g, " ");

  // 1. Primary Attempt: Direct SMTP dispatch via Nodemailer
  try {
    const mailer = await getEmailTransporter();
    const info = await mailer.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: plainText,
      html: formattedHtml
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return {
      messageId: info.messageId,
      previewUrl: previewUrl || false
    };
  } catch (directErr: any) {
    const errMsg = directErr?.message || String(directErr);
    console.warn(`[EmailService] Direct SMTP attempt notice (${errMsg}). Trying cloud HTTPS relay...`);

    // 2. Cloud Relay Attempt: If host blocks raw outbound SMTP (e.g. Render port 587 block),
    // route securely through unblocked HTTPS relay on Vercel
    const relaySecret = "reachinbox_secret_relay_guard_9283";
    const relayCandidates = [
      `${config.clientUrl}/api/ethereal-relay`,
      "https://reachinbox-email-scheduler-eosin.vercel.app/api/ethereal-relay"
    ];

    for (const relayUrl of relayCandidates) {
      try {
        const relayRes = await axios.post(
          relayUrl,
          {
            from: options.from,
            to: options.to,
            subject: options.subject,
            html: formattedHtml,
            text: plainText,
            secret: relaySecret
          },
          {
            headers: {
              "x-relay-secret": relaySecret,
              "Content-Type": "application/json"
            },
            timeout: 25000
          }
        );

        if (relayRes.data && relayRes.data.success && relayRes.data.previewUrl) {
          console.log(`[EmailService] Cloud relay delivered message successfully via ${relayUrl}. Preview: ${relayRes.data.previewUrl}`);
          return {
            messageId: relayRes.data.messageId,
            previewUrl: relayRes.data.previewUrl
          };
        }
      } catch (relayErr: any) {
        console.warn(`[EmailService] Relay attempt at ${relayUrl} notice:`, relayErr?.message || relayErr);
      }
    }

    // Never return a generic fallback URL (such as https://ethereal.email/messages)!
    throw directErr;
  }
}

