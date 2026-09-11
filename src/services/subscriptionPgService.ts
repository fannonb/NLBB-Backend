import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { platformSettings, providerSubscriptions, providers, subscriptionPlans } from "../db/schema";
import type { Subscription, SubscriptionStatus } from "../types/domain";
import {
  isEffectivelyActive,
  pauseScopeFor,
  remainingDaysFromMs,
  remainingMs,
} from "./subscriptionAccess";

const DEFAULT_PLAN_CODE = "monthly";
const DEFAULT_PLAN_AMOUNT = 500;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SETTINGS_ID = "default";

const toMoney = (value: unknown) => Number(Number(value ?? 0).toFixed(2));

export type PlatformSubscriptionSettings = {
  id: string;
  subscriptionsPaused: boolean;
  subscriptionsPausedAt: Date | null;
  subscriptionsPauseReason: string | null;
  subscriptionsPausedBy: string | null;
  updatedAt: Date;
};

let settingsCache: { value: PlatformSubscriptionSettings; at: number } | null = null;
const SETTINGS_CACHE_MS = 1500;

const resetLegacyCreditBalance = async (providerId: string, creditBalance: unknown) => {
  if (toMoney(creditBalance) === 0) {
    return;
  }

  const db = getDb();
  await db
    .update(providerSubscriptions)
    .set({
      creditBalance: "0",
      updatedAt: new Date(),
    })
    .where(eq(providerSubscriptions.providerId, providerId));
};

