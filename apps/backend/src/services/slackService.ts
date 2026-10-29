import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import axios from "axios";
import { config } from "../config/index.js";
import { query } from "../db/index.js";
import { SlackIntegration } from "../types/index.js";

const ALGORITHM = "aes-256-cbc";

function getCipherKey(): Buffer {
  return crypto.createHash("sha256").update(config.slack.encryptionKey).digest();
}

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getCipherKey(), iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptToken(encryptedData: string): string {
  const parts = encryptedData.split(":");
  const iv = Buffer.from(parts[0], "hex");
  const encryptedText = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, getCipherKey(), iv);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function getSlackOAuthUrl(userId: string): string {
  const state = Buffer.from(JSON.stringify({ userId, rand: crypto.randomBytes(8).toString("hex") })).toString("base64");
  const scopes = ["chat:write", "chat:write.public", "channels:read", "channels:join", "groups:read", "incoming-webhook"];
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", config.slack.clientId);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("redirect_uri", config.slack.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeSlackCode(code: string, userId: string): Promise<void> {
  const response = await axios.post(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      code,
      redirect_uri: config.slack.redirectUri
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }
  );

  const data = response.data;
  if (!data.ok) {
    throw new Error(data.error || "Slack OAuth exchange failed");
  }

  const teamId = data.team?.id || "unknown_team";
  const teamName = data.team?.name || "Slack Workspace";
  const channelId = data.incoming_webhook?.channel_id || null;
  const channelName = data.incoming_webhook?.channel || null;
  const accessToken = data.access_token;
  const botUserId = data.bot_user_id || null;

  const encryptedToken = encryptToken(accessToken);
  const integrationId = crypto.randomUUID();

  await query(
    `INSERT INTO slack_integrations (id, user_id, team_id, team_name, channel_id, channel_name, access_token_encrypted, bot_user_id, is_connected, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       team_name = EXCLUDED.team_name,
       channel_id = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name,
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       bot_user_id = EXCLUDED.bot_user_id,
       is_connected = true,
       updated_at = NOW()`,
    [integrationId, userId, teamId, teamName, channelId, channelName, encryptedToken, botUserId]
  );
}

export async function getSlackStatus(userId: string): Promise<{ isConnected: boolean; teamName?: string; channelName?: string }> {
  const res = await query<SlackIntegration>(
    "SELECT * FROM slack_integrations WHERE user_id = $1 AND is_connected = true",
    [userId]
  );

  if (res.rows.length === 0) {
    return { isConnected: false };
  }

  return {
    isConnected: true,
    teamName: res.rows[0].team_name,
    channelName: res.rows[0].channel_name || undefined
  };
}

export async function disconnectSlack(userId: string): Promise<void> {
  await query(
    "UPDATE slack_integrations SET is_connected = false, updated_at = NOW() WHERE user_id = $1",
    [userId]
  );
}

export async function sendRateLimitSlackAlert(
  userId: string,
  senderId: string,
  senderEmail: string,
  hourlyWindow: string,
  limit: number,
  rescheduledTo: Date
): Promise<boolean> {
  try {
    const dedupeCheck = await query(
      "SELECT id FROM rate_limit_notifications WHERE sender_id = $1 AND hourly_window = $2",
      [senderId, hourlyWindow]
    );

    if (dedupeCheck.rows.length > 0) {
      return false;
    }

    const integrationRes = await query<SlackIntegration>(
      "SELECT * FROM slack_integrations WHERE user_id = $1 AND is_connected = true",
      [userId]
    );

    if (integrationRes.rows.length === 0) {
      return false;
    }

    const integration = integrationRes.rows[0];
    const decryptedToken = decryptToken(integration.access_token_encrypted);
    const client = new WebClient(decryptedToken);

    let targetChannel = integration.channel_id;
    if (!targetChannel) {
      try {
        const convos = await client.conversations.list({
          types: "public_channel,private_channel",
          limit: 20
        });
        const memberChannel = convos.channels?.find((c) => c.is_member);
        const generalChannel = convos.channels?.find((c) => c.name === "general");
        targetChannel = memberChannel?.id || generalChannel?.id || convos.channels?.[0]?.id || "general";
      } catch {
        targetChannel = "general";
      }
    }

    const formattedTime = rescheduledTo.toISOString();
    const text = `*Rate Limit Reached Alert*\nSender *${senderEmail}* has reached the hourly limit of *${limit}* emails for window *${hourlyWindow}*.\nRemaining queued emails have been automatically rescheduled to start at *${formattedTime}*.`;

    try {
      await client.chat.postMessage({
        channel: targetChannel,
        text
      });
    } catch (postErr: any) {
      if (postErr.data?.error === "not_in_channel") {
        try {
          await client.conversations.join({ channel: targetChannel });
          await client.chat.postMessage({
            channel: targetChannel,
            text
          });
        } catch {
          throw postErr;
        }
      } else {
        throw postErr;
      }
    }

    const notifId = crypto.randomUUID();
    await query(
      "INSERT INTO rate_limit_notifications (id, sender_id, hourly_window, sent_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (sender_id, hourly_window) DO NOTHING",
      [notifId, senderId, hourlyWindow]
    );

    return true;
  } catch (err: any) {
    console.error("Slack rate limit alert dispatch failed:", err?.message || "Unknown error");
    return false;
  }
}
