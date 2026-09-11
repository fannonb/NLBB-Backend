import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { platformSettings, providerSubscriptions, providers } from "../db/schema";
import { ApiError } from "../utils/apiError";
import { appendAdminLog } from "./adminPgService";
import { enforceBookingGateForProvider } from "./providerManagementPgService";
import {
  ensureDefaultPlan,
  freezeRemainingIfNeeded,
  getPlatformSettings,
  getSubscription,
  invalidatePlatformSettingsCache,
  restoreExpiryIfUnpaused,
  SETTINGS_ID,
} from "./subscriptionPgService";
import { remainingMs } from "./subscriptionAccess";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toActorUserId = (value?: string | null) => {
  if (!value || !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
};

const trimReason = (reason?: string | null) => {
  const value = reason?.trim() ?? "";
  return value.length > 0 ? value.slice(0, 500) : null;
};

const ensureSubscriptionRow = async (providerId: string) => {
  const db = getDb();
  const [existing] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);
  if (existing) {
    return existing;
  }

  const plan = await ensureDefaultPlan();
  const now = new Date();
  const [created] = await db
    .insert(providerSubscriptions)
    .values({
      providerId,
      planId: plan.id,
      status: "expired",
      startsAt: now,
      renewalAt: now,
      expiresAt: now,
      creditBalance: "0",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created!;
};

const enforceBookingGate = async (providerId: string) => {
  await enforceBookingGateForProvider(providerId);
};

const enforceBookingGates = async (providerIds: string[]) => {
  for (const providerId of providerIds) {
    await enforceBookingGate(providerId);
  }
};

export const pauseProviderSubscription = async (
  providerId: string,
  actorUid: string,
  reason?: string
) => {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider || provider.adminStatus === "deleted") {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }

  const now = new Date();
  let row = await ensureSubscriptionRow(providerId);
  row = await freezeRemainingIfNeeded(row, now);
  await db
    .update(providerSubscriptions)
    .set({
      pausedAt: now,
      pauseReason: trimReason(reason),
      pausedBy: toActorUserId(actorUid),
      remainingMsAtPause: row.remainingMsAtPause,
      updatedAt: now,
    })
    .where(eq(providerSubscriptions.id, row.id));

  await appendAdminLog({
    type: "subscription",
    text: `Subscription payments paused for ${provider.name}${reason ? `: ${trimReason(reason)}` : ""}`,
  });
  return getSubscription(providerId);
};

export const resumeProviderSubscription = async (providerId: string, actorUid: string) => {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider || provider.adminStatus === "deleted") {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }

  const settings = await getPlatformSettings();
  const [row] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);
  if (!row) {
    throw new ApiError(404, "No subscription found for this provider", "SUBSCRIPTION_NOT_FOUND");
  }

  const now = new Date();
  await db
    .update(providerSubscriptions)
    .set({
      pausedAt: null,
      pauseReason: null,
      pausedBy: null,
      updatedAt: now,
    })
    .where(eq(providerSubscriptions.id, row.id));

  const [cleared] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.id, row.id)).limit(1);
  if (cleared) {
    await restoreExpiryIfUnpaused(cleared, settings.subscriptionsPaused, now);
  }

  await enforceBookingGate(providerId);
  await appendAdminLog({
    type: "subscription",
    text: `Subscription payments reinstated for ${provider.name} by ${actorUid}`,
  });
  return getSubscription(providerId);
};

export const setGlobalSubscriptionPause = async (
  paused: boolean,
  actorUid: string,
  reason?: string
) => {
  const db = getDb();
  const current = await getPlatformSettings();
  const now = new Date();

  if (paused === current.subscriptionsPaused) {
    return getSubscriptionSettings();
  }

  if (paused) {
    const rows = await db.select().from(providerSubscriptions);
    for (const row of rows) {
      await freezeRemainingIfNeeded(row, now);
    }
    await db
      .update(platformSettings)
      .set({
        subscriptionsPaused: true,
        subscriptionsPausedAt: now,
        subscriptionsPauseReason: trimReason(reason),
        subscriptionsPausedBy: toActorUserId(actorUid),
        updatedAt: now,
      })
      .where(eq(platformSettings.id, SETTINGS_ID));
    invalidatePlatformSettingsCache();

    await appendAdminLog({
      type: "subscription",
      text: `Subscription payments paused for all providers${reason ? `: ${trimReason(reason)}` : ""}`,
    });
  } else {
    await db
      .update(platformSettings)
      .set({
        subscriptionsPaused: false,
        subscriptionsPausedAt: null,
        subscriptionsPauseReason: null,
        subscriptionsPausedBy: null,
        updatedAt: now,
      })
      .where(eq(platformSettings.id, SETTINGS_ID));
    invalidatePlatformSettingsCache();

    const rows = await db.select().from(providerSubscriptions);
    for (const row of rows) {
      await restoreExpiryIfUnpaused(row, false, now);
    }

    const allProviders = await db.select({ id: providers.id }).from(providers);
    await enforceBookingGates(allProviders.map((provider) => provider.id));

    await appendAdminLog({
      type: "subscription",
      text: `Subscription payments reinstated for all providers by ${actorUid}`,
    });
  }

  return getSubscriptionSettings();
};

export const getSubscriptionSettings = async () => {
  const settings = await getPlatformSettings();
  const db = getDb();
  const rows = await db.select().from(providerSubscriptions);
  const pausedAccounts = rows.filter((row) => row.pausedAt).length;
  const frozenPaid = rows.filter((row) => remainingMs(row, settings.subscriptionsPaused) > 0).length;

  return {
    subscriptionsPaused: settings.subscriptionsPaused,
    pausedAt: settings.subscriptionsPausedAt?.toISOString() ?? null,
    pauseReason: settings.subscriptionsPauseReason,
    pausedBy: settings.subscriptionsPausedBy,
    updatedAt: settings.updatedAt.toISOString(),
    pausedAccountCount: pausedAccounts,
    frozenPaidCount: frozenPaid,
  };
};
