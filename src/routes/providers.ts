import { Router } from "express";
import { z } from "zod";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth";
import { getProviderById, listProviders } from "../services/providerService";
import {
  addProviderService,
  createProviderServiceSchema,
  deleteProviderService,
  getProviderByOwnerUid,
  listProviderServices,
  registrationDetailsSchema,
  setProviderOpenState,
  setProviderServiceActive,
  setProviderServiceActiveSchema,
  updateProviderRegistrationDetails,
  updateProviderService,
  updateProviderServiceSchema,
  upsertProviderProfile,
  upsertProviderSchema,
} from "../services/providerManagementPgService";
import { ApiError } from "../utils/apiError";
import { listReviewsForProvider } from "../services/reviewPgService";
import { asyncHandler } from "../utils/asyncHandler";
import { uploadProviderMedia } from "../services/mediaStorageService";

export const providersRouter = Router();

const uploadMediaSchema = z.object({
  kind: z.enum(["cover", "avatar", "gallery"]),
  dataUri: z.string().min(16),
});

providersRouter.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const querySchema = z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      onlySubscribed: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => {
          if (v === undefined) {
            return undefined;
          }

          return v === "true";
        }),
    });

    const query = querySchema.parse(req.query);
    const providers = await listProviders(
      {
        search: query.search,
        category: query.category,
        onlySubscribed: query.onlySubscribed,
      },
      req.auth
    );
    res.json({ success: true, data: providers });
  })
);

providersRouter.get(
  "/me/profile",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const provider = await getProviderByOwnerUid(req.auth!.uid);
    res.json({ success: true, data: provider });
  })
);

providersRouter.post(
  "/me/profile",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = upsertProviderSchema.parse(req.body);
    const provider = await upsertProviderProfile(req.auth!.uid, payload);
    res.status(201).json({ success: true, data: provider });
  })
);

providersRouter.post(
  "/me/registration-details",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = registrationDetailsSchema.parse(req.body);
    const provider = await updateProviderRegistrationDetails(req.auth!.uid, payload);
    res.status(201).json({ success: true, data: provider });
  })
);

providersRouter.post(
  "/me/media",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = uploadMediaSchema.parse(req.body);
    const uploaded = await uploadProviderMedia(req.auth!.uid, payload.kind, payload.dataUri);
    res.status(201).json({
      success: true,
      data: {
        url: uploaded.publicUrl,
        storageKey: uploaded.storageKey,
      },
    });
  })
);

providersRouter.patch(
  "/me/open-state",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const body = z.object({ isOpen: z.boolean() }).parse(req.body);
    const provider = await getProviderByOwnerUid(req.auth!.uid);
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: { code: "PROVIDER_NOT_FOUND", message: "Provider profile missing" },
      });
    }
    const updated = await setProviderOpenState(provider.id, body.isOpen);
    res.json({ success: true, data: updated });
  })
);

providersRouter.get(
  "/me/services",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const services = await listProviderServices(req.auth!.uid);
    res.json({ success: true, data: services });
  })
);

providersRouter.post(
  "/me/services",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = createProviderServiceSchema.parse(req.body);
    const service = await addProviderService(req.auth!.uid, payload);
    res.status(201).json({ success: true, data: service });
  })
);

providersRouter.patch(
  "/me/services/:serviceId",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = updateProviderServiceSchema.parse(req.body);
    const service = await updateProviderService(req.auth!.uid, req.params.serviceId, payload);
    res.json({ success: true, data: service });
  })
);

providersRouter.patch(
  "/me/services/:serviceId/active",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const payload = setProviderServiceActiveSchema.parse(req.body);
    const service = await setProviderServiceActive(
      req.auth!.uid,
      req.params.serviceId,
      payload.isActive
    );
    res.json({ success: true, data: service });
  })
);

providersRouter.delete(
  "/me/services/:serviceId",
  requireAuth,
  requireRole("provider", "admin"),
  asyncHandler(async (req, res) => {
    const result = await deleteProviderService(req.auth!.uid, req.params.serviceId);
    res.json({ success: true, data: result });
  })
);

providersRouter.get(
  "/:providerId/reviews",
  asyncHandler(async (req, res) => {
    const reviews = await listReviewsForProvider(req.params.providerId);
    res.json({ success: true, data: reviews });
  })
);

providersRouter.get(
  "/:providerId",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const provider = await getProviderById(req.params.providerId, req.auth);
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: { code: "PROVIDER_NOT_FOUND", message: "Provider not found" },
      });
    }
    res.json({ success: true, data: provider });
  })
);
