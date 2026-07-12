import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notificationPgService";
import { asyncHandler } from "../utils/asyncHandler";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const notifications = await listNotifications(req.auth!.uid);
    res.json({ success: true, data: notifications });
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
