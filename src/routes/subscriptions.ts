import { Router } from "express";
import { z } from "zod";
import { assertMpesaPaymentsEnabled } from "../config/features";
import { requireAuth, requireRole } from "../middleware/auth";
import { paymentLimiter } from "../middleware/rateLimiters";
import { initiateMpesaStkPush, reconcilePendingPaymentsForProvider } from "../services/paymentPgService";
import { getProviderIdByOwnerUid, getSubscription } from "../services/subscriptionPgService";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";

export const subscriptionsRouter = Router();

subscriptionsRouter.get(
  "/me",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const providerId = await getProviderIdByOwnerUid(req.auth!.uid);
    if (!providerId) {
      throw new ApiError(404, "Provider profile not found", "PROVIDER_NOT_FOUND");
    }

    const shouldReconcile = req.query.reconcile === "true";
    if (shouldReconcile) {
      await reconcilePendingPaymentsForProvider(providerId);
    }

    const subscription = await getSubscription(providerId);
    res.json({ success: true, data: subscription });
  })
);

subscriptionsRouter.post(
  "/me/pay",
  paymentLimiter,
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    assertMpesaPaymentsEnabled();
    const payload = z.object({ phoneNumber: z.string().min(9) }).parse(req.body);
    const providerId = await getProviderIdByOwnerUid(req.auth!.uid);
    if (!providerId) {
      throw new ApiError(404, "Provider profile not found", "PROVIDER_NOT_FOUND");
    }
    const result = await initiateMpesaStkPush({
      providerId,
      phoneNumber: payload.phoneNumber,
    });
    res.status(202).json({ success: true, data: result });
  })
);
