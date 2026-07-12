import { Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { asyncHandler } from "../utils/asyncHandler";
import { getEmailDiagnostics, getEmailVerificationState } from "../services/emailService";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const email = getEmailDiagnostics();
  const verification = getEmailVerificationState();

  res.json({
    success: true,
    data: {
      status: "ok",
      service: "nlbb-backend",
      timestamp: new Date().toISOString(),
      email: {
        configured: email.configured,
        missing: email.missing,
        candidates: email.candidates,
        verification,
      },
    },
  });
});

healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    await getDb().execute(sql`select 1`);
    res.json({
      success: true,
      data: {
        status: "ready",
        timestamp: new Date().toISOString(),
      },
    });
  })
);
