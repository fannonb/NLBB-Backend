import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { bookings, providerServices, providers, reviews, userProfiles } from "../db/schema";
import type { Review } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { createNotification } from "./notificationPgService";

export const createReviewSchema = z.object({
  providerId: z.string().min(1),
  bookingId: z.string().min(1),
  serviceName: z.string().min(2).optional(),
  rating: z.number().min(1).max(5),
  comment: z.string().min(2).max(1000),
});

const recomputeProviderRating = async (providerId: string) => {
  const db = getDb();
  const rows = await db.select().from(reviews).where(eq(reviews.providerId, providerId));
  const reviewCount = rows.length;
  const averageRating =
    reviewCount === 0
      ? 0
      : Number((rows.reduce((sum, review) => sum + review.rating, 0) / reviewCount).toFixed(1));

  await db
    .update(providers)
    .set({
      ratingAvg: averageRating.toString(),
      reviewCount,
      updatedAt: new Date(),
    })
    .where(eq(providers.id, providerId));

  return { rating: averageRating, reviewCount };
};

export const createReview = async (
  customerId: string,
  payload: z.infer<typeof createReviewSchema>
) => {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.id, payload.providerId)).limit(1);
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, payload.bookingId)).limit(1);
  const [existingReview] = await db.select().from(reviews).where(eq(reviews.bookingId, payload.bookingId)).limit(1);
  const [customerProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, customerId)).limit(1);
  const [serviceRow] = booking?.providerServiceId
    ? await db.select().from(providerServices).where(eq(providerServices.id, booking.providerServiceId)).limit(1)
    : [null];

  if (!provider) {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }
  if (!booking) {
    throw new ApiError(404, "Booking not found", "BOOKING_NOT_FOUND");
  }
  if (existingReview) {
    throw new ApiError(409, "Review already exists for this booking", "REVIEW_ALREADY_EXISTS");
  }
  if (booking.customerUserId !== customerId) {
    throw new ApiError(403, "Cannot review another customer's booking", "FORBIDDEN");
  }
  if (booking.providerId !== payload.providerId) {
    throw new ApiError(400, "Booking/provider mismatch", "INVALID_REVIEW_TARGET");
  }
  if (booking.status !== "completed") {
    throw new ApiError(400, "Only completed bookings can be reviewed", "BOOKING_NOT_COMPLETED");
  }

  const now = new Date();
  const [reviewRow] = await db
    .insert(reviews)
    .values({
      providerId: payload.providerId,
      customerUserId: customerId,
      bookingId: payload.bookingId,
      serviceName: payload.serviceName ?? serviceRow?.name ?? "Service",
      rating: payload.rating,
      comment: payload.comment.trim(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await recomputeProviderRating(payload.providerId);

  await createNotification({
    userId: provider.ownerUserId,
    title: "New Review Received",
    body: `${customerProfile?.fullName ?? "Customer"} left a ${reviewRow.rating}-star review.`,
    type: "review",
    actionType: "provider_reviews",
    actionId: reviewRow.id,
  });

  return {
    id: reviewRow.id,
    providerId: reviewRow.providerId,
    customerId: reviewRow.customerUserId,
    bookingId: reviewRow.bookingId ?? "",
    userName: customerProfile?.fullName ?? "Customer",
    userAvatar: customerProfile?.avatarUrl ?? undefined,
    serviceName: reviewRow.serviceName,
    rating: reviewRow.rating,
    comment: reviewRow.comment ?? "",
    createdAt: reviewRow.createdAt.toISOString(),
    updatedAt: reviewRow.updatedAt.toISOString(),
  } satisfies Review;
};

export const listReviewsForProvider = async (providerId: string) => {
  const db = getDb();
  const rows = await db
    .select({
      id: reviews.id,
      providerId: reviews.providerId,
      customerId: reviews.customerUserId,
      bookingId: reviews.bookingId,
      serviceName: reviews.serviceName,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      userName: userProfiles.fullName,
      userAvatar: userProfiles.avatarUrl,
    })
    .from(reviews)
    .leftJoin(userProfiles, eq(reviews.customerUserId, userProfiles.userId))
    .where(eq(reviews.providerId, providerId))
    .orderBy(desc(reviews.createdAt));

  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    customerId: row.customerId,
    bookingId: row.bookingId ?? "",
    userName: row.userName ?? "Customer",
    userAvatar: row.userAvatar ?? undefined,
    serviceName: row.serviceName,
    rating: row.rating,
    comment: row.comment ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
};

export const listReviewsForProviderOwner = async (ownerUid: string) => {
  const db = getDb();
  const [provider] = await db.select({ id: providers.id }).from(providers).where(eq(providers.ownerUserId, ownerUid)).limit(1);
  if (!provider) {
    return [];
  }
  return listReviewsForProvider(provider.id);
};
