import { Router } from "express";
import { getMarketplaceRepository } from "../repositories/marketplace";
import { asyncHandler } from "../utils/asyncHandler";

export const categoriesRouter = Router();

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await getMarketplaceRepository().listCategories();
    res.json({ success: true, data: categories });
  })
);