const ensureDefaultPlan = async () => {
  const db = getDb();
  const [existing] = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.code, DEFAULT_PLAN_CODE)).limit(1);
  if (existing) {
    if (Number(existing.priceAmount) !== DEFAULT_PLAN_AMOUNT) {
      const [updated] = await db
        .update(subscriptionPlans)
        .set({
          priceAmount: DEFAULT_PLAN_AMOUNT.toString(),
        })
        .where(eq(subscriptionPlans.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [created] = await db
    .insert(subscriptionPlans)
    .values({
      code: DEFAULT_PLAN_CODE,
      name: "Monthly",
      billingPeriod: "monthly",
      priceAmount: DEFAULT_PLAN_AMOUNT.toString(),
      currency: "KES",
      isActive: true,
      createdAt: new Date(),
    })
    .returning();

  return created;
};

export const invalidatePlatformSettingsCache = () => {
  settingsCache = null;
};

export const getPlatformSettings = async (): Promise<PlatformSubscriptionSettings> => {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_CACHE_MS) {
    return settingsCache.value;
  }

  const db = getDb();
  const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.id, SETTINGS_ID)).limit(1);
  const row =
    existing ??
    (
      await db
        .insert(platformSettings)
        .values({
          id: SETTINGS_ID,
          subscriptionsPaused: false,
          updatedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning()
    )[0] ??
    (
      await db.select().from(platformSettings).where(eq(platformSettings.id, SETTINGS_ID)).limit(1)
    )[0];

  if (!row) {
    throw new Error("platform_settings row could not be created");
  }

  const value: PlatformSubscriptionSettings = {
    id: row.id,
    subscriptionsPaused: row.subscriptionsPaused,
    subscriptionsPausedAt: row.subscriptionsPausedAt,
    subscriptionsPauseReason: row.subscriptionsPauseReason,
    subscriptionsPausedBy: row.subscriptionsPausedBy,
    updatedAt: row.updatedAt,
  };
  settingsCache = { value, at: now };
  return value;
};

export const getProviderIdByOwnerUid = async (ownerUid: string) => {
  const db = getDb();
  const [provider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.ownerUserId, ownerUid)).limit(1);
  return provider?.id ?? null;
};

const resolveExpiryDate = (
  status: SubscriptionStatus,
  existing?: { renewalAt?: Date | null; expiresAt?: Date | null } | null,
  explicitRenewalDate?: string
) => {
  if (explicitRenewalDate) {
    return new Date(explicitRenewalDate);
  }

  if (status === "active") {
    return new Date(Date.now() + THIRTY_DAYS_MS);
  }

  if (status === "pending") {
    return existing?.expiresAt ?? existing?.renewalAt ?? new Date();
  }

  return new Date();
};

type SubscriptionRow = typeof providerSubscriptions.$inferSelect;

export const freezeRemainingIfNeeded = async (row: SubscriptionRow, now = new Date()) => {
  if (row.remainingMsAtPause != null) {
    return row;
  }

  const remaining = remainingMs(row, false, now.getTime());
  const db = getDb();
  const [updated] = await db
    .update(providerSubscriptions)
    .set({
      remainingMsAtPause: remaining,
      updatedAt: now,
    })
    .where(eq(providerSubscriptions.id, row.id))
    .returning();
  return updated ?? { ...row, remainingMsAtPause: remaining, updatedAt: now };
};

export const restoreExpiryIfUnpaused = async (
  row: SubscriptionRow,
  globallyPaused: boolean,
  now = new Date()
) => {
  if (row.pausedAt || globallyPaused) {
    return row;
  }
  if (row.remainingMsAtPause == null) {
    return row;
  }

  const remaining = Math.max(0, Number(row.remainingMsAtPause));
  const expiry = new Date(now.getTime() + remaining);
  const db = getDb();
  const [updated] = await db
    .update(providerSubscriptions)
    .set({
      expiresAt: expiry,
      renewalAt: expiry,
      status: remaining > 0 ? "active" : "expired",
      remainingMsAtPause: null,
      updatedAt: now,
    })
    .where(eq(providerSubscriptions.id, row.id))
    .returning();
  return updated ?? row;
};

const toSubscriptionDto = (
  row: {
    providerId: string;
    status: string;
    renewalAt?: Date | null;
    expiresAt?: Date | null;
    lastPaymentId?: string | null;
    pausedAt?: Date | null;
    pauseReason?: string | null;
    remainingMsAtPause?: number | null;
    updatedAt: Date;
  },
  planAmount: number,
  globallyPaused: boolean
): Subscription => {
  const remaining = remainingMs(row, globallyPaused);
  const paused = Boolean(row.pausedAt) || globallyPaused;
  const paidActive = row.status === "active" && remaining > 0;
  const displayExpiry = paused ? new Date(Date.now() + remaining) : (row.expiresAt ?? row.renewalAt ?? new Date());

  return {
    providerId: row.providerId,
    status: paused ? "paused" : ((paidActive ? "active" : row.status) as SubscriptionStatus),
    renewalDate: displayExpiry.toISOString(),
    amount: planAmount,
    planAmount,
    creditBalance: 0,
    paymentMethod: "mpesa",
    lastPaymentId: row.lastPaymentId ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
    paused,
    pauseScope: pauseScopeFor(row.pausedAt, globallyPaused),
    pauseReason: globallyPaused ? undefined : row.pauseReason,
    remainingMs: remaining,
    remainingDays: remainingDaysFromMs(remaining),
  };
};

export const normalizeSubscriptionStatus = async (providerId: string) => {
  const db = getDb();
  const settings = await getPlatformSettings();
  const [existing] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);

  if (!existing) {
    return null;
  }

  if (existing.pausedAt || settings.subscriptionsPaused || existing.remainingMsAtPause != null) {
    return existing;
  }

  const expiry = existing.expiresAt ?? existing.renewalAt;
  if (existing.status === "active" && expiry && expiry.getTime() <= Date.now()) {
    await db
      .update(providerSubscriptions)
      .set({
        status: "expired",
        updatedAt: new Date(),
      })
      .where(eq(providerSubscriptions.id, existing.id));

    return {
      ...existing,
      status: "expired" as const,
    };
  }

  return existing;
};

export const getSubscription = async (providerId: string) => {
  const plan = await ensureDefaultPlan();
  await normalizeSubscriptionStatus(providerId);
  const settings = await getPlatformSettings();
  const db = getDb();
  const [row] = await db
    .select({
      providerId: providerSubscriptions.providerId,
      status: providerSubscriptions.status,
      renewalAt: providerSubscriptions.renewalAt,
      expiresAt: providerSubscriptions.expiresAt,
      startsAt: providerSubscriptions.startsAt,
      lastPaymentId: providerSubscriptions.lastPaymentId,
      creditBalance: providerSubscriptions.creditBalance,
      pausedAt: providerSubscriptions.pausedAt,
      pauseReason: providerSubscriptions.pauseReason,
      remainingMsAtPause: providerSubscriptions.remainingMsAtPause,
      updatedAt: providerSubscriptions.updatedAt,
      planPrice: subscriptionPlans.priceAmount,
      planCurrency: subscriptionPlans.currency,
    })
    .from(providerSubscriptions)
    .leftJoin(subscriptionPlans, eq(providerSubscriptions.planId, subscriptionPlans.id))
    .where(eq(providerSubscriptions.providerId, providerId))
    .limit(1);

  if (!row) {
    const planAmount = Number(plan.priceAmount ?? DEFAULT_PLAN_AMOUNT);
    return toSubscriptionDto(
      {
        providerId,
        status: "expired",
        renewalAt: new Date(),
        expiresAt: new Date(),
        lastPaymentId: null,
        pausedAt: null,
        pauseReason: null,
        remainingMsAtPause: null,
        updatedAt: new Date(),
      },
      planAmount,
      settings.subscriptionsPaused
    );
  }

  await resetLegacyCreditBalance(providerId, row.creditBalance);
  const planAmount = Number(row.planPrice ?? DEFAULT_PLAN_AMOUNT);
  return toSubscriptionDto(row, planAmount, settings.subscriptionsPaused);
};

