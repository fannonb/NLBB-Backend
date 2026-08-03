import { asc, and, count, desc, eq, max, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  adminLogs,
  bookings,
  categories,
  payments,
  providerServices,
  providerSubscriptions,
  providerVerificationEvents,
  providers,
  userProfiles,
  users,
} from "../db/schema";
import type { CategoryIcon } from "../constants/categoryIcons";
import { DEFAULT_CATEGORY_ICON } from "../constants/categoryIcons";
import type { Provider, Subscription, UserRole } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { categorySlugFromName } from "../utils/categorySlug";
import { getAdminOverview } from "./analyticsPgService";

type AdminProviderStatus = "pending" | "approved" | "suspended";
type AdminUserStatus = "active" | "disabled";
type AdminSubStatus = "active" | "expired" | "none";

interface DbUser {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  status?: AdminUserStatus;
  location?: string;
  avatar?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ProviderDoc {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  phone: string | null;
  ratingAvg: string | number | null;
  reviewCount: number | null;
  isVerified: boolean;
  isOpen: boolean;
  adminStatus?: AdminProviderStatus | null;
  createdAt: Date;
}

interface AdminLogRow {
  id: string;
  type: "signup" | "subscription" | "verification" | "suspension" | "payment" | "dispute" | "booking" | "category";
  text: string;
  createdAt: string;
}

interface ListFilters {
  status?: string;
  query?: string;
}

const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?q=80&w=200&auto=format&fit=crop";

const formatDate = (value?: Date | null) => {
  if (!value) {
    return "-";
  }
  return value.toISOString();
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) {
    return "just now";
  }
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} min ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} hrs ago`;
  }
  return `${Math.floor(diff / 86_400_000)} days ago`;
};

const getProviderStatus = (provider: ProviderDoc): AdminProviderStatus => {
  if (provider.adminStatus) {
    return provider.adminStatus;
  }
  if (provider.isVerified) {
    return "approved";
  }
  if (provider.isOpen === false) {
    return "suspended";
  }
  return "pending";
};

const getSubStatus = (subscription?: { status?: string; renewalAt?: Date | null; expiresAt?: Date | null }): AdminSubStatus => {
  if (!subscription) {
    return "none";
  }
  const expiry = subscription.expiresAt ?? subscription.renewalAt;
  if (subscription.status === "active" && expiry && expiry.getTime() > Date.now()) {
    return "active";
  }
  return "expired";
};

const getPlanLabel = (amount: number) => {
  if (amount === 500) return "Monthly";
  if (amount === 900) return "Quarterly";
  if (amount === 3600) return "Annual";
  return "Custom";
};

const formatMoneyKes = (amount: number) => `Ksh ${amount.toLocaleString("en-US")}`;
const formatPercentDelta = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toActorUserId = (value?: string | null) => {
  if (!value) {
    return null;
  }
  return UUID_PATTERN.test(value) ? value : null;
};

const ACTIVITY_COLORS: Record<AdminLogRow["type"], string> = {
  signup: "#D4AF37",
  subscription: "#B8962A",
  verification: "#F59E0B",
  suspension: "#EF4444",
  payment: "#22C55E",
  dispute: "#EF4444",
  booking: "#2563EB",
  category: "#B8962A",
};

export interface AdminCategoryInput {
  name: string;
  icon: CategoryIcon;
  sortOrder?: number;
  isActive?: boolean;
}

const categoryRecord = (
  category: typeof categories.$inferSelect,
  serviceCount: number
) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  icon: category.icon || DEFAULT_CATEGORY_ICON,
  sortOrder: category.sortOrder,
  isActive: category.isActive,
  serviceCount,
  createdAt: category.createdAt.toISOString(),
});

export const appendAdminLog = async (input: Omit<AdminLogRow, "id" | "createdAt"> & { createdAt?: string }) => {
  const db = getDb();
  await db.insert(adminLogs).values({
    actorUserId: null,
    targetType: "system",
    targetId: "system",
    action: input.type,
    summary: input.text,
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
  });
};

const queueAdminLog = (input: Omit<AdminLogRow, "id" | "createdAt"> & { createdAt?: string }) => {
  void appendAdminLog(input).catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[adminLog] write failed:", error);
  });
};

export const listAdminCategories = async () => {
  const db = getDb();
  const [categoryRows, serviceCountRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({
        categoryId: providerServices.categoryId,
        total: count(),
      })
      .from(providerServices)
      .where(sql`${providerServices.categoryId} is not null`)
      .groupBy(providerServices.categoryId),
  ]);
  const serviceCounts = new Map<string, number>();
  serviceCountRows.forEach(({ categoryId, total }) => {
    if (categoryId) serviceCounts.set(categoryId, Number(total));
  });
  return categoryRows.map((category) => categoryRecord(category, serviceCounts.get(category.id) ?? 0));
};

export const createAdminCategory = async (payload: AdminCategoryInput, actorUid: string) => {
  const db = getDb();
  const name = payload.name.trim();
  const slug = categorySlugFromName(name);
  if (!slug) {
    throw new ApiError(400, "Enter a valid category name.", "INVALID_CATEGORY_NAME");
  }

  const [duplicate] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(or(eq(categories.slug, slug), sql`lower(${categories.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (duplicate) {
    throw new ApiError(409, "A category with this name already exists.", "CATEGORY_EXISTS");
  }

  const [sortRow] = await db.select({ value: max(categories.sortOrder) }).from(categories);
  const nextSortOrder = (sortRow?.value ?? -1) + 1;
  const [created] = await db
    .insert(categories)
    .values({
      name,
      slug,
      icon: payload.icon,
      sortOrder: payload.sortOrder ?? nextSortOrder,
      isActive: payload.isActive ?? true,
      createdAt: new Date(),
    })
    .returning();

  queueAdminLog({ type: "category", text: `${name} category created by ${actorUid}` });
  return categoryRecord(created, 0);
};

export const updateAdminCategory = async (
  categoryId: string,
  payload: Partial<AdminCategoryInput>,
  actorUid: string
) => {
  const db = getDb();
  const [existing] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!existing) return null;

  const name = payload.name?.trim() ?? existing.name;
  const slug = payload.name ? categorySlugFromName(name) : existing.slug;
  if (payload.name) {
    const [duplicate] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          ne(categories.id, categoryId),
          or(eq(categories.slug, slug), sql`lower(${categories.name}) = ${name.toLowerCase()}`)
        )
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(409, "A category with this name already exists.", "CATEGORY_EXISTS");
    }
  }

  const [updated] = await db
    .update(categories)
    .set({
      name,
      slug,
      icon: payload.icon ?? existing.icon,
      sortOrder: payload.sortOrder ?? existing.sortOrder,
      isActive: payload.isActive ?? existing.isActive,
    })
    .where(eq(categories.id, categoryId))
    .returning();
  const [serviceCountRow] = await db
    .select({ total: count() })
    .from(providerServices)
    .where(eq(providerServices.categoryId, categoryId));

  queueAdminLog({ type: "category", text: `${name} category updated by ${actorUid}` });
  return categoryRecord(updated, Number(serviceCountRow?.total ?? 0));
};

