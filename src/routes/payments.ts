import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { verifyMpesaCallback } from "../middleware/callbackAuth";
import { paymentLimiter } from "../middleware/rateLimiters";
import { listProviderPayments, processMpesaCallback } from "../services/paymentPgService";
import { getProviderIdByOwnerUid } from "../services/subscriptionPgService";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";

export const paymentsRouter = Router();

paymentsRouter.get(
  "/me",
  paymentLimiter,
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const providerId = await getProviderIdByOwnerUid(req.auth!.uid);
    if (!providerId) {
      throw new ApiError(404, "Provider profile not found", "PROVIDER_NOT_FOUND");
    }
    const payments = await listProviderPayments(providerId);
    res.json({ success: true, data: payments });
  })
);

paymentsRouter.post(
  "/mpesa/callback",
  verifyMpesaCallback,
  asyncHandler(async (req, res) => {
    const result = await processMpesaCallback(req.body);
    res.json({ success: true, data: result });
  })
);
