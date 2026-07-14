import { Router } from "express";
import { z } from "zod";
import { requireAdminAccess } from "../middleware/auth";
import {
  createAdminCategory,
  getAdminDashboardData,
  getAdminRevenueReport,
  listAdminCategories,
  listAdminProviders,
  listAdminUsers,
  softDeleteAdminUser,
  updateAdminUserStatus,
  updateAdminCategory,
  updateProviderAdminStatus,
  deleteAdminProvider,
} from "../services/adminPgService";
import { CATEGORY_ICON_VALUES } from "../constants/categoryIcons";
import { asyncHandler } from "../utils/asyncHandler";

export const adminRouter = Router();

adminRouter.use(requireAdminAccess);

const categoryIconSchema = z.enum(CATEGORY_ICON_VALUES);
const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  icon: categoryIconSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
});
const categoryUpdateSchema = categoryCreateSchema.partial().refine(
  (payload) => Object.keys(payload).length > 0,
  "At least one category field is required"
);

adminRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await listAdminCategories() });
  })
);

adminRouter.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const category = await createAdminCategory(categoryCreateSchema.parse(req.body), req.auth!.uid);
    res.status(201).json({ success: true, data: category });
  })
);

adminRouter.patch(
  "/categories/:categoryId",
  asyncHandler(async (req, res) => {
    const category = await updateAdminCategory(
      req.params.categoryId,
      categoryUpdateSchema.parse(req.body),
      req.auth!.uid
    );
    if (!category) {
      return res.status(404).json({
        success: false,
        error: { code: "CATEGORY_NOT_FOUND", message: "Category not found" },
      });
    }
    res.json({ success: true, data: category });
  })
);

adminRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const data = await getAdminDashboardData();
    res.json({ success: true, data });
  })
);

adminRouter.get(
  "/providers",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        status: z.string().optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    const providers = await listAdminProviders({
      status: query.status,
      query: query.q,
    });
    res.json({ success: true, data: providers });
  })
);

adminRouter.patch(
  "/providers/:providerId/status",
  asyncHandler(async (req, res) => {
    const payload = z
      .object({ status: z.enum(["pending", "approved", "suspended"]) })
      .parse(req.body);
    const provider = await updateProviderAdminStatus(
      req.params.providerId,
      payload.status,
      req.auth!.uid
    );
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: "Provider not found",
        },
      });
    }
    res.json({ success: true, data: provider });
  })
);

adminRouter.patch(
  "/providers/:providerId/verify",
  asyncHandler(async (req, res) => {
    const payload = z.object({ isVerified: z.boolean() }).parse(req.body);
    const provider = await updateProviderAdminStatus(
      req.params.providerId,
      payload.isVerified ? "approved" : "pending",
      req.auth!.uid
    );
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: "Provider not found",
        },
      });
    }
    res.json({ success: true, data: provider });
  })
);

adminRouter.delete(
  "/providers/:providerId",
  asyncHandler(async (req, res) => {
    const result = await deleteAdminProvider(req.params.providerId, req.auth!.uid);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: "Provider not found",
        },
      });
    }
    res.json({ success: true, data: result });
  })
);

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        status: z.string().optional(),
        q: z.string().optional(),
      })
      .parse(req.query);
    const users = await listAdminUsers({
      status: query.status,
      query: query.q,
    });
    res.json({ success: true, data: users });
  })
);

adminRouter.patch(
  "/users/:userId/status",
  asyncHandler(async (req, res) => {
    const payload = z.object({ status: z.enum(["active", "disabled"]) }).parse(req.body);
    const user = await updateAdminUserStatus(req.params.userId, payload.status, req.auth!.uid);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    res.json({ success: true, data: user });
  })
);

adminRouter.delete(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const result = await softDeleteAdminUser(req.params.userId, req.auth!.uid);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    res.json({ success: true, data: result });
  })
);

adminRouter.get(
  "/revenue",
  asyncHandler(async (_req, res) => {
    const data = await getAdminRevenueReport();
    res.json({ success: true, data });
  })
);
