import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { getSlackOAuthUrl, exchangeSlackCode, getSlackStatus, disconnectSlack, isSlackConfigured } from "../services/slackService.js";
import { config } from "../config/index.js";

const router = Router();

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (!isSlackConfigured()) {
    res.redirect(`${config.clientUrl}/?slack_error=not_configured`);
    return;
  }

  if (error || !code || !state || typeof code !== "string" || typeof state !== "string") {
    res.redirect(`${config.clientUrl}/?slack_error=${encodeURIComponent(String(error || "cancelled"))}`);
    return;
  }

  try {
    const decodedState = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    const userId = decodedState.userId;

    if (!userId) {
      res.redirect(`${config.clientUrl}/?slack_error=invalid_state`);
      return;
    }

    await exchangeSlackCode(code, userId);
    res.redirect(`${config.clientUrl}/?slack_connected=true`);
  } catch (err: any) {
    console.error("[Slack] Code exchange failed:", err?.message || err);
    res.redirect(`${config.clientUrl}/?slack_error=${encodeURIComponent(err?.message || "exchange_failed")}`);
  }
});

router.get("/connect", (req: Request, res: Response) => {
  if (!isSlackConfigured()) {
    res.redirect(`${config.clientUrl}/?slack_error=not_configured`);
    return;
  }

  const userId = req.user?.id || (req.session as any)?.userId || (req.query.userId as string);
  if (!userId) {
    res.redirect(`${config.clientUrl}/login?error=auth_required`);
    return;
  }
  const url = getSlackOAuthUrl(userId);
  res.redirect(url);
});

router.get("/url", requireAuth, (req: Request, res: Response) => {
  if (!isSlackConfigured()) {
    res.status(503).json({ error: "Slack integration is not configured on this server" });
    return;
  }

  try {
    const userId = req.user?.id || (req.session as any)?.userId || (req.query.userId as string);
    if (!userId) {
      res.status(401).json({ error: "Please log in first" });
      return;
    }
    const url = getSlackOAuthUrl(userId);
    res.json({ url });
  } catch (err: any) {
    console.error("[Slack] Failed to generate OAuth URL:", err);
    res.status(500).json({ error: err?.message || "Failed to generate Slack authorization URL" });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  if (!isSlackConfigured()) {
    res.json({ isConnected: false, isConfigured: false });
    return;
  }

  const userId = req.user?.id || (req.session as any)?.userId || (req.query.userId as string);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const status = await getSlackStatus(userId);
    res.json({ ...status, isConfigured: true });
  } catch {
    res.json({ isConnected: false, isConfigured: true });
  }
});

router.post("/disconnect", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    await disconnectSlack(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to disconnect Slack" });
  }
});

export default router;
