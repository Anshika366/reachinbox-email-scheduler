import dotenv from "dotenv";
import path from "path";
import fs from "fs";

const candidateEnvFiles = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/backend/.env"),
  path.resolve(process.cwd(), "../.env"),
  path.resolve(process.cwd(), "../../.env")
];

for (const envFile of candidateEnvFiles) {
  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
  }
}
dotenv.config();

const isProd = process.env.NODE_ENV === "production" || !!process.env.RENDER || !!process.env.RENDER_EXTERNAL_URL;

const resolvedClientUrl = process.env.CLIENT_URL && !process.env.CLIENT_URL.includes("localhost")
  ? process.env.CLIENT_URL
  : (isProd ? "https://reachinbox-email-scheduler-eosin.vercel.app" : (process.env.CLIENT_URL || "http://localhost:5173"));

const resolvedGoogleCallbackUrl = process.env.GOOGLE_CALLBACK_URL && !process.env.GOOGLE_CALLBACK_URL.includes("localhost")
  ? process.env.GOOGLE_CALLBACK_URL
  : (isProd ? "https://reachinbox-email-scheduler-csri.onrender.com/api/auth/google/callback" : (process.env.GOOGLE_CALLBACK_URL || "http://localhost:4000/api/auth/google/callback"));

const resolvedSlackRedirectUri = process.env.SLACK_REDIRECT_URI && !process.env.SLACK_REDIRECT_URI.includes("localhost")
  ? process.env.SLACK_REDIRECT_URI
  : (isProd ? "https://reachinbox-email-scheduler-csri.onrender.com/api/integrations/slack/callback" : (process.env.SLACK_REDIRECT_URI || "http://localhost:4000/api/integrations/slack/callback"));

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || (process.env.RENDER ? "production" : "development"),
  clientUrl: resolvedClientUrl,
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres@localhost:5433/reachinbox_scheduler",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  elasticsearchUrl: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
  minDelayMs: parseInt(process.env.MIN_DELAY_MS || "2000", 10),
  maxEmailsPerHourPerSender: parseInt(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER || "100", 10),
  ethereal: {
    user: process.env.ETHEREAL_USER || "",
    pass: process.env.ETHEREAL_PASS || "",
    host: process.env.ETHEREAL_HOST || "smtp.ethereal.email",
    port: parseInt(process.env.ETHEREAL_PORT || "587", 10)
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl: resolvedGoogleCallbackUrl
  },
  sessionSecret: process.env.SESSION_SECRET || "",
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || "",
    clientSecret: process.env.SLACK_CLIENT_SECRET || "",
    redirectUri: resolvedSlackRedirectUri,
    encryptionKey: process.env.SLACK_ENCRYPTION_KEY || ""
  },
  relaySecret: process.env.RELAY_SECRET || "",
  bullBoard: {
    user: process.env.BULL_BOARD_USER || "",
    pass: process.env.BULL_BOARD_PASS || ""
  }
};
