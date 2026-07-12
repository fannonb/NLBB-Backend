import crypto from "crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { bookingStatusHistory, bookings, providerServices, providers, reviews, userProfiles } from "../db/schema";
import type { Booking, BookingStatus, Provider, UserRole } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { createNotification } from "./notificationPgService";
import { getProviderById } from "./providerService";

export const createBookingSchema = z
  .object({
    providerId: z.string().min(1),
    serviceId: z.string().min(1).optional(),
    serviceName: z.string().min(2).optional(),
    servicePrice: z.number().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    scheduledAt: z.string().datetime(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.serviceId && !value.serviceName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceId"],
        message: "Either serviceId or serviceName is required",
      });
    }
  });

export const updateBookingStatusSchema = z.object({
  status: z
    .enum([
      "accepted",
      "confirmed",
      "upcoming",
      "rejected",
      "declined",
      "completed",
      "cancelled",
    ])
    .transform((value): BookingStatus => {
      const statusMap: Record<string, BookingStatus> = {
        accepted: "accepted",
        confirmed: "accepted",
        upcoming: "accepted",
        rejected: "rejected",
        declined: "rejected",
        completed: "completed",
        cancelled: "cancelled",
      };
      return statusMap[value];
    }),
});

const canTransition = (current: BookingStatus, next: BookingStatus) => {
  const allowedTransitions: Record<BookingStatus, BookingStatus[]> = {
    pending: ["accepted", "rejected", "cancelled"],
    accepted: ["completed", "cancelled"],
    rejected: [],
    completed: [],
    cancelled: [],
  };
  return allowedTransitions[current].includes(next);
};

const makeBookingRef = () => `#NLBB-${crypto.randomInt(1000, 9999)}-${new Date().getFullYear()}`;

const hasTimeOverlap = (startA: Date, endA: Date, startB: Date, endB: Date) =>
  startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();

const getCustomerBookingNotificationCopy = (
  status: BookingStatus,
  booking: {
    providerName?: string;
    serviceName?: string;
  }
) => {
  const providerName = booking.providerName?.trim() || "your provider";
  const serviceName = booking.serviceName?.trim() || "your service";

  switch (status) {
    case "accepted":
      return {
        title: "Booking Confirmed",
        body: `${providerName} confirmed your booking for ${serviceName}.`,
      };
    case "rejected":
      return {
        title: "Booking Declined",
        body: `${providerName} declined your booking for ${serviceName}.`,
      };
    case "completed":
      return {
        title: "Appointment Completed",
        body: `Your booking for ${serviceName} with ${providerName} was marked as completed.`,
      };
    case "cancelled":
      return {
        title: "Booking Cancelled",
        body: `Your booking for ${serviceName} with ${providerName} was cancelled.`,
      };
    default:
      return {
        title: "Booking Updated",
        body: `Your booking for ${serviceName} with ${providerName} was updated.`,
      };
  }
};

type BookingView = Booking & {
  providerImage?: string | null;
  providerPhone?: string | null;
  providerWhatsapp?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAvatar?: string | null;
  reviewId?: string | null;
};

const normalizeServiceName = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const isMissingBookingServiceNameColumnError = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  const code = candidate.code ?? candidate.cause?.code;
  const message = candidate.message ?? candidate.cause?.message ?? "";

  return code === "42703" && message.toLowerCase().includes("service_name");
};

const enrichBooking = async (booking: Booking): Promise<BookingView> => {
  const db = getDb();
  const [providerDoc, customerProfile] = await Promise.all([
    getProviderById(booking.providerId, { uid: booking.customerId, role: "customer" }),
    db.select().from(userProfiles).where(eq(userProfiles.userId, booking.customerId)).limit(1).then((rows) => rows[0] ?? null),
  ]);

  const service = providerDoc?.services.find((s) => s.id === booking.providerServiceId);
  const priceMatchedServices = providerDoc?.services.filter((s) => s.price === booking.servicePrice) ?? [];
  const inferredService = priceMatchedServices.length === 1 ? priceMatchedServices[0] : null;

  return {
    ...booking,
    providerName: providerDoc?.name ?? booking.providerName ?? "",
    serviceName:
      normalizeServiceName(service?.name) ??
      normalizeServiceName(inferredService?.name) ??
      normalizeServiceName(booking.serviceName) ??
      "Service",
    providerImage: providerDoc?.coverImage ?? providerDoc?.avatar ?? null,
    providerPhone: providerDoc?.phone ?? null,
    providerWhatsapp: providerDoc?.whatsapp ?? null,
    customerName: customerProfile?.fullName ?? null,
    customerPhone: undefined,
    customerAvatar: customerProfile?.avatarUrl ?? null,
    reviewId: booking.reviewId ?? null,
  };
};

