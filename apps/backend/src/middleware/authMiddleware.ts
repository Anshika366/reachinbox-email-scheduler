import { Request, Response, NextFunction } from "express";
import { query } from "../db/index.js";
import { User } from "../types/index.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = (req.session as any)?.userId;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await query<User>("SELECT * FROM users WHERE id = $1", [userId]);
  if (result.rows.length === 0) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  req.user = result.rows[0];
  next();
}
