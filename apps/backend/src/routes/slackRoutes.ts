import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { getSlackOAuthUrl, exchangeSlackCode, getSlackStatus, disconnectSlack } from "../services/slackService.js";
import { config } from "../config/index.js";

const router = Router();

router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error || !code || !state || typeof code !== "string" || typeof state !== "string") {
    res.redirect(`${config.clientUrl}/?slack_error=cancelled`);
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
  } catch {
    res.redirect(`${config.clientUrl}/?slack_error=exchange_failed`);
  }
});

router.get("/url", requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const url = getSlackOAuthUrl(userId);
  res.json({ url });
});

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const status = await getSlackStatus(userId);
  res.json(status);
});

router.post("/disconnect", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await disconnectSlack(userId);
  res.json({ success: true });
});

export default router;
