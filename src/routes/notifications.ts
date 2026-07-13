import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notificationPgService";
import { asyncHandler } from "../utils/asyncHandler";

export const notificationsRouter = Router();

const testPushSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(180).optional(),
});

notificationsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const notifications = await listNotifications(req.auth!.uid);
    res.json({ success: true, data: notifications });
  })
);

notificationsRouter.post(
  "/test-push",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = testPushSchema.parse(req.body ?? {});
    const notification = await createNotification({
      userId: req.auth!.uid,
      type: "general",
      title: payload.title ?? "NLBB push test",
      body:
        payload.body ??
        "If you see this on your device, push notifications are working.",
    });

    res.status(201).json({
      success: true,
      data: notification,
    });
  })
);

notificationsRouter.patch(
  "/me/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await markAllNotificationsRead(req.auth!.uid);
    res.json({ success: true, data: result });
  })
);

notificationsRouter.patch(
  "/:notificationId/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const notification = await markNotificationRead(req.params.notificationId, req.auth!.uid);
    if (!notification) {
      return res.status(404).json({
        success: false,
        error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" },
      });
    }
    res.json({ success: true, data: notification });
  })
);
