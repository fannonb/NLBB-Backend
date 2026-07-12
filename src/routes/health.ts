import { Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { asyncHandler } from "../utils/asyncHandler";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "nlbb-backend",
      timestamp: new Date().toISOString(),
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
