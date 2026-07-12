import { Router } from "express";
import { getAdminOverview, getProviderAnalytics } from "../services/analyticsPgService";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

export const analyticsRouter = Router();

analyticsRouter.get(
  "/provider/me",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const analytics = await getProviderAnalytics(req.auth!.uid);
    res.json({ success: true, data: analytics });
  })
);

analyticsRouter.get(
  "/admin/overview",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const overview = await getAdminOverview();
    res.json({ success: true, data: overview });
  })
);
