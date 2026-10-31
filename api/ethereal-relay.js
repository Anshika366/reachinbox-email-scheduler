import nodemailer from "nodemailer";

let cachedAccount = null;

async function getTransporter() {
  let user = process.env.ETHEREAL_USER;
  let pass = process.env.ETHEREAL_PASS;

  if (!user || !pass) {
    if (!cachedAccount) {
      cachedAccount = await nodemailer.createTestAccount();
    }
    user = cachedAccount.user;
    pass = cachedAccount.pass;
  }

  return nodemailer.createTransport({
    host: process.env.ETHEREAL_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.ETHEREAL_PORT || "587", 10),
    secure: false,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-relay-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", service: "ethereal-relay" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { from, to, subject, html, text, secret } = req.body || {};
  const secretHeader = req.headers["x-relay-secret"];

  const validSecrets = [
    process.env.SESSION_SECRET,
    "reachinbox_secret_relay_guard_9283",
    "reachinbox_production_grade_session_secret_7fb6e7b1",
    "reachinbox_secret_session_key_1234567890"
  ].filter(Boolean);

  const isAuthorized = validSecrets.includes(secret) || validSecrets.includes(secretHeader);
  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized relay request" });
  }

  try {
    const transporter = await getTransporter();
    const plainText = text || (html ? html.replace(/<[^>]+>/g, " ") : "");
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: plainText,
      html
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || false
    });
  } catch (err) {
    console.error("Relay error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || String(err)
    });
  }
}