export const deleteAdminCategory = async (categoryId: string, actorUid: string) => {
  const db = getDb();
  const [existing] = await db.select().from(categories).where(eq(categories.id, categoryId)).limit(1);
  if (!existing) {
    return null;
  }

  if (existing.isActive) {
    throw new ApiError(
      400,
      "Deactivate this category before deleting it.",
      "CATEGORY_MUST_BE_INACTIVE"
    );
  }

  const [linkedServices] = await db
    .select({ total: count() })
    .from(providerServices)
    .where(eq(providerServices.categoryId, categoryId));

  const linkedCount = Number(linkedServices?.total ?? 0);
  if (linkedCount > 0) {
    throw new ApiError(
      409,
      `This category is still linked to ${linkedCount} service${linkedCount === 1 ? "" : "s"}. Reassign or remove those services before deleting.`,
      "CATEGORY_IN_USE"
    );
  }

  await db.delete(categories).where(eq(categories.id, categoryId));
  queueAdminLog({
    type: "category",
    text: `${existing.name} category permanently deleted by ${actorUid}`,
  });

  return { id: categoryId, deleted: true };
};

interface DashboardActivityEvent {
  id: string;
  type: AdminLogRow["type"];
  text: string;
  createdAtMs: number;
}

const parseEventDateMs = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const pushActivity = (
  list: DashboardActivityEvent[],
  seen: Set<string>,
  input: {
    id: string;
    type: AdminLogRow["type"];
    text: string;
    createdAt: string;
  }
) => {
  const createdAtMs = parseEventDateMs(input.createdAt);
  if (createdAtMs === null) {
    return;
  }

  // De-duplicate near-identical items that originate from multiple sources.
  const dedupeKey = `${input.type}|${input.text}|${Math.floor(createdAtMs / 60_000)}`;
  if (seen.has(dedupeKey)) {
    return;
  }
  seen.add(dedupeKey);

  list.push({
    id: input.id,
    type: input.type,
    text: input.text,
    createdAtMs,
  });
};