export const upsertSubscription = async (
  providerId: string,
  status: SubscriptionStatus,
  options?: { renewalDate?: string; lastPaymentId?: string; creditBalance?: number }
) => {
  const db = getDb();
  const plan = await ensureDefaultPlan();
  const now = new Date();
  const [existing] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);
  const renewalDate = resolveExpiryDate(status, existing, options?.renewalDate);

  const payload = {
    providerId,
    planId: plan.id,
    status,
    startsAt: existing?.startsAt ?? now,
    renewalAt: renewalDate,
    expiresAt: renewalDate,
    lastPaymentId: options?.lastPaymentId ?? existing?.lastPaymentId ?? null,
    creditBalance: "0",
    updatedAt: now,
  };

  if (!existing) {
    await db.insert(providerSubscriptions).values({
      ...payload,
      createdAt: now,
    });
  } else {
    await db.update(providerSubscriptions).set(payload).where(eq(providerSubscriptions.providerId, providerId));
  }

  return getSubscription(providerId);
};

export const getSubscriptionAmountDue = async (providerId: string) => {
  const subscription = await getSubscription(providerId);
  return subscription?.amount ?? DEFAULT_PLAN_AMOUNT;
};

export const applySubscriptionPayment = async (
  providerId: string,
  paidAmount: number,
  paymentId: string
) => {
  const db = getDb();
  const plan = await ensureDefaultPlan();
  const settings = await getPlatformSettings();
  const [existing] = await db
    .select()
    .from(providerSubscriptions)
    .where(eq(providerSubscriptions.providerId, providerId))
    .limit(1);
  const planAmount = Number(plan.priceAmount ?? DEFAULT_PLAN_AMOUNT);

  if (toMoney(paidAmount) < planAmount) {
    const status = (existing?.status as SubscriptionStatus | undefined) ?? "pending";
    return upsertSubscription(providerId, status, {
      lastPaymentId: paymentId,
      creditBalance: 0,
    });
  }

  const frozen = Boolean(existing?.pausedAt) || settings.subscriptionsPaused;
  if (existing && frozen) {
    const frozenRow = await freezeRemainingIfNeeded(existing);
    const remaining = remainingMs(frozenRow, true) + THIRTY_DAYS_MS;
    await db
      .update(providerSubscriptions)
      .set({
        status: "active",
        remainingMsAtPause: remaining,
        lastPaymentId: paymentId,
        creditBalance: "0",
        updatedAt: new Date(),
      })
      .where(eq(providerSubscriptions.id, existing.id));
    return getSubscription(providerId);
  }

  const currentExpiry = existing?.expiresAt ?? existing?.renewalAt ?? null;
  const baseTime =
    currentExpiry && currentExpiry.getTime() > Date.now()
      ? currentExpiry.getTime()
      : Date.now();

  const updated = await upsertSubscription(providerId, "active", {
    renewalDate: new Date(baseTime + THIRTY_DAYS_MS).toISOString(),
    lastPaymentId: paymentId,
    creditBalance: 0,
  });

  if (settings.subscriptionsPaused) {
    const [row] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);
    if (row) {
      await freezeRemainingIfNeeded(row);
    }
    return getSubscription(providerId);
  }

  return updated;
};

export const subscriptionIsActive = (subscription: Subscription | null) => {
  if (!subscription) {
    return false;
  }
  if (subscription.paused || subscription.status === "paused") {
    return false;
  }
  return isEffectivelyActive(
    {
      status: subscription.status,
      expiresAt: subscription.renewalDate,
      remainingMsAtPause: subscription.remainingMs ?? null,
    },
    false
  );
};

export { ensureDefaultPlan, SETTINGS_ID, THIRTY_DAYS_MS };
