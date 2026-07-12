import rateLimit from "express-rate-limit";

const buildLimiter = (max: number, windowMs: number, message: string) =>
  rateLimit({
    windowMs,
    max,
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

export const apiLimiter = buildLimiter(300, 15 * 60 * 1000, "Too many requests, retry later.");
export const authLimiter = buildLimiter(40, 15 * 60 * 1000, "Too many auth requests, retry later.");
export const paymentLimiter = buildLimiter(20, 15 * 60 * 1000, "Too many payment requests, retry later.");