export const listAdminProviders = async (filters: ListFilters) => {
  const db = getDb();
  const providerRows = await db.select().from(providers);
  const userRows = await db.select().from(users);
  const subscriptionRows = await db.select().from(providerSubscriptions);
  const bookingRows = await db.select().from(bookings);

  const usersById = new Map<string, DbUser>(
    userRows.map((user) => [user.id, {
      id: user.id,
      fullName: undefined,
      email: user.email,
      phone: user.phone ?? undefined,
      role: user.role as UserRole,
      status: user.status as AdminUserStatus,
      location: undefined,
      avatar: undefined,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }])
  );

  const bookingsByProvider = new Map<string, number>();
  bookingRows.forEach((booking) => {
    bookingsByProvider.set(booking.providerId, (bookingsByProvider.get(booking.providerId) ?? 0) + 1);
  });

  const providersList = providerRows
    .filter((row) => row.adminStatus !== "deleted")
    .map((provider) => {
      const owner = usersById.get(provider.ownerUserId);
      const subscription = subscriptionRows.find((sub) => sub.providerId === provider.id);
      const status = getProviderStatus(provider as ProviderDoc);
      const subStatus = getSubStatus(subscription);
      return {
        id: provider.id,
        name: provider.name,
        category: provider.categoryId ? "Provider" : "General",
        location: provider.location,
        appliedAt: formatDate(provider.createdAt),
        phone: provider.phone ?? owner?.phone ?? "-",
        email: owner?.email ?? "-",
        status,
        subscriptionStatus: subStatus,
        subscriptionPlan: subscription ? getPlanLabel(Number(subscription.status === "active" ? 500 : 500)) : undefined,
        bookingsCount: bookingsByProvider.get(provider.id) ?? 0,
        rating: Number(provider.ratingAvg ?? 0),
        avatar: DEFAULT_AVATAR,
        bio: provider.description,
      };
    })
    .filter((provider) => {
      const statusFilter = filters.status?.toLowerCase();
      const query = filters.query?.toLowerCase().trim();
      if (statusFilter && statusFilter !== "all" && provider.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [provider.name, provider.category, provider.location, provider.email].join(" ").toLowerCase().includes(query);
    });

  return providersList.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());
};

export const updateProviderAdminStatus = async (
  providerId: string,
  status: AdminProviderStatus,
  actorUid: string
) => {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider) {
    return null;
  }
  if (provider.adminStatus === "deleted") {
    return null;
  }

  await db
    .update(providers)
    .set({
      adminStatus: status,
      isVerified: status === "approved",
      isOpen: status !== "suspended",
      updatedAt: new Date(),
    })
    .where(eq(providers.id, providerId));

  await db.insert(providerVerificationEvents).values({
    providerId,
    actorUserId: toActorUserId(actorUid),
    fromStatus: provider.adminStatus,
    toStatus: status,
    reason: null,
    createdAt: new Date(),
  });

  await appendAdminLog({
    type: status === "approved" ? "verification" : "suspension",
    text: `${provider.name} was ${status} by admin`,
  });

  const { id: _providerId, ...rest } = provider;
  return { ...rest, id: providerId, adminStatus: status };
};

