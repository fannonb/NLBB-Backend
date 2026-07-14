import crypto from "crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import {
  categories,
  providerMedia,
  providerServices,
  providerVerificationEvents,
  providerWorkingHours,
  providers,
} from "../db/schema";
import type { Provider, Service, WorkingHoursDay } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { allSlugsForCanonical, canonicalCategorySlug } from "../utils/categorySlug";

export const providerServiceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  description: z.string().min(2),
  duration: z.number().int().positive().optional().default(60),
  price: z.number().nonnegative(),
  category: z.string().min(2),
  isActive: z.boolean().optional(),
});

export const createProviderServiceSchema = providerServiceSchema.partial({ id: true });

export const updateProviderServiceSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  duration: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  category: z.string().min(2).optional(),
  isActive: z.boolean().optional(),
});

export const setProviderServiceActiveSchema = z.object({
  isActive: z.boolean(),
});

export const workingHoursSchema = z.object({
  day: z.string().min(2),
  isOpen: z.boolean(),
  openTime: z.string(),
  closeTime: z.string(),
}).superRefine((value, ctx) => {
  if (!value.isOpen) {
    return;
  }

  if (value.openTime.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openTime"],
      message: "Open time is required for open days",
    });
  }

  if (value.closeTime.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["closeTime"],
      message: "Close time is required for open days",
    });
  }
});

export const upsertProviderSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  categories: z.array(z.string().min(2)).min(1).optional(),
  description: z.string().min(10),
  location: z.string().min(2),
  address: z.string().min(2),
  phone: z.string().min(9),
  whatsapp: z.string().min(9).optional(),
  openTime: z.string().min(2),
  closeTime: z.string().min(2),
  workDays: z.string().min(2),
  priceFrom: z.number().nonnegative(),
  services: z.array(providerServiceSchema).optional(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
  coverImage: z.string().url().optional(),
  avatar: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  galleryImages: z.array(z.string().url()).optional(),
  workingHours: z.array(workingHoursSchema).optional(),
  instagram: z.string().min(1).optional(),
  facebook: z.string().min(1).optional(),
  mpesaPhone: z.string().min(9).optional(),
});

export const registrationDetailsSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
  categories: z.array(z.string().min(2)).min(1).optional(),
  location: z.string().min(2),
  address: z.string().min(2).optional(),
  phone: z.string().min(9).optional(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
});

const weekdayMap: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const weekdayNameMap: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const toCategoryName = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeCategoryList = (categoriesInput: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const category of categoriesInput) {
    const trimmed = category?.trim();
    if (!trimmed) {
      continue;
    }

    const canonical = toCategoryName(trimmed);
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(canonical);
  }

  return normalized;
};

const resolveSelectedCategories = (payload: {
  category: string;
  categories?: string[];
}) => normalizeCategoryList([...(payload.categories ?? []), payload.category]);

const toWorkingHours = (rows: Array<{ weekday: number; isOpen: boolean; openTime: string | null; closeTime: string | null }>): WorkingHoursDay[] =>
  rows
    .sort((a, b) => a.weekday - b.weekday)
    .map((row) => ({
      day: weekdayNameMap[row.weekday] ?? "Monday",
      isOpen: row.isOpen,
      openTime: row.openTime ?? "",
      closeTime: row.closeTime ?? "",
    }));

const getOrCreateCategoryId = async (name: string) => {
  const db = getDb();
  const rawSlug = toSlug(name);
  const canonical = canonicalCategorySlug(rawSlug);
  const slugVariants = allSlugsForCanonical(canonical);

  const existingRows = await db.select().from(categories).where(inArray(categories.slug, slugVariants));

  if (existingRows.length > 0) {
    const preferred =
      existingRows.find((row) => row.slug === canonical) ??
      existingRows.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))[0];
    return preferred.id;
  }

  const [created] = await db
    .insert(categories)
    .values({
      name: toCategoryName(name),
      slug: canonical,
      sortOrder: 0,
      isActive: true,
      createdAt: new Date(),
    })
    .returning();
  return created.id;
};

const getActiveCategory = async (name: string) => {
  const db = getDb();
  const canonical = canonicalCategorySlug(toSlug(name));
  const slugVariants = allSlugsForCanonical(canonical);
  const rows = await db
    .select()
    .from(categories)
    .where(and(inArray(categories.slug, slugVariants), eq(categories.isActive, true)));

  const category =
    rows.find((row) => row.slug === canonical) ??
    rows.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))[0];

  if (!category) {
    throw new ApiError(
      400,
      "Select an active service category created by the administrator.",
      "CATEGORY_NOT_AVAILABLE"
    );
  }

  return category;
};

