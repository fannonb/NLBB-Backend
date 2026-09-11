import { Router } from "express";
import { getPublicReleaseConfig } from "../config/features";
import { getPlatformSettings } from "../services/subscriptionPgService";
import { asyncHandler } from "../utils/asyncHandler";

export const configRouter = Router();

configRouter.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const settings = await getPlatformSettings();
    const config = getPublicReleaseConfig();
    res.json({
      success: true,
      data: {
        ...config,
        featureFlags: {
          ...config.featureFlags,
          subscriptionsPaused: settings.subscriptionsPaused,
        },
      },
    });
  })
);