export const deleteAdminProvider = async (providerId: string, actorUid: string) => {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!provider) {
    return null;
  }

  if (provider.ownerUserId === actorUid) {
    throw new ApiError(400, "You cannot permanently delete your own account.", "CANNOT_DELETE_SELF");
  }

  // Permanent wipe: deleting the owner cascades provider rows and related data.
  await db.delete(users).where(eq(users.id, provider.ownerUserId));

  await appendAdminLog({
    type: "suspension",
    text: `${provider.name} provider account permanently deleted by ${actorUid}`,
  });

  return { id: providerId, deleted: true };
};

export const listAdminUsers = async (filters: ListFilters) => {
  const db = getDb();
  const userRows = await db.select().from(users);
  const bookingRows = await db.select().from(bookings);
  const profileRows = await db.select().from(userProfiles);

  const bookingCountByCustomer = new Map<string, number>();
  bookingRows.forEach((booking) => {
    bookingCountByCustomer.set(booking.customerUserId, (bookingCountByCustomer.get(booking.customerUserId) ?? 0) + 1);
  });
  const profilesByUserId = new Map(profileRows.map((profile) => [profile.userId, profile]));

  const query = filters.query?.toLowerCase().trim();
  const statusFilter = filters.status?.toLowerCase();

  return userRows
    .filter((u) => u.role === "customer")
    .map((user) => {
      const profile = profilesByUserId.get(user.id);
      return {
        id: user.id,
        name: profile?.fullName ?? user.email ?? "Unknown",
        email: user.email ?? "-",
        phone: user.phone ?? "-",
        role: user.role as UserRole,
        status: (user.status ?? "active") as AdminUserStatus,
        joinedAt: formatDate(profile?.createdAt ?? user.createdAt),
        bookingsCount: bookingCountByCustomer.get(user.id) ?? 0,
        avatar: profile?.avatarUrl ?? DEFAULT_AVATAR,
        location: profile?.location ?? "-",
      };
    })
    .filter((user) => {
      if (statusFilter && statusFilter !== "all" && user.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [user.name, user.email, user.phone].join(" ").toLowerCase().includes(query);
    })
    .sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
};

export const updateAdminUserStatus = async (
  userId: string,
  status: AdminUserStatus,
  actorUid: string
) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return null;
  }

  await db
    .update(users)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await appendAdminLog({
    type: status === "disabled" ? "suspension" : "verification",
    text: `${user.email} account set to ${status} by ${actorUid}`,
  });

  const { id: _userId, ...restUser } = user;
  return { ...restUser, id: userId, status };
};

export const hardDeleteAdminUser = async (userId: string, actorUid: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return null;
  }

  if (userId === actorUid) {
    throw new ApiError(400, "You cannot permanently delete your own account.", "CANNOT_DELETE_SELF");
  }

  if (user.role === "admin") {
    const adminRows = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    if (adminRows.length <= 1) {
      throw new ApiError(400, "Cannot delete the last admin account.", "LAST_ADMIN");
    }
  }

  // Permanent wipe — related profile/booking/favorite rows cascade from users.
  await db.delete(users).where(eq(users.id, userId));

  await appendAdminLog({
    type: "suspension",
    text: `${user.email ?? userId} account permanently deleted by ${actorUid}`,
  });

  return { id: userId, deleted: true };
};

/** @deprecated Use hardDeleteAdminUser — kept as alias for route compatibility. */
export const softDeleteAdminUser = hardDeleteAdminUser;