const loadProvider = async (providerId: string) => {
  const db = getDb();
  const [providerRow] = await db
    .select({
      id: providers.id,
      ownerUserId: providers.ownerUserId,
      categoryId: providers.categoryId,
      serviceCategories: providers.serviceCategories,
      name: providers.name,
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
      adminStatus: providers.adminStatus,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      categoryName: categories.name,
    })
    .from(providers)
    .leftJoin(categories, eq(providers.categoryId, categories.id))
    .where(eq(providers.id, providerId))
    .limit(1);

  if (!providerRow) {
    return null;
  }

  const [serviceRows, mediaRows, hourRows] = await Promise.all([
    db
      .select({
        id: providerServices.id,
        name: providerServices.name,
        description: providerServices.description,
        durationMinutes: providerServices.durationMinutes,
        priceAmount: providerServices.priceAmount,
        isActive: providerServices.isActive,
        sortOrder: providerServices.sortOrder,
        categoryName: categories.name,
      })
      .from(providerServices)
      .leftJoin(categories, eq(providerServices.categoryId, categories.id))
      .where(eq(providerServices.providerId, providerId))
      .orderBy(asc(providerServices.sortOrder), asc(providerServices.name)),
    db
      .select({
        kind: providerMedia.kind,
        storageKey: providerMedia.storageKey,
        publicUrl: providerMedia.publicUrl,
        sortOrder: providerMedia.sortOrder,
      })
      .from(providerMedia)
      .where(eq(providerMedia.providerId, providerId))
      .orderBy(asc(providerMedia.sortOrder), asc(providerMedia.createdAt)),
    db
      .select({
        weekday: providerWorkingHours.weekday,
        isOpen: providerWorkingHours.isOpen,
        openTime: providerWorkingHours.openTime,
        closeTime: providerWorkingHours.closeTime,
      })
      .from(providerWorkingHours)
      .where(eq(providerWorkingHours.providerId, providerId))
      .orderBy(asc(providerWorkingHours.weekday)),
  ]);

  const galleryImages = mediaRows.filter((row) => row.kind === "gallery").map((row) => row.publicUrl ?? row.storageKey);
  const coverImage = mediaRows.find((row) => row.kind === "cover")?.publicUrl ?? null;
  const avatar = mediaRows.find((row) => row.kind === "avatar")?.publicUrl ?? null;
  const workingHours = toWorkingHours(hourRows);

  const provider: Provider = {
    id: providerRow.id,
    ownerUserId: providerRow.ownerUserId,
    name: providerRow.name,
    category: providerRow.serviceCategories?.trim() || providerRow.categoryName || "General",
    description: providerRow.description ?? "",
    avatar: avatar ?? undefined,
    coverImage: coverImage ?? undefined,
    images: galleryImages,
    rating: Number(providerRow.ratingAvg ?? 0),
    reviewCount: providerRow.reviewCount ?? 0,
    location: providerRow.location ?? "",
    address: providerRow.address ?? "",
    coordinates:
      providerRow.latitude !== null && providerRow.longitude !== null
        ? {
            lat: Number(providerRow.latitude),
            lng: Number(providerRow.longitude),
          }
        : undefined,
    phone: providerRow.phone ?? undefined,
    whatsapp: providerRow.whatsapp ?? undefined,
    instagram: providerRow.instagram ?? undefined,
    facebook: providerRow.facebook ?? undefined,
    mpesaPhone: providerRow.mpesaPhone ?? undefined,
    openTime: workingHours[0]?.openTime ?? "",
    closeTime: workingHours[0]?.closeTime ?? "",
    workDays: workingHours.filter((entry) => entry.isOpen).map((entry) => entry.day).join(", "),
    workingHours,
    priceFrom: Number(providerRow.priceFrom ?? 0),
    isVerified: providerRow.isVerified,
    isOpen: providerRow.isOpen,
    services: serviceRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      duration: row.durationMinutes,
      price: Number(row.priceAmount ?? 0),
      category: row.categoryName ?? providerRow.categoryName ?? "General",
      isActive: row.isActive,
    })),
    galleryImages,
    createdAt: providerRow.createdAt.toISOString(),
    updatedAt: providerRow.updatedAt.toISOString(),
  };

  return provider;
};

