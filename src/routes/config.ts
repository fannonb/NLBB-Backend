import { Router } from "express";
import { getPublicReleaseConfig } from "../config/features";

export const configRouter = Router();

configRouter.get("/public", (_req, res) => {
  res.json({
    success: true,
    data: getPublicReleaseConfig(),
  });
});
