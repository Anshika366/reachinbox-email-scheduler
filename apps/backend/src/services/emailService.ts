import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config/index.js";

let transporter: Transporter | null = null;

export async function getEmailTransporter(): Promise<Transporter> {
  if (transporter) {
    return transporter;
  }

  let user = config.ethereal.user;
  let pass = config.ethereal.pass;

  if (!user || !pass) {
    const testAccount = await nodemailer.createTestAccount();
    user = testAccount.user;
    pass = testAccount.pass;
  }

  transporter = nodemailer.createTransport({
    host: config.ethereal.host,
    port: config.ethereal.port,
    secure: false,
    auth: {
      user,
      pass
    }
  });

  return transporter;
}

export async function sendEmailViaSmtp(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string; previewUrl: string | false }> {
  const mailer = await getEmailTransporter();
  const isHtml = /<[a-z][\s\S]*>/i.test(options.html);
  const formattedHtml = isHtml
    ? options.html
    : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e1e1e; white-space: pre-wrap;">${options.html}</div>`;

  const plainText = options.html.replace(/<[^>]+>/g, " ");

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
}
