import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthRequest } from "../lib/auth-types";

const JWT_SECRET = process.env.JWT_SECRET || "reles-dev-secret-change-me";

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { uid: string };
    req.uid = payload.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signToken(uid: string): string {
  return jwt.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });
}
