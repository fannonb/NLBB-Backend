import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  createReview,
  createReviewSchema,
  listReviewsForProvider,
  listReviewsForProviderOwner,
} from "../services/reviewPgService";
import { asyncHandler } from "../utils/asyncHandler";

export const reviewsRouter = Router();

reviewsRouter.get(
  "/provider/:providerId",
  asyncHandler(async (req, res) => {
    const reviews = await listReviewsForProvider(req.params.providerId);
    res.json({ success: true, data: reviews });
  })
);

reviewsRouter.get(
  "/provider/me",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const reviews = await listReviewsForProviderOwner(req.auth!.uid);
    res.json({ success: true, data: reviews });
  })
);

reviewsRouter.post(
  "/",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const payload = createReviewSchema.parse(req.body);
    const review = await createReview(req.auth!.uid, payload);
    res.status(201).json({ success: true, data: review });
  })
);
