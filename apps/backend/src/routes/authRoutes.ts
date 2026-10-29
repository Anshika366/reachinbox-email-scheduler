import { Router, Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { config } from "../config/index.js";
import { query } from "../db/index.js";
import { User, Sender } from "../types/index.js";

const router = Router();

router.get("/google/url", (req: Request, res: Response) => {
  if (!config.google.clientId) {
    res.status(400).json({ error: "Google OAuth credentials not configured" });
    return;
  }

  const state = crypto.randomBytes(16).toString("hex");
  (req.session as any).oauthState = state;

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent"
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url });
});

router.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!code || typeof code !== "string") {
    res.redirect(`${config.clientUrl}/login?error=missing_code`);
    return;
  }

  const savedState = (req.session as any)?.oauthState;
  if (savedState && state && savedState !== state) {
    res.redirect(`${config.clientUrl}/login?error=invalid_state`);
    return;
  }

  try {
    const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.callbackUrl,
      grant_type: "authorization_code"
    });

    const accessToken = tokenRes.data.access_token;
    const userinfoRes = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const googleUser = userinfoRes.data;
    const googleId = googleUser.id;
    const email = googleUser.email;
    const name = googleUser.name || email.split("@")[0];
    const avatarUrl = googleUser.picture || null;

    let userRes = await query<User>("SELECT * FROM users WHERE google_id = $1 OR email = $2", [
      googleId,
      email
    ]);

    let user: User;

    if (userRes.rows.length === 0) {
      const newUserId = crypto.randomUUID();
      const insertRes = await query<User>(
        `INSERT INTO users (id, google_id, email, name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING *`,
        [newUserId, googleId, email, name, avatarUrl]
      );
      user = insertRes.rows[0];

      const senderId = crypto.randomUUID();
      await query(
        `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [senderId, user.id, email, name, config.maxEmailsPerHourPerSender]
      );
    } else {
      user = userRes.rows[0];
      await query(
        "UPDATE users SET google_id = $1, name = $2, avatar_url = $3, updated_at = NOW() WHERE id = $4",
        [googleId, name, avatarUrl, user.id]
      );
    }

    (req.session as any).userId = user.id;
    res.redirect(`${config.clientUrl}/`);
  } catch {
    res.redirect(`${config.clientUrl}/login?error=auth_failed`);
  }
});

router.get("/me", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    res.status(401).json({ user: null });
    return;
  }

  const userRes = await query<User>("SELECT * FROM users WHERE id = $1", [userId]);
  if (userRes.rows.length === 0) {
    res.status(401).json({ user: null });
    return;
  }

  const user = userRes.rows[0];
  const sendersRes = await query<Sender>("SELECT * FROM senders WHERE user_id = $1", [userId]);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url
    },
    senders: sendersRes.rows
  });
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, key] = storedHash.split(":");
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return keyBuffer.length === derivedKey.length && crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Please enter a valid email address" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    let userRes = await query<User>("SELECT * FROM users WHERE email = $1", [cleanEmail]);
    let user: User;

    if (userRes.rows.length === 0) {
      const newUserId = crypto.randomUUID();
      const name = cleanEmail.split("@")[0];
      const passwordHash = hashPassword(password);
      const insertRes = await query<User>(
        `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING *`,
        [newUserId, cleanEmail, name, passwordHash]
      );
      user = insertRes.rows[0];

      const senderId = crypto.randomUUID();
      await query(
        `INSERT INTO senders (id, user_id, email, name, hourly_limit, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [senderId, user.id, cleanEmail, name, config.maxEmailsPerHourPerSender]
      );
    } else {
      user = userRes.rows[0];
      if (user.password_hash) {
        const isValid = verifyPassword(password, user.password_hash);
        if (!isValid) {
          res.status(401).json({ error: "Invalid email or password" });
          return;
        }
      } else {
        const newHash = hashPassword(password);
        await query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
          newHash,
          user.id
        ]);
      }
    }

    (req.session as any).userId = user.id;
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

if (config.nodeEnv !== "production") {
  router.get("/dev-login", async (req: Request, res: Response) => {
    const target = (req.query.email || req.query.userId || "anshikapathak25@navgurukul.org") as string;
    const userRes = await query<User>("SELECT * FROM users WHERE email = $1 OR id = $1 LIMIT 1", [target]);
    if (userRes.rows.length > 0) {
      (req.session as any).userId = userRes.rows[0].id;
      res.redirect(`${config.clientUrl}/`);
    } else {
      res.status(404).send("User not found");
    }
  });
}

export default router;
