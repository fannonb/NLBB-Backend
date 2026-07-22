import { eq, ne } from "drizzle-orm";
import { getDb } from "../db/client";
import { providerSubscriptions, providers } from "../db/schema";
import { createNotification, notificationExistsByActionId } from "./notificationPgService";
import { normalizeSubscriptionStatus } from "./subscriptionPgService";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAY_MARKERS = [7, 3, 1] as const;

const expiryDateKey = (expiry: Date) => expiry.toISOString().slice(0, 10);

const daysUntil = (expiry: Date, now: Date) =>
  Math.floor((expiry.getTime() - now.getTime()) / DAY_MS);

/**
 * Sends renewal reminders at 7 / 3 / 1 days before expiry, and a one-time
 * expired notice. Deduped per renewal cycle via actionId.
 */
export const processSubscriptionReminders = async () => {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      providerId: providerSubscriptions.providerId,
      status: providerSubscriptions.status,
      renewalAt: providerSubscriptions.renewalAt,
      expiresAt: providerSubscriptions.expiresAt,
      ownerUserId: providers.ownerUserId,
    })
    .from(providerSubscriptions)
    .innerJoin(providers, eq(providers.id, providerSubscriptions.providerId))
    .where(ne(providers.adminStatus, "deleted"));

  let remindersSent = 0;
  let expiredNoticesSent = 0;

  for (const row of rows) {
    const expiry = row.expiresAt ?? row.renewalAt;
    if (!expiry || !row.ownerUserId) {
      continue;
    }

    const ownerUserId = row.ownerUserId;
    const remainingDays = daysUntil(expiry, now);
    const cycleKey = expiryDateKey(expiry);

    if (remainingDays <= 0 || row.status === "expired") {
      await normalizeSubscriptionStatus(row.providerId);

      const actionId = `subscription_expired:${cycleKey}`;
      if (!(await notificationExistsByActionId(ownerUserId, actionId))) {
        await createNotification({
          userId: ownerUserId,
          title: "Subscription Expired",
          body: "Your listing is no longer visible to customers. Renew with M-Pesa to restore visibility.",
          type: "subscription",
          actionType: "provider_subscription",
          actionId,
        });
        expiredNoticesSent += 1;
      }
      continue;
    }

    if (row.status !== "active") {
      continue;
    }

    for (const marker of REMINDER_DAY_MARKERS) {
      if (remainingDays !== marker) {
        continue;
      }

      const actionId = `subscription_reminder:${marker}d:${cycleKey}`;
      if (await notificationExistsByActionId(ownerUserId, actionId)) {
        continue;
      }

      const dayLabel = marker === 1 ? "1 day" : `${marker} days`;
      await createNotification({
        userId: ownerUserId,
        title: "Subscription Renewing Soon",
        body: `Your subscription expires in ${dayLabel}. Pay via M-Pesa now to keep your listing visible to customers.`,
        type: "subscription",
        actionType: "provider_subscription",
        actionId,
      });
      remindersSent += 1;
    }
  }

  return { scanned: rows.length, remindersSent, expiredNoticesSent };
};

let reminderTimer: ReturnType<typeof setInterval> | null = null;
let reminderRunning = false;

export const startSubscriptionReminderScheduler = (intervalMs = 60 * 60 * 1000) => {
  if (reminderTimer) {
    return;
  }

  const tick = async () => {
    if (reminderRunning) {
      return;
    }
    reminderRunning = true;
    try {
      const result = await processSubscriptionReminders();
      if (result.remindersSent > 0 || result.expiredNoticesSent > 0) {
        console.log("[subscriptions] reminder job", result);
      }
    } catch (error) {
      console.error("[subscriptions] reminder job failed:", error);
    } finally {
      reminderRunning = false;
    }
  };

  // Run shortly after boot, then on the interval.
  setTimeout(() => {
    void tick();
  }, 15_000);
  reminderTimer = setInterval(() => {
    void tick();
  }, intervalMs);
};