const mapBookingRow = (row: {
  id: string;
  referenceCode: string;
  customerUserId: string;
  providerId: string;
  providerServiceId: string | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  status: string;
  notes: string | null;
  servicePriceAmount: string;
  totalAmount: string;
  bookedServiceName: string | null;
  linkedServiceName: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewId: string | null;
}) =>
  ({
    id: row.id,
    ref: row.referenceCode,
    customerId: row.customerUserId,
    providerId: row.providerId,
    providerName: "",
    serviceName:
      normalizeServiceName(row.bookedServiceName) ??
      normalizeServiceName(row.linkedServiceName) ??
      "Service",
    servicePrice: Number(row.servicePriceAmount),
    scheduledAt: row.scheduledStartAt.toISOString(),
    endAt: row.scheduledEndAt.toISOString(),
    duration: Math.max(1, Math.round((row.scheduledEndAt.getTime() - row.scheduledStartAt.getTime()) / 60000)),
    status: row.status as BookingStatus,
    notes: row.notes ?? undefined,
    totalAmount: Number(row.totalAmount),
    platformFee: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    providerServiceId: row.providerServiceId,
    reviewId: row.reviewId,
  }) satisfies Booking;

const bookingRowSelection = {
  id: bookings.id,
  referenceCode: bookings.referenceCode,
  customerUserId: bookings.customerUserId,
  providerId: bookings.providerId,
  providerServiceId: bookings.providerServiceId,
  scheduledStartAt: bookings.scheduledStartAt,
  scheduledEndAt: bookings.scheduledEndAt,
  status: bookings.status,
  notes: bookings.notes,
  servicePriceAmount: bookings.servicePriceAmount,
  totalAmount: bookings.totalAmount,
  bookedServiceName: bookings.serviceName,
  linkedServiceName: providerServices.name,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
  reviewId: reviews.id,
};

const legacyBookingRowSelection = {
  id: bookings.id,
  referenceCode: bookings.referenceCode,
  customerUserId: bookings.customerUserId,
  providerId: bookings.providerId,
  providerServiceId: bookings.providerServiceId,
  scheduledStartAt: bookings.scheduledStartAt,
  scheduledEndAt: bookings.scheduledEndAt,
  status: bookings.status,
  notes: bookings.notes,
  servicePriceAmount: bookings.servicePriceAmount,
  totalAmount: bookings.totalAmount,
  bookedServiceName: sql<string | null>`null`,
  linkedServiceName: providerServices.name,
  createdAt: bookings.createdAt,
  updatedAt: bookings.updatedAt,
  reviewId: reviews.id,
};

