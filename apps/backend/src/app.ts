import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";
import basicAuth from "express-basic-auth";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { config } from "./config/index.js";
import { emailQueue } from "./queues/emailQueue.js";
import authRoutes from "./routes/authRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import senderRoutes from "./routes/senderRoutes.js";
import slackRoutes from "./routes/slackRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";

export const app = express();

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: config.clientUrl,
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter
});

app.use("/admin/queues", (req: Request, res: Response, next: NextFunction) => {
  const { user, pass } = config.bullBoard;
  const isInsecureDefault = config.nodeEnv === "production" && (pass === "adminpassword" || pass === "password" || pass.length < 8);

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Bull Board"');
    res.status(401).send("Authentication required");
    return;
  }

  if (!user || !pass || isInsecureDefault) {
    res.status(403).send("Queue dashboard access is disabled because default or weak credentials are detected. Configure a secure non-default BULL_BOARD_PASS (at least 8 characters) in environment variables.");
    return;
  }

  const authMiddleware = basicAuth({
    users: { [user]: pass },
    challenge: true
  });

  authMiddleware(req, res, next);
});

app.use("/admin/queues", serverAdapter.getRouter());

app.use("/api/auth", authRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/senders", senderRoutes);
app.use("/api/integrations/slack", slackRoutes);
app.use("/api/health", healthRoutes);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ error: message });
});
