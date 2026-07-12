import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../../db/client";
import { env } from "../../config/env";
import {
  categories,
  providerMedia,
  providers,
  providerServices,
  providerSubscriptions,
  providerWorkingHours,
} from "../../db/schema";
import type { Provider, WorkingHoursDay } from "../../types/domain";
import {
  isSubscriptionCurrentlyActive,
  sanitizeProvider,
  toIsoString,
  weekdayLabels,
} from "./shared";
import type { MarketplaceCategory, MarketplaceRepository } from "./types";
import { canonicalCategorySlug } from "../../utils/categorySlug";
import { reconcilePendingPaymentsForProviders } from "../../services/paymentPgService";

type ProviderBaseRow = {
  id: string;
  ownerUserId: string;
  name: string;
  serviceCategories: string | null;
  description: string | null;
  location: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  mpesaPhone: string | null;
  priceFrom: string;
  ratingAvg: string;
  reviewCount: number;
  isVerified: boolean;
  isOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
  categoryName: string | null;
  categorySlug: string | null;
};

const normalizeCategory = (value?: string | null) => value?.trim().toLowerCase();
const parseCategoryList = (value?: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const mapWorkingHours = (
  rows: Array<{ weekday: number; isOpen: boolean; openTime: string | null; closeTime: string | null }>
) =>
  [...rows]
    .sort((a, b) => a.weekday - b.weekday)
    .map<WorkingHoursDay>((row) => ({
      day: weekdayLabels[row.weekday] ?? String(row.weekday),
      isOpen: row.isOpen,
      openTime: row.openTime ?? "",
      closeTime: row.closeTime ?? "",
    }));

const buildProviderRecord = (
  row: ProviderBaseRow,
  servicesByProvider: Map<string, Provider["services"]>,
  mediaByProvider: Map<string, Array<{ kind: string; url: string }>>,
  hoursByProvider: Map<string, WorkingHoursDay[]>,
  subscriptionByProvider: Map<string, { status: string; expiresAt?: string | null }>,
  currentUser?: { uid: string; role: string }
) => {
  const media = mediaByProvider.get(row.id) ?? [];
  const galleryImages = media.filter((item) => item.kind === "gallery").map((item) => item.url);
  const avatar = media.find((item) => item.kind === "avatar")?.url;
  const coverImage = media.find((item) => item.kind === "cover")?.url;
  const workingHours = hoursByProvider.get(row.id) ?? [];
  const openDays = workingHours.filter((item) => item.isOpen);
  const primaryHours = openDays[0];
  const isSubscribed = isSubscriptionCurrentlyActive(subscriptionByProvider.get(row.id));

  const provider: Provider = {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    category: row.serviceCategories?.trim() || row.categoryName || row.categorySlug || "General",
    description: row.description ?? "",
    avatar,
    coverImage,
    images: galleryImages,
    rating: Number(row.ratingAvg ?? 0),
    reviewCount: row.reviewCount ?? 0,
    location: row.location ?? "",
    address: row.address ?? "",
    coordinates:
      row.latitude !== null && row.longitude !== null
        ? {
            lat: Number(row.latitude),
            lng: Number(row.longitude),
          }
        : undefined,
    phone: row.phone ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    instagram: row.instagram ?? undefined,
    facebook: row.facebook ?? undefined,
    mpesaPhone: row.mpesaPhone ?? undefined,
    openTime: primaryHours?.openTime ?? "",
    closeTime: primaryHours?.closeTime ?? "",
    workDays: openDays.map((item) => item.day).join(", "),
    workingHours,
    priceFrom: Number(row.priceFrom ?? 0),
    isVerified: row.isVerified,
    isOpen: row.isOpen,
    services: servicesByProvider.get(row.id) ?? [],
    galleryImages,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };

  return sanitizeProvider(
    provider,
    !!currentUser,
    currentUser?.uid === provider.ownerUserId || currentUser?.role === "admin",
    isSubscribed
  );
};

const isOwnerOrAdmin = (providerOwnerUserId: string, currentUser?: { uid: string; role: string }) =>
  !!currentUser && (currentUser.uid === providerOwnerUserId || currentUser.role === "admin");

const allowUnsubscribedPreview = env.NODE_ENV === "development";

const fetchProvidersBase = async () => {
  const db = getDb();
  return db
    .select({
      id: providers.id,
      ownerUserId: providers.ownerUserId,
      name: providers.name,
      serviceCategories: providers.serviceCategories,
      description: providers.description,
      location: providers.location,
      address: providers.address,
      latitude: providers.latitude,
      longitude: providers.longitude,
      phone: providers.phone,
      whatsapp: providers.whatsapp,
      instagram: providers.instagram,
      facebook: providers.facebook,
      mpesaPhone: providers.mpesaPhone,
      priceFrom: providers.priceFrom,
      ratingAvg: providers.ratingAvg,
      reviewCount: providers.reviewCount,
      isVerified: providers.isVerified,
      isOpen: providers.isOpen,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(providers)
    .leftJoin(categories, eq(providers.categoryId, categories.id))
    .where(ne(providers.adminStatus, "deleted"))
    .orderBy(asc(providers.name));
};

const fetchProviderDetails = async (providerIds: string[]) => {
  const db = getDb();

  if (providerIds.length === 0) {
    return {
      servicesByProvider: new Map<string, Provider["services"]>(),
      mediaByProvider: new Map<string, Array<{ kind: string; url: string }>>(),
      hoursByProvider: new Map<string, WorkingHoursDay[]>(),
      subscriptionByProvider: new Map<string, { status: string; expiresAt?: string | null }>(),
    };
  }

  const [serviceRows, mediaRows, hourRows, subscriptionRows] = await Promise.all([
    db
      .select({
        id: providerServices.id,
        providerId: providerServices.providerId,
        name: providerServices.name,
        description: providerServices.description,
        durationMinutes: providerServices.durationMinutes,
        priceAmount: providerServices.priceAmount,
        isActive: providerServices.isActive,
        sortOrder: providerServices.sortOrder,
      })
      .from(providerServices)
      .where(inArray(providerServices.providerId, providerIds))
      .orderBy(asc(providerServices.providerId), asc(providerServices.sortOrder), asc(providerServices.name)),
    db
      .select({
        providerId: providerMedia.providerId,
        kind: providerMedia.kind,
        publicUrl: providerMedia.publicUrl,
        storageKey: providerMedia.storageKey,
        sortOrder: providerMedia.sortOrder,
        createdAt: providerMedia.createdAt,
      })
      .from(providerMedia)
      .where(inArray(providerMedia.providerId, providerIds))
      .orderBy(asc(providerMedia.providerId), asc(providerMedia.sortOrder), asc(providerMedia.createdAt)),
    db
      .select({
        providerId: providerWorkingHours.providerId,
        weekday: providerWorkingHours.weekday,
        isOpen: providerWorkingHours.isOpen,
        openTime: providerWorkingHours.openTime,
        closeTime: providerWorkingHours.closeTime,
      })
      .from(providerWorkingHours)
      .where(inArray(providerWorkingHours.providerId, providerIds))
      .orderBy(asc(providerWorkingHours.providerId), asc(providerWorkingHours.weekday)),
    db
      .select({
        providerId: providerSubscriptions.providerId,
        status: providerSubscriptions.status,
        expiresAt: providerSubscriptions.expiresAt,
        createdAt: providerSubscriptions.createdAt,
      })
      .from(providerSubscriptions)
      .where(inArray(providerSubscriptions.providerId, providerIds))
      .orderBy(desc(providerSubscriptions.createdAt)),
  ]);

  const servicesByProvider = new Map<string, Provider["services"]>();
  for (const row of serviceRows) {
    const list = servicesByProvider.get(row.providerId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      duration: row.durationMinutes,
      price: Number(row.priceAmount ?? 0),
      category: "General",
      isActive: row.isActive,
    });
    servicesByProvider.set(row.providerId, list);
  }

  const mediaByProvider = new Map<string, Array<{ kind: string; url: string }>>();
  for (const row of mediaRows) {
    const list = mediaByProvider.get(row.providerId) ?? [];
    list.push({
      kind: row.kind,
      url: row.publicUrl ?? row.storageKey,
    });
    mediaByProvider.set(row.providerId, list);
  }

  const rawHours = new Map<
    string,
    Array<{ weekday: number; isOpen: boolean; openTime: string | null; closeTime: string | null }>
  >();
  for (const row of hourRows) {
    const list = rawHours.get(row.providerId) ?? [];
    list.push(row);
    rawHours.set(row.providerId, list);
  }

  const hoursByProvider = new Map<string, WorkingHoursDay[]>();
  for (const [providerId, rows] of rawHours.entries()) {
    hoursByProvider.set(providerId, mapWorkingHours(rows));
  }

  const subscriptionByProvider = new Map<string, { status: string; expiresAt?: string | null }>();
  for (const row of subscriptionRows) {
    if (!subscriptionByProvider.has(row.providerId)) {
      subscriptionByProvider.set(row.providerId, {
        status: row.status,
        expiresAt: row.expiresAt ? toIsoString(row.expiresAt) : null,
      });
    }
  }

  return { servicesByProvider, mediaByProvider, hoursByProvider, subscriptionByProvider };
};

export const createPostgresMarketplaceRepository = (): MarketplaceRepository => ({
  async listCategories(): Promise<MarketplaceCategory[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        sortOrder: categories.sortOrder,
        isActive: categories.isActive,
      })
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    const byCanonical = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = canonicalCategorySlug(row.slug);
      const existing = byCanonical.get(key);
      if (!existing) {
        byCanonical.set(key, row);
        continue;
      }
      const preferNew =
        row.slug === key && existing.slug !== key
          ? true
          : existing.slug === key && row.slug !== key
            ? false
            : row.sortOrder < existing.sortOrder ||
              (row.sortOrder === existing.sortOrder && row.name.localeCompare(existing.name) < 0);
      if (preferNew) {
        byCanonical.set(key, row);
      }
    }

    return [...byCanonical.values()].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
    );
  },

  async listProviders(filters, currentUser) {
    const rows = await fetchProvidersBase();
    const normalizedSearch = filters.search?.trim().toLowerCase();
    const normalizedCategory = normalizeCategory(filters.category);

    const filteredRows = rows.filter((row) => {
      const categoryValues = parseCategoryList(row.serviceCategories);
      const primaryCategoryValue = normalizeCategory(row.categoryName ?? row.categorySlug ?? "");
      const matchesCategory =
        !normalizedCategory ||
        categoryValues.includes(normalizedCategory) ||
        primaryCategoryValue === normalizedCategory;
      if (!matchesCategory) {
        return false;
      }

      if (
        normalizedSearch &&
        ![row.name, row.categoryName ?? "", row.location ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch)
      ) {
        return false;
      }

      return true;
    });

    await reconcilePendingPaymentsForProviders(filteredRows.map((row) => row.id));
    const details = await fetchProviderDetails(filteredRows.map((row) => row.id));
    const providersList = filteredRows.map((row) =>
      buildProviderRecord(
        row,
        details.servicesByProvider,
        details.mediaByProvider,
        details.hoursByProvider,
        details.subscriptionByProvider,
        currentUser
      )
    );

    const customerFacingOnlySubscribed =
      filters.onlySubscribed ?? (allowUnsubscribedPreview ? false : !currentUser || currentUser.role === "customer");

    return customerFacingOnlySubscribed
      ? providersList.filter((provider) => provider.isSubscribed || isOwnerOrAdmin(provider.ownerUserId, currentUser))
      : providersList;
  },

  async getProviderById(id, currentUser) {
    const db = getDb();
    const rows = await db
      .select({
        id: providers.id,
        ownerUserId: providers.ownerUserId,
        name: providers.name,
        serviceCategories: providers.serviceCategories,
        description: providers.description,
        location: providers.location,
        address: providers.address,
        latitude: providers.latitude,
        longitude: providers.longitude,
        phone: providers.phone,
        whatsapp: providers.whatsapp,
        instagram: providers.instagram,
        facebook: providers.facebook,
        mpesaPhone: providers.mpesaPhone,
        priceFrom: providers.priceFrom,
        ratingAvg: providers.ratingAvg,
        reviewCount: providers.reviewCount,
        isVerified: providers.isVerified,
        isOpen: providers.isOpen,
        createdAt: providers.createdAt,
        updatedAt: providers.updatedAt,
        categoryName: categories.name,
        categorySlug: categories.slug,
      })
      .from(providers)
      .leftJoin(categories, eq(providers.categoryId, categories.id))
      .where(and(eq(providers.id, id), ne(providers.adminStatus, "deleted")))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    await reconcilePendingPaymentsForProviders([id]);
    const details = await fetchProviderDetails([id]);
    const provider = buildProviderRecord(
      row,
      details.servicesByProvider,
      details.mediaByProvider,
      details.hoursByProvider,
      details.subscriptionByProvider,
      currentUser
    );

    if (!allowUnsubscribedPreview && !provider.isSubscribed && !isOwnerOrAdmin(provider.ownerUserId, currentUser)) {
      return null;
    }

    return provider;
  },
});