const syncProviderMedia = async (providerId: string, payload: z.infer<typeof upsertProviderSchema>) => {
  const db = getDb();
  await db.delete(providerMedia).where(eq(providerMedia.providerId, providerId));

  const rows = [
    ...(payload.coverImage
      ? [
          {
            providerId,
            kind: "cover",
            storageKey: payload.coverImage,
            publicUrl: payload.coverImage,
            mimeType: null,
            fileSize: null,
            sortOrder: 0,
            createdAt: new Date(),
          },
        ]
      : []),
    ...(payload.avatar
      ? [
          {
            providerId,
            kind: "avatar",
            storageKey: payload.avatar,
            publicUrl: payload.avatar,
            mimeType: null,
            fileSize: null,
            sortOrder: 0,
            createdAt: new Date(),
          },
        ]
      : []),
    ...[...(payload.galleryImages ?? payload.images ?? [])].map((url, index) => ({
      providerId,
      kind: "gallery",
      storageKey: url,
      publicUrl: url,
      mimeType: null,
      fileSize: null,
      sortOrder: index,
      createdAt: new Date(),
    })),
  ];

  if (rows.length > 0) {
    await db.insert(providerMedia).values(rows);
  }
};

const syncWorkingHours = async (providerId: string, payload: z.infer<typeof upsertProviderSchema>) => {
  const db = getDb();
  await db.delete(providerWorkingHours).where(eq(providerWorkingHours.providerId, providerId));
  const hours = payload.workingHours ?? [];
  if (hours.length === 0) {
    return;
  }
  await db.insert(providerWorkingHours).values(
    hours.map((entry) => ({
      providerId,
      weekday: weekdayMap[entry.day.toLowerCase()] ?? 0,
      isOpen: entry.isOpen,
      openTime: entry.openTime.trim() || null,
      closeTime: entry.closeTime.trim() || null,
    }))
  );
};