export const getAdminRevenueReport = async () => {
  const db = getDb();
  const paymentRows = await db.select().from(payments).orderBy(desc(payments.createdAt));
  const providerRows = await db.select().from(providers);
  const subscriptionRows = await db.select().from(providerSubscriptions);
  const providerMap = new Map(providerRows.map((provider) => [provider.id, provider]));

  const successful = paymentRows.filter((payment) => payment.status === "success");
  const pending = paymentRows.filter((payment) => payment.status === "pending");
  const failed = paymentRows.filter((payment) => payment.status === "failed");

  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const currentYear = now.getUTCFullYear();

  const monthlyTotals = new Map<string, number>();
  const monthKey = (date: Date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`;

  successful.forEach((payment) => {
    const key = monthKey(payment.createdAt);
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + Number(payment.amount));
  });

  const monthlyRevenue = Array.from({ length: 12 }, (_, idx) => {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + idx, 1));
    const key = monthKey(monthStart);
    const amount = monthlyTotals.get(key) ?? 0;
    return {
      month: monthStart.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      monthShort: monthStart.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      year: monthStart.getUTCFullYear(),
      monthIndex: monthStart.getUTCMonth(),
      amount,
      amountFormatted: formatMoneyKes(amount),
    };
  });

  const totalSuccessful = successful
    .filter((payment) => payment.createdAt.getUTCFullYear() === currentYear)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const thisMonthSuccessful = successful
    .filter((payment) => payment.createdAt >= currentMonthStart && payment.createdAt < nextMonthStart)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const previousMonthSuccessful = successful
    .filter((payment) => payment.createdAt >= previousMonthStart && payment.createdAt < currentMonthStart)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  let monthOverMonthNote = "No revenue yet this month";
  if (thisMonthSuccessful > 0 && previousMonthSuccessful === 0) {
    monthOverMonthNote = "New revenue this month";
  } else if (previousMonthSuccessful > 0) {
    const deltaPct = ((thisMonthSuccessful - previousMonthSuccessful) / previousMonthSuccessful) * 100;
    monthOverMonthNote = `${formatPercentDelta(deltaPct)} vs last month`;
  }

  const plans = successful.reduce<Array<{ name: string; price: string; count: number; revenue: string; percent: number }>>(
    (acc, payment) => {
      const name = getPlanLabel(Number(payment.amount));
      const existing = acc.find((plan) => plan.name === name);
      if (existing) {
        existing.count += 1;
        existing.revenue = formatMoneyKes(Number(existing.revenue.replace(/[^\d]/g, "")) + Number(payment.amount));
        return acc;
      }
      acc.push({
        name,
        price: formatMoneyKes(Number(payment.amount)),
        count: 1,
        revenue: formatMoneyKes(Number(payment.amount)),
        percent: 100,
      });
      return acc;
    },
    []
  );
  const totalPlanCount = plans.reduce((sum, plan) => sum + plan.count, 0);
  plans.forEach((plan) => {
    plan.percent = totalPlanCount > 0 ? Math.round((plan.count / totalPlanCount) * 100) : 0;
  });

  const activeSubscribers = subscriptionRows.filter((subscription) => {
    const expiry = subscription.expiresAt ?? subscription.renewalAt;
    return subscription.status === "active" && !!expiry && expiry.getTime() > Date.now();
  }).length;

  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const paymentHistory = paymentRows
    .filter((payment) => payment.createdAt >= twelveMonthsAgo)
    .map((payment) => {
      const provider = providerMap.get(payment.providerId);
      return {
        id: payment.id,
        provider: provider?.name ?? payment.providerId,
        plan: getPlanLabel(Number(payment.amount)),
        amount: formatMoneyKes(Number(payment.amount)),
        amountRaw: Number(payment.amount),
        date: formatDate(payment.createdAt),
        createdAt: payment.createdAt.toISOString(),
        year: payment.createdAt.getUTCFullYear(),
        monthIndex: payment.createdAt.getUTCMonth(),
        status: payment.status,
        phoneNumber: payment.phoneNumber ?? null,
        mpesaReceiptNumber: payment.mpesaReceiptNumber ?? null,
        method: payment.method ?? "mpesa",
      };
    });

  return {
    summary: {
      totalRevenueRaw: totalSuccessful,
      totalRevenue: formatMoneyKes(totalSuccessful),
      thisMonth: formatMoneyKes(thisMonthSuccessful),
      activeSubscribers,
      failedAmount: formatMoneyKes(failed.reduce((sum, payment) => sum + Number(payment.amount), 0)),
      pendingAmount: formatMoneyKes(pending.reduce((sum, payment) => sum + Number(payment.amount), 0)),
      monthOverMonthNote,
    },
    plans,
    monthlyRevenue,
    payments: paymentHistory,
  };
};

export const getAdminDashboardData = async () => {
  const db = getDb();
  const overview = await getAdminOverview();
  const providersList = await listAdminProviders({});
  const usersList = await listAdminUsers({});
  const revenue = await getAdminRevenueReport();
  const verificationEvents = await db
    .select()
    .from(providerVerificationEvents)
    .orderBy(desc(providerVerificationEvents.createdAt))
    .limit(12);
  const recentBookings = await db
    .select()
    .from(bookings)
    .orderBy(desc(bookings.createdAt))
    .limit(40);
  const providerNameById = new Map(providersList.map((provider) => [provider.id, provider.name]));
  const customerNameById = new Map(usersList.map((user) => [user.id, user.name]));
  const activityEvents: DashboardActivityEvent[] = [];
  const seen = new Set<string>();

  usersList.slice(0, 20).forEach((user) => {
    const label = `New customer registered: ${user.name}`;
    pushActivity(activityEvents, seen, {
      id: `signup:${user.id}`,
      type: "signup",
      text: label,
      createdAt: user.joinedAt,
    });
  });

  providersList
    .filter((provider) => provider.status === "pending")
    .slice(0, 12)
    .forEach((provider) => {
      pushActivity(activityEvents, seen, {
        id: `pending:${provider.id}`,
        type: "verification",
        text: `${provider.name} awaiting verification`,
        createdAt: provider.appliedAt,
      });
    });

  verificationEvents.forEach((event) => {
    const providerName = providerNameById.get(event.providerId) ?? "Provider";
    const type = event.toStatus === "suspended" ? "suspension" : "verification";
    const text =
      event.toStatus === "approved"
        ? `${providerName} was approved by admin`
        : event.toStatus === "suspended"
          ? `${providerName} was suspended by admin`
          : `${providerName} moved to ${event.toStatus} status`;

    pushActivity(activityEvents, seen, {
      id: `verify:${event.id}`,
      type,
      text,
      createdAt: event.createdAt.toISOString(),
    });
  });

  recentBookings.forEach((booking) => {
    const providerName = providerNameById.get(booking.providerId) ?? "Provider";
    const customerName = customerNameById.get(booking.customerUserId) ?? "Customer";
    pushActivity(activityEvents, seen, {
      id: `booking:${booking.id}`,
      type: "booking",
      text: `New booking ${booking.referenceCode}: ${customerName} booked ${providerName}`,
      createdAt: booking.createdAt.toISOString(),
    });
  });

  revenue.payments.slice(0, 20).forEach((payment) => {
    const type: AdminLogRow["type"] =
      payment.status === "success"
        ? "payment"
        : payment.status === "pending"
          ? "subscription"
          : "dispute";
    const text =
      payment.status === "success"
        ? `Subscription payment received: ${payment.provider} - ${payment.amount}`
        : payment.status === "pending"
          ? `Subscription payment pending: ${payment.provider} - ${payment.amount}`
          : `Subscription payment failed: ${payment.provider} - ${payment.amount}`;
    pushActivity(activityEvents, seen, {
      id: `payment:${payment.id}`,
      type,
      text,
      createdAt: payment.date,
    });
  });

  const activity = activityEvents
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 12)
    .map((event) => ({
      id: event.id,
      type: event.type,
      text: event.text,
      time: formatRelativeTime(new Date(event.createdAtMs).toISOString()),
      color: ACTIVITY_COLORS[event.type],
    }));

  const weeklySignups = [
    {
      day: new Date().toLocaleDateString("en-US", { weekday: "short" }),
      customers: usersList.length,
      providers: providersList.length,
    },
  ];

  return {
    metrics: {
      // "Total Users" card in admin UI represents customer accounts only.
      totalUsers: usersList.filter((user) => user.role === "customer").length,
      activeProviders: providersList.filter((provider) => provider.status === "approved").length,
      monthlyRevenue: revenue.summary.thisMonth,
      activeSubscriptions: overview.activeSubscriptions,
      totalBookings: overview.totalBookings,
      pendingProviders: providersList.filter((provider) => provider.status === "pending").length,
      ytdRevenue: revenue.summary.totalRevenue,
      revenueTrendNote: revenue.summary.monthOverMonthNote,
      subscriptionBadge: `${overview.activeSubscriptions} active subscriptions`,
      heroChips: [
        { label: "This month", value: revenue.summary.thisMonth },
        { label: "Failed", value: revenue.summary.failedAmount },
        { label: "Pending", value: revenue.summary.pendingAmount },
      ],
    },
    pendingProviders: providersList.filter((provider) => provider.status === "pending").slice(0, 10),
    activity,
    weeklySignups,
    monthlyRevenue: revenue.monthlyRevenue,
  };
};
