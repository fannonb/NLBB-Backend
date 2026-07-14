import { asc, desc, eq } from "drizzle-orm";
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
  if (amount === 300) return "Monthly";
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

export const listAdminCategories = async () => {
  const db = getDb();
  const [categoryRows, serviceRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({ categoryId: providerServices.categoryId }).from(providerServices),
  ]);
  const serviceCounts = new Map<string, number>();
  serviceRows.forEach(({ categoryId }) => {
    if (categoryId) serviceCounts.set(categoryId, (serviceCounts.get(categoryId) ?? 0) + 1);
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

  const existingRows = await db.select().from(categories);
  if (existingRows.some((row) => row.slug === slug || row.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, "A category with this name already exists.", "CATEGORY_EXISTS");
  }

  const nextSortOrder = existingRows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
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

  await appendAdminLog({ type: "category", text: `${name} category created by ${actorUid}` });
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
  const allRows = await db.select().from(categories);
  if (
    allRows.some(
      (row) => row.id !== categoryId && (row.slug === slug || row.name.toLowerCase() === name.toLowerCase())
    )
  ) {
    throw new ApiError(409, "A category with this name already exists.", "CATEGORY_EXISTS");
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
  const serviceCount = await db
    .select({ categoryId: providerServices.categoryId })
    .from(providerServices)
    .where(eq(providerServices.categoryId, categoryId));

  await appendAdminLog({ type: "category", text: `${name} category updated by ${actorUid}` });
  return categoryRecord(updated, serviceCount.length);
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

export const listAdminProviders = async (filters: ListFilters) => {
  const db = getDb();
  const [providerRows, userRows, subscriptionRows, bookingRows] = await Promise.all([
    db.select().from(providers),
    db.select().from(users),
    db.select().from(providerSubscriptions),
    db.select().from(bookings),
  ]);

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
        subscriptionPlan: subscription ? getPlanLabel(Number(subscription.status === "active" ? 300 : 300)) : undefined,
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
  if (provider.adminStatus === "deleted") {
    return { id: providerId, deleted: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(users.id, provider.ownerUserId));

    await tx
      .update(providers)
      .set({
        adminStatus: "deleted",
        isVerified: false,
        isOpen: false,
        updatedAt: new Date(),
      })
      .where(eq(providers.id, providerId));
  });

  await appendAdminLog({
    type: "suspension",
    text: `${provider.name} provider account deleted by ${actorUid}`,
  });

  return { id: providerId, deleted: true };
};

export const listAdminUsers = async (filters: ListFilters) => {
  const db = getDb();
  const [userRows, bookingRows, profileRows] = await Promise.all([
    db.select().from(users),
    db.select().from(bookings),
    db.select().from(userProfiles),
  ]);

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

export const softDeleteAdminUser = async (userId: string, actorUid: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return null;
  }

  await db
    .update(users)
    .set({
      status: "disabled",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await appendAdminLog({
    type: "suspension",
    text: `${user.email} account marked deleted by ${actorUid}`,
  });

  return { id: userId, deleted: true };
};

export const getAdminRevenueReport = async () => {
  const db = getDb();
  const [paymentRows, providerRows, subscriptionRows] = await Promise.all([
    db.select().from(payments).orderBy(desc(payments.createdAt)),
    db.select().from(providers),
    db.select().from(providerSubscriptions),
  ]);
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

  const monthlyRevenue = Array.from({ length: 6 }, (_, idx) => {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + idx, 1));
    const key = monthKey(monthStart);
    return {
      month: monthStart.toLocaleDateString("en-US", { month: "short" }),
      amount: monthlyTotals.get(key) ?? 0,
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

  const paymentHistory = paymentRows.slice(0, 50).map((payment) => {
    const provider = providerMap.get(payment.providerId);
    return {
      id: payment.id,
      provider: provider?.name ?? payment.providerId,
      plan: getPlanLabel(Number(payment.amount)),
      amount: formatMoneyKes(Number(payment.amount)),
      amountRaw: Number(payment.amount),
      date: formatDate(payment.createdAt),
      status: payment.status,
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
  const [overview, providersList, usersList, revenue, verificationEvents, recentBookings] = await Promise.all([
    getAdminOverview(),
    listAdminProviders({}),
    listAdminUsers({}),
    getAdminRevenueReport(),
    db
      .select()
      .from(providerVerificationEvents)
      .orderBy(desc(providerVerificationEvents.createdAt))
      .limit(12),
    db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt))
      .limit(40),
  ]);
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