const replaceServices = async (
  providerId: string,
  categoryId: string | null,
  services: Array<z.infer<typeof providerServiceSchema>>
) => {
  const db = getDb();
  await db.delete(providerServices).where(eq(providerServices.providerId, providerId));
  if (services.length === 0) {
    return 0;
  }
  await db.insert(providerServices).values(
    services.map((service, index) => ({
      id: service.id ?? crypto.randomUUID(),
      providerId,
      categoryId,
      name: service.name,
      description: service.description,
      durationMinutes: service.duration,
      priceAmount: service.price.toString(),
      isActive: service.isActive ?? true,
      sortOrder: index,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  const active = services.filter((service) => service.isActive !== false).map((service) => service.price);
  return active.length > 0 ? Math.min(...active) : 0;
};

export const upsertProviderProfile = async (
  ownerUserId: string,
  payload: z.infer<typeof upsertProviderSchema>
) => {
  const db = getDb();
  const selectedCategories = resolveSelectedCategories(payload);
  const primaryCategory = selectedCategories[0] ?? toCategoryName(payload.category);
  const categoryId = await getOrCreateCategoryId(primaryCategory);
  const serializedCategories = selectedCategories.join(", ");
  const [existing] = await db.select().from(providers).where(eq(providers.ownerUserId, ownerUserId)).limit(1);
  const now = new Date();

  if (existing?.adminStatus === "deleted") {
    throw new ApiError(403, "This provider account is no longer available", "PROVIDER_DELETED");
  }

  if (!existing) {
    const [created] = await db
      .insert(providers)
      .values({
        ownerUserId,
        categoryId,
        serviceCategories: serializedCategories,
        name: payload.name,
        description: payload.description,
        location: payload.location,
        address: payload.address,
        latitude: payload.coordinates?.lat.toString() ?? null,
        longitude: payload.coordinates?.lng.toString() ?? null,
        phone: payload.phone,
        whatsapp: payload.whatsapp ?? payload.phone,
        instagram: payload.instagram,
        facebook: payload.facebook,
        mpesaPhone: payload.mpesaPhone ?? payload.phone,
        priceFrom: payload.priceFrom.toString(),
        ratingAvg: "0",
        reviewCount: 0,
        isVerified: false,
        isOpen: true,
        adminStatus: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const priceFrom = payload.services
      ? await replaceServices(created.id, categoryId, payload.services)
      : payload.priceFrom;
    await syncWorkingHours(created.id, payload);
    await syncProviderMedia(created.id, payload);
    await db
      .update(providers)
      .set({
        priceFrom: (priceFrom || payload.priceFrom).toString(),
        updatedAt: new Date(),
      })
      .where(eq(providers.id, created.id));

    return loadProvider(created.id);
  }

  await db
    .update(providers)
    .set({
      categoryId,
      serviceCategories: serializedCategories,
      name: existing.name,
      description: payload.description,
      location: payload.location,
      address: payload.address,
      latitude: payload.coordinates?.lat.toString() ?? null,
      longitude: payload.coordinates?.lng.toString() ?? null,
      phone: payload.phone,
      whatsapp: payload.whatsapp ?? payload.phone,
      instagram: payload.instagram,
      facebook: payload.facebook,
      mpesaPhone: payload.mpesaPhone ?? payload.phone,
      priceFrom: payload.priceFrom.toString(),
      updatedAt: now,
    })
    .where(eq(providers.id, existing.id));

  const priceFrom = payload.services
    ? await replaceServices(existing.id, categoryId, payload.services)
    : payload.priceFrom;
  await syncWorkingHours(existing.id, payload);
  await syncProviderMedia(existing.id, payload);
  if (payload.services && priceFrom > 0) {
    await db
      .update(providers)
      .set({ priceFrom: priceFrom.toString(), updatedAt: new Date() })
      .where(eq(providers.id, existing.id));
  }
  return loadProvider(existing.id);
};

const recalculateProviderPriceFrom = async (providerId: string) => {
  const db = getDb();
  const activeServices = await db
    .select({ priceAmount: providerServices.priceAmount })
    .from(providerServices)
    .where(
      and(
        eq(providerServices.providerId, providerId),
        eq(providerServices.isActive, true)
      )
    );

  let minPrice = 0;
  if (activeServices.length > 0) {
    const prices = activeServices
      .map((s) => Number(s.priceAmount))
      .filter((p) => !isNaN(p) && p > 0);
    if (prices.length > 0) {
      minPrice = Math.min(...prices);
    }
  }

  await db
    .update(providers)
    .set({
      priceFrom: minPrice.toString(),
      updatedAt: new Date(),
    })
    .where(eq(providers.id, providerId));
};

export const listProviderServices = async (ownerUid: string) => {
  const provider = await getProviderByOwnerUid(ownerUid);
  return provider?.services ?? [];
};

export const addProviderService = async (
  ownerUid: string,
  payload: z.infer<typeof createProviderServiceSchema>
) => {
  const db = getDb();
  const provider = await getProviderByOwnerUid(ownerUid);
  if (!provider) {
    throw new ApiError(404, "Provider profile missing", "PROVIDER_NOT_FOUND");
  }

  const category = await getActiveCategory(payload.category);
  const id = payload.id ?? crypto.randomUUID();
  await db.insert(providerServices).values({
    id,
    providerId: provider.id,
    categoryId: category.id,
    name: payload.name,
    description: payload.description,
    durationMinutes: payload.duration ?? 60,
    priceAmount: payload.price.toString(),
    isActive: payload.isActive ?? true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await recalculateProviderPriceFrom(provider.id);

  return {
    id,
    name: payload.name,
    description: payload.description,
    duration: payload.duration ?? 60,
    price: payload.price,
    category: category.name,
    isActive: payload.isActive ?? true,
  } satisfies Service;
};

export const updateProviderService = async (
  ownerUid: string,
  serviceId: string,
  payload: z.infer<typeof updateProviderServiceSchema>
) => {
  const db = getDb();
  const provider = await getProviderByOwnerUid(ownerUid);
  if (!provider) {
    throw new ApiError(404, "Provider profile missing", "PROVIDER_NOT_FOUND");
  }

  const [existing] = await db
    .select()
    .from(providerServices)
    .where(and(eq(providerServices.id, serviceId), eq(providerServices.providerId, provider.id)))
    .limit(1);
  if (!existing) {
    throw new ApiError(404, "Service not found", "SERVICE_NOT_FOUND");
  }

  const selectedCategory = payload.category
    ? await getActiveCategory(payload.category)
    : existing.categoryId
      ? (await db.select().from(categories).where(eq(categories.id, existing.categoryId)).limit(1))[0]
      : null;
  await db
    .update(providerServices)
    .set({
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      durationMinutes: payload.duration ?? existing.durationMinutes ?? 60,
      priceAmount: (payload.price ?? Number(existing.priceAmount)).toString(),
      categoryId: selectedCategory?.id ?? existing.categoryId,
      isActive: payload.isActive ?? existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(providerServices.id, serviceId));

  await recalculateProviderPriceFrom(provider.id);

  return {
    id: existing.id,
    name: payload.name ?? existing.name,
    description: payload.description ?? existing.description ?? "",
    duration: payload.duration ?? existing.durationMinutes ?? 60,
    price: payload.price ?? Number(existing.priceAmount),
    category:
      selectedCategory?.name ??
      provider.services.find((service) => service.id === existing.id)?.category ??
      "General",
    isActive: payload.isActive ?? existing.isActive,
  } satisfies Service;
};

export const setProviderServiceActive = async (
  ownerUid: string,
  serviceId: string,
  isActive: boolean
) => {
  const result = await updateProviderService(ownerUid, serviceId, { isActive });
  return result;
};

export const deleteProviderService = async (ownerUid: string, serviceId: string) => {
  const db = getDb();
  const provider = await getProviderByOwnerUid(ownerUid);
  if (!provider) {
    throw new ApiError(404, "Provider profile missing", "PROVIDER_NOT_FOUND");
  }

  const [existing] = await db
    .select()
    .from(providerServices)
    .where(and(eq(providerServices.id, serviceId), eq(providerServices.providerId, provider.id)))
    .limit(1);
  if (!existing) {
    throw new ApiError(404, "Service not found", "SERVICE_NOT_FOUND");
  }

  await db.delete(providerServices).where(eq(providerServices.id, serviceId));
  await recalculateProviderPriceFrom(provider.id);

  return { deleted: true, id: serviceId };
};

export const setProviderVerification = async (providerId: string, isVerified: boolean) => {
  const db = getDb();
  const [existing] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!existing) {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }

  await db
    .update(providers)
    .set({
      isVerified,
      adminStatus: isVerified ? "approved" : "pending",
      updatedAt: new Date(),
    })
    .where(eq(providers.id, providerId));

  await db.insert(providerVerificationEvents).values({
    providerId,
    actorUserId: null,
    fromStatus: existing.adminStatus,
    toStatus: isVerified ? "approved" : "pending",
    reason: isVerified ? "Admin verification" : "Verification revoked",
    createdAt: new Date(),
  });

  const { id: _existingId, ...rest } = existing;
  return { ...rest, id: providerId, isVerified };
};

export const setProviderOpenState = async (providerId: string, isOpen: boolean) => {
  const db = getDb();
  const [existing] = await db.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!existing) {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }

  await db
    .update(providers)
    .set({ isOpen, updatedAt: new Date() })
    .where(eq(providers.id, providerId));

  const { id: _existingId, ...rest } = existing;
  return { ...rest, id: providerId, isOpen };
};

export const updateProviderRegistrationDetails = async (
  ownerUserId: string,
  payload: z.infer<typeof registrationDetailsSchema>
) => {
  const db = getDb();
  const selectedCategories = resolveSelectedCategories(payload);
  const primaryCategory = selectedCategories[0] ?? toCategoryName(payload.category);
  const categoryId = await getOrCreateCategoryId(primaryCategory);
  const serializedCategories = selectedCategories.join(", ");
  const now = new Date();
  const [existing] = await db.select().from(providers).where(eq(providers.ownerUserId, ownerUserId)).limit(1);

  if (existing?.adminStatus === "deleted") {
    throw new ApiError(403, "This provider account is no longer available", "PROVIDER_DELETED");
  }

  if (!existing) {
    const [created] = await db
      .insert(providers)
      .values({
        ownerUserId,
        categoryId,
        serviceCategories: serializedCategories,
        name: payload.name,
        description: null,
        location: payload.location,
        address: payload.address ?? payload.location,
        latitude: payload.coordinates?.lat.toString() ?? null,
        longitude: payload.coordinates?.lng.toString() ?? null,
        phone: payload.phone ?? null,
        whatsapp: payload.phone ?? null,
        instagram: null,
        facebook: null,
        mpesaPhone: payload.phone ?? null,
        priceFrom: "0",
        ratingAvg: "0",
        reviewCount: 0,
        isVerified: false,
        isOpen: false,
        adminStatus: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return loadProvider(created.id);
  }

  await db
    .update(providers)
    .set({
      categoryId,
      serviceCategories: serializedCategories,
      name: existing.name,
      location: payload.location,
      address: payload.address ?? payload.location,
      latitude: payload.coordinates?.lat.toString() ?? null,
      longitude: payload.coordinates?.lng.toString() ?? null,
      phone: payload.phone ?? existing.phone,
      whatsapp: payload.phone ?? existing.whatsapp,
      mpesaPhone: payload.phone ?? existing.mpesaPhone,
      updatedAt: now,
    })
    .where(eq(providers.id, existing.id));

  return loadProvider(existing.id);
};

export const getProviderByOwnerUid = async (ownerUid: string) => {
  const db = getDb();
  const [provider] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.ownerUserId, ownerUid), ne(providers.adminStatus, "deleted")))
    .limit(1);
  if (!provider) {
    return null;
  }
  return loadProvider(provider.id);
};
