import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { bookings, providers, providerSubscriptions, payments, users } from "../db/schema";
import { getProviderIdByOwnerUid } from "./subscriptionPgService";

export const getProviderAnalytics = async (ownerUid: string) => {
  const db = getDb();
  const providerId = await getProviderIdByOwnerUid(ownerUid);
  if (!providerId) {
    return null;
  }

  const [provider, bookingRows] = await Promise.all([
    db.select().from(providers).where(eq(providers.id, providerId)).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(bookings).where(eq(bookings.providerId, providerId)),
  ]);

  const completed = bookingRows.filter((booking) => booking.status === "completed");
  const pending = bookingRows.filter((booking) => booking.status === "pending");
  const revenue = completed.reduce((sum, booking) => sum + Number(booking.totalAmount), 0);

  return {
    providerId,
    totalBookings: bookingRows.length,
    completedBookings: completed.length,
    pendingBookings: pending.length,
    totalRevenue: revenue,
    averageRating: Number(provider?.ratingAvg ?? 0),
    reviewCount: provider?.reviewCount ?? 0,
  };
};

export const getAdminOverview = async () => {
  const db = getDb();
  const [usersRows, providerRows, bookingRows, subscriptionRows, paymentRows] = await Promise.all([
    db.select().from(users),
    db.select().from(providers),
    db.select().from(bookings),
    db.select().from(providerSubscriptions),
    db.select().from(payments),
  ]);

  const activeSubscriptions = subscriptionRows.filter(
    (sub) => sub.status === "active" && (sub.expiresAt ?? sub.renewalAt ?? new Date()).getTime() > Date.now()
  ).length;
  const totalRevenue = paymentRows
    .filter((payment) => payment.status === "success")
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  return {
    users: usersRows.length,
    providers: providerRows.length,
    totalBookings: bookingRows.length,
    activeSubscriptions,
    totalRevenue,
  };
};