export const createBooking = async (
  customerId: string,
  payload: z.infer<typeof createBookingSchema>
) => {
  const db = getDb();
  const provider = await getProviderById(payload.providerId, { uid: customerId, role: "customer" });
  if (!provider) {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }
  if (!provider.isOpen) {
    throw new ApiError(400, "Provider is currently closed", "PROVIDER_CLOSED");
  }

  const normalizedServiceName = payload.serviceName?.trim().toLowerCase();
  const resolvedService = payload.serviceId
    ? provider.services.find((service) => service.id === payload.serviceId)
    : provider.services.find((service) => normalizedServiceName && service.name.trim().toLowerCase() === normalizedServiceName);

  if (!resolvedService) {
    throw new ApiError(400, "Selected service does not exist", "SERVICE_NOT_FOUND");
  }
  if (resolvedService.isActive === false) {
    throw new ApiError(400, "Selected service is unavailable", "SERVICE_INACTIVE");
  }

  const scheduledAtDate = new Date(payload.scheduledAt);
  if (scheduledAtDate.getTime() <= Date.now()) {
    throw new ApiError(400, "Booking date must be in the future", "INVALID_BOOKING_TIME");
  }

  const endAtDate = new Date(scheduledAtDate.getTime() + resolvedService.duration * 60_000);
  const existingBookings = await db.select().from(bookings).where(eq(bookings.providerId, payload.providerId));
  const conflictingBooking = existingBookings.find((booking) => {
    if (!["pending", "accepted"].includes(booking.status)) {
      return false;
    }
    return hasTimeOverlap(scheduledAtDate, endAtDate, booking.scheduledStartAt, booking.scheduledEndAt);
  });

  if (conflictingBooking) {
    throw new ApiError(409, "Selected time slot is not available", "BOOKING_TIME_CONFLICT", {
      conflictingBookingId: conflictingBooking.id,
    });
  }

  const now = new Date();
  let bookingRow;
  try {
    [bookingRow] = await db
      .insert(bookings)
      .values({
        referenceCode: makeBookingRef(),
        customerUserId: customerId,
        providerId: payload.providerId,
        providerServiceId: resolvedService.id,
        scheduledStartAt: scheduledAtDate,
        scheduledEndAt: endAtDate,
        status: "pending",
        notes: payload.notes ?? null,
        serviceName: resolvedService.name,
        servicePriceAmount: resolvedService.price.toString(),
        totalAmount: resolvedService.price.toString(),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } catch (error) {
    if (!isMissingBookingServiceNameColumnError(error)) {
      throw error;
    }

    [bookingRow] = await db
      .insert(bookings)
      .values({
        referenceCode: makeBookingRef(),
        customerUserId: customerId,
        providerId: payload.providerId,
        providerServiceId: resolvedService.id,
        scheduledStartAt: scheduledAtDate,
        scheduledEndAt: endAtDate,
        status: "pending",
        notes: payload.notes ?? null,
        servicePriceAmount: resolvedService.price.toString(),
        totalAmount: resolvedService.price.toString(),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }

  await db.insert(bookingStatusHistory).values({
    bookingId: bookingRow.id,
    fromStatus: null,
    toStatus: "pending",
    actorUserId: customerId,
    reason: "Booking created",
    createdAt: now,
  });

  await createNotification({
    userId: provider.ownerUserId,
    title: "New Booking Request",
    body: `You have a new booking request for ${resolvedService.name}.`,
    type: "booking",
    actionType: "provider_appointment_detail",
    actionId: bookingRow.id,
  });

  await createNotification({
    userId: customerId,
    title: "Booking Request Sent",
    body: `Your request for ${resolvedService.name} with ${provider.name} has been sent.`,
    type: "booking",
    actionType: "customer_bookings",
    actionId: bookingRow.id,
  });

  return enrichBooking({
    id: bookingRow.id,
    ref: bookingRow.referenceCode,
    customerId,
    providerId: payload.providerId,
    providerName: provider.name,
    serviceName: resolvedService.name,
    servicePrice: resolvedService.price,
    scheduledAt: scheduledAtDate.toISOString(),
    endAt: endAtDate.toISOString(),
    duration: resolvedService.duration,
    status: "pending",
    notes: payload.notes,
    totalAmount: resolvedService.price,
    platformFee: 0,
    createdAt: bookingRow.createdAt.toISOString(),
    updatedAt: bookingRow.updatedAt.toISOString(),
    providerServiceId: bookingRow.providerServiceId ?? resolvedService.id,
  });
};

export const listBookingsForUser = async (uid: string, role: UserRole) => {
  const db = getDb();
  let rows;
  if (role === "provider") {
    const [provider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.ownerUserId, uid)).limit(1);
    if (!provider) {
      return [];
    }
    try {
      rows = await db
        .select(bookingRowSelection)
        .from(bookings)
        .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
        .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
        .where(eq(bookings.providerId, provider.id))
        .orderBy(desc(bookings.createdAt));
    } catch (error) {
      if (!isMissingBookingServiceNameColumnError(error)) {
        throw error;
      }
      rows = await db
        .select(legacyBookingRowSelection)
        .from(bookings)
        .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
        .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
        .where(eq(bookings.providerId, provider.id))
        .orderBy(desc(bookings.createdAt));
    }
  } else {
    try {
      rows = await db
        .select(bookingRowSelection)
        .from(bookings)
        .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
        .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
        .where(eq(bookings.customerUserId, uid))
        .orderBy(desc(bookings.createdAt));
    } catch (error) {
      if (!isMissingBookingServiceNameColumnError(error)) {
        throw error;
      }
      rows = await db
        .select(legacyBookingRowSelection)
        .from(bookings)
        .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
        .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
        .where(eq(bookings.customerUserId, uid))
        .orderBy(desc(bookings.createdAt));
    }
  }

  const bookingsList = rows.map((row) => mapBookingRow(row));
  return Promise.all(bookingsList.map((booking) => enrichBooking(booking)));
};

export const updateBookingStatus = async (
  bookingId: string,
  actor: { uid: string; role: UserRole },
  nextStatus: BookingStatus
) => {
  const db = getDb();
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!row) {
    throw new ApiError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "provider") {
    const [provider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.ownerUserId, actor.uid)).limit(1);
    if (!provider || provider.id !== row.providerId) {
      throw new ApiError(403, "Cannot manage this booking", "FORBIDDEN");
    }
  } else if (actor.role === "customer") {
    if (row.customerUserId !== actor.uid || nextStatus !== "cancelled") {
      throw new ApiError(403, "Customers can only cancel their own bookings", "FORBIDDEN");
    }
  }

  if (!canTransition(row.status as BookingStatus, nextStatus)) {
    throw new ApiError(400, `Cannot transition booking from ${row.status} to ${nextStatus}`, "INVALID_STATUS_TRANSITION");
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();

  await db.insert(bookingStatusHistory).values({
    bookingId,
    fromStatus: row.status,
    toStatus: nextStatus,
    actorUserId: actor.uid,
    reason: null,
    createdAt: new Date(),
  });

  let updatedRow;
  try {
    [updatedRow] = await db
      .select(bookingRowSelection)
      .from(bookings)
      .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
      .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
      .where(eq(bookings.id, updated.id))
      .limit(1);
  } catch (error) {
    if (!isMissingBookingServiceNameColumnError(error)) {
      throw error;
    }
    [updatedRow] = await db
      .select(legacyBookingRowSelection)
      .from(bookings)
      .leftJoin(providerServices, eq(bookings.providerServiceId, providerServices.id))
      .leftJoin(reviews, eq(bookings.id, reviews.bookingId))
      .where(eq(bookings.id, updated.id))
      .limit(1);
  }

  if (!updatedRow) {
    throw new ApiError(500, "Could not reload booking after update", "BOOKING_RELOAD_FAILED");
  }

  const booking = mapBookingRow(updatedRow);
  const enrichedBooking = await enrichBooking(booking);
  const customerNotification = getCustomerBookingNotificationCopy(nextStatus, enrichedBooking);

  await createNotification({
    userId: row.customerUserId,
    title: customerNotification.title,
    body: customerNotification.body,
    type: "booking",
    actionType: "customer_bookings",
    actionId: updated.id,
  });

  if (actor.role === "customer" && nextStatus === "cancelled") {
    const [provider] = await db
      .select({ ownerUserId: providers.ownerUserId })
      .from(providers)
      .where(eq(providers.id, row.providerId))
      .limit(1);

    if (provider) {
      await createNotification({
        userId: provider.ownerUserId,
        title: "Booking Cancelled",
        body: `${enrichedBooking.customerName ?? "A customer"} cancelled ${enrichedBooking.serviceName}.`,
        type: "booking",
        actionType: "provider_appointment_detail",
        actionId: updated.id,
      });
    }
  }

  return enrichedBooking;
};
