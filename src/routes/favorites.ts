import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  addFavoriteProvider,
  listFavoriteProviders,
  removeFavoriteProvider,
  upsertFavoriteSchema,
} from "../services/favoritePgService";
import { asyncHandler } from "../utils/asyncHandler";

export const favoritesRouter = Router();

favoritesRouter.get(
  "/me",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const favorites = await listFavoriteProviders(req.auth!.uid);
    res.json({ success: true, data: favorites });
  })
);

favoritesRouter.post(
  "/me",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const payload = upsertFavoriteSchema.parse(req.body);
    const favorite = await addFavoriteProvider(req.auth!.uid, payload.providerId);
    res.status(201).json({ success: true, data: favorite });
  })
);

favoritesRouter.delete(
  "/me/:providerId",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const result = await removeFavoriteProvider(req.auth!.uid, req.params.providerId);
    res.json({ success: true, data: result });
  })
);
