import type { Request } from "express";
import rateLimit from "express-rate-limit";

const buildLimiter = (
  max: number,
  windowMs: number,
  message: string,
  keyGenerator?: (req: Request) => string
) =>
  rateLimit({
    windowMs,
    max,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: "RATE_LIMITED",
        message,
      },
    },
  });

// Per IP, generous: many Kenyan mobile users share one carrier (CGNAT) IP address.
export const apiLimiter = buildLimiter(1200, 15 * 60 * 1000, "Too many requests, retry later.");
// Per signed-in user, applied by requireAuth after the token is verified (a forged token
// can't pick its own bucket).
export const userLimiter = buildLimiter(
  300,
  15 * 60 * 1000,
  "Too many requests, retry later.",
  (req) => `user:${req.auth?.uid ?? req.ip ?? "unknown"}`
);
// Applied only to credential endpoints (register, password reset/change, delete), not to
// /auth/me or preferences: many Kenyan mobile users share one carrier (CGNAT) IP.
export const authLimiter = buildLimiter(40, 15 * 60 * 1000, "Too many auth requests, retry later.");
// Login is keyed per IP + email so one account can't be brute-forced, while users who
// share an IP don't exhaust each other's attempts.
export const loginLimiter = buildLimiter(
  10,
  15 * 60 * 1000,
  "Too many sign-in attempts for this account, retry later.",
  (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${req.ip ?? "unknown"}:${email}`;
  }
);
export const paymentLimiter = buildLimiter(20, 15 * 60 * 1000, "Too many payment requests, retry later.");
