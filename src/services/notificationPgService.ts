import axios from "axios";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { notifications } from "../db/schema";
import type { Notification } from "../types/domain";
import { getPushTokensForUser } from "./userService";

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_RECEIPTS_API_URL = "https://exp.host/--/api/v2/push/getReceipts";

interface CreateNotificationInput {
  userId: string;
  title: string;
  body: string;
  type: Notification["type"];
  actionType?: Notification["actionType"];
  actionId?: string;
}

interface PushNotificationPayload {
  notificationId: string;
  type: Notification["type"];
  actionType?: Notification["actionType"];
  actionId?: string;
}

export const createNotification = async (input: CreateNotificationInput) => {
  const db = getDb();
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionType: input.actionType ?? null,
      actionId: input.actionId ?? null,
      isRead: false,
      createdAt: new Date(),
    })
    .returning();

  const tokens = await getPushTokensForUser(input.userId).catch(() => []);
  if (tokens.length > 0) {
    await sendPushNotification(tokens, {
      title: input.title,
      body: input.body,
      data: {
        notificationId: notification.id,
        type: notification.type as Notification["type"],
        actionType: (notification.actionType as Notification["actionType"] | null) ?? undefined,
        actionId: notification.actionId ?? undefined,
      },
    });
  }

  return {
    id: notification.id,
    userId: notification.userId,
    title: notification.title,
    body: notification.body,
    type: notification.type as Notification["type"],
    actionType: (notification.actionType as Notification["actionType"] | null) ?? undefined,
    actionId: notification.actionId ?? undefined,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  } satisfies Notification;
};

export const listNotifications = async (userId: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    title: row.title,
    body: row.body,
    type: row.type as Notification["type"],
    actionType: (row.actionType as Notification["actionType"] | null) ?? undefined,
    actionId: row.actionId ?? undefined,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  }));
};

export const markNotificationRead = async (notificationId: string, userId: string) => {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .limit(1);
  if (!existing) {
    return null;
  }

  const [updated] = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(notifications.id, notificationId))
    .returning();

  return {
    id: updated.id,
    userId: updated.userId,
    title: updated.title,
    body: updated.body,
    type: updated.type as Notification["type"],
    actionType: (updated.actionType as Notification["actionType"] | null) ?? undefined,
    actionId: updated.actionId ?? undefined,
    isRead: updated.isRead,
    createdAt: updated.createdAt.toISOString(),
  } satisfies Notification;
};

export const markAllNotificationsRead = async (userId: string) => {
  const db = getDb();
  const updated = await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });
  return { updated: updated.length };
};

const isExpoPushToken = (token: string) =>
  token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");

export const sendPushNotification = async (
  tokens: string[],
  payload: {
    title: string;
    body: string;
    data: PushNotificationPayload;
  }
) => {
  const validTokens = tokens.filter(isExpoPushToken);
  if (validTokens.length === 0) {
    return { sent: false };
  }

  try {
    const response = await axios.post(
      EXPO_PUSH_API_URL,
      validTokens.map((to) => ({
        to,
        title: payload.title,
        body: payload.body,
        sound: "default",
        channelId: "default",
        data: payload.data,
      })),
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
        },
      }
    );

    const tickets = Array.isArray(response.data?.data) ? response.data.data : [];
    const failedTickets = tickets.filter((ticket: { status?: string }) => ticket?.status === "error");
    if (failedTickets.length > 0) {
      console.warn("[push] Expo push service returned ticket errors", failedTickets);
    }

    const receiptIds = tickets
      .map((ticket: { id?: string; status?: string }) => (ticket?.status === "ok" ? ticket.id : null))
      .filter((id: string | null): id is string => Boolean(id));

    if (receiptIds.length > 0) {
      setTimeout(() => {
        void axios
          .post(
            EXPO_PUSH_RECEIPTS_API_URL,
            { ids: receiptIds },
            {
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "Accept-encoding": "gzip, deflate",
              },
            }
          )
          .then((receiptResponse) => {
            const receipts = receiptResponse.data?.data ?? {};
            const failedReceipts = Object.entries(receipts).filter(([, receipt]) => {
              const status = (receipt as { status?: string } | undefined)?.status;
              return status && status !== "ok";
            });

            if (failedReceipts.length > 0) {
              console.warn("[push] Expo push receipts returned errors", failedReceipts);
            }
          })
          .catch((error) => {
            console.warn("[push] Failed to fetch Expo push receipts", error);
          });
      }, 1500);
    }

    return { sent: true, attempted: validTokens.length, failedTickets: failedTickets.length };
  } catch (error) {
    console.warn("[push] Failed to send Expo push notification", error);
    return { sent: false };
  }
};
