import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { providerSubscriptions, providers, subscriptionPlans } from "../db/schema";
import type { Subscription, SubscriptionStatus } from "../types/domain";

const DEFAULT_PLAN_CODE = "monthly";
const DEFAULT_PLAN_AMOUNT = 1;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const toMoney = (value: unknown) => Number(Number(value ?? 0).toFixed(2));
const calculateAmountDue = (planAmount: number, creditBalance: number) =>
  Math.max(0, toMoney(planAmount - creditBalance));

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

export const normalizeSubscriptionStatus = async (providerId: string) => {
  const db = getDb();
  const [existing] = await db.select().from(providerSubscriptions).where(eq(providerSubscriptions.providerId, providerId)).limit(1);

  if (!existing) {
    return null;
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
    return {
      providerId,
      status: "expired" as const,
      renewalDate: new Date().toISOString(),
      amount: planAmount,
      planAmount,
      creditBalance: 0,
      paymentMethod: "mpesa" as const,
      updatedAt: new Date().toISOString(),
    } satisfies Subscription;
  }

  const planAmount = Number(row.planPrice ?? DEFAULT_PLAN_AMOUNT);
  const creditBalance = toMoney(row.creditBalance);
  return {
    providerId: row.providerId,
    status: row.status as SubscriptionStatus,
    renewalDate: (row.expiresAt ?? row.renewalAt ?? new Date()).toISOString(),
    amount: calculateAmountDue(planAmount, creditBalance),
    planAmount,
    creditBalance,
    paymentMethod: "mpesa" as const,
    lastPaymentId: row.lastPaymentId ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  } satisfies Subscription;
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
    creditBalance: toMoney(options?.creditBalance ?? existing?.creditBalance ?? 0).toString(),
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

  const creditBalance = toMoney(options?.creditBalance ?? existing?.creditBalance ?? 0);
  const planAmount = Number(plan.priceAmount ?? DEFAULT_PLAN_AMOUNT);
  return {
    providerId,
    status,
    renewalDate: renewalDate.toISOString(),
    amount: calculateAmountDue(planAmount, creditBalance),
    planAmount,
    creditBalance,
    paymentMethod: "mpesa" as const,
    lastPaymentId: options?.lastPaymentId ?? existing?.lastPaymentId ?? undefined,
    updatedAt: now.toISOString(),
  } satisfies Subscription;
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
  const [existing] = await db
    .select()
    .from(providerSubscriptions)
    .where(eq(providerSubscriptions.providerId, providerId))
    .limit(1);
  const planAmount = Number(plan.priceAmount ?? DEFAULT_PLAN_AMOUNT);
  const currentCredit = toMoney(existing?.creditBalance ?? 0);
  const available = toMoney(currentCredit + paidAmount);
  const nextCredit = available >= planAmount ? toMoney(available - planAmount) : available;

  if (available < planAmount) {
    const status = (existing?.status as SubscriptionStatus | undefined) ?? "pending";
    return upsertSubscription(providerId, status, {
      lastPaymentId: paymentId,
      creditBalance: nextCredit,
    });
  }

  const currentExpiry = existing?.expiresAt ?? existing?.renewalAt ?? null;
  const baseTime =
    currentExpiry && currentExpiry.getTime() > Date.now()
      ? currentExpiry.getTime()
      : Date.now();

  return upsertSubscription(providerId, "active", {
    renewalDate: new Date(baseTime + THIRTY_DAYS_MS).toISOString(),
    lastPaymentId: paymentId,
    creditBalance: nextCredit,
  });
};

export const subscriptionIsActive = (subscription: Subscription | null) => {
  if (!subscription || subscription.status !== "active") {
    return false;
  }
  return new Date(subscription.renewalDate).getTime() > Date.now();
};
