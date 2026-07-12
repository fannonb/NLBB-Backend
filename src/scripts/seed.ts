import { getDb } from "../db/client";
import {
  adminLogs,
  bookings,
  categories,
  favorites,
  notifications,
  payments,
  providerMedia,
  providerServices,
  providerSubscriptions,
  providerWorkingHours,
  providers,
  reviews,
  subscriptionPlans,
  userProfiles,
  users,
} from "../db/schema";
// NOTE: user rows here must correspond to real Supabase Auth accounts with the same UUIDs.
// Create matching accounts via Supabase dashboard > Authentication > Users before running the seed.

const hasYesFlag = process.argv.includes("--yes");

if (!hasYesFlag) {
  // eslint-disable-next-line no-console
  console.error(
    "Seed aborted. This operation is destructive. Re-run with: npm run seed -- --yes"
  );
  process.exit(1);
}

const now = new Date();

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};

const daysAhead = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

async function seed() {
  const db = getDb();

  await db.delete(adminLogs);
  await db.delete(notifications);
  await db.delete(reviews);
  await db.delete(favorites);
  await db.delete(bookings);
  await db.delete(payments);
  await db.delete(providerMedia);
  await db.delete(providerWorkingHours);
  await db.delete(providerServices);
  await db.delete(providerSubscriptions);
  await db.delete(providers);
  await db.delete(userProfiles);
  await db.delete(users);
  await db.delete(categories);
  await db.delete(subscriptionPlans);

  const [monthlyPlan] = await db
    .insert(subscriptionPlans)
    .values({
      code: "monthly",
      name: "Monthly",
      billingPeriod: "monthly",
      priceAmount: "300",
      currency: "KES",
      isActive: true,
      createdAt: now,
    })
    .returning();

  const [hairCategory] = await db
    .insert(categories)
    .values({
      name: "Hair",
      slug: "hair",
      sortOrder: 0,
      isActive: true,
      createdAt: now,
    })
    .returning();

  await db.insert(categories).values([
    { name: "Barber", slug: "barber", sortOrder: 1, isActive: true, createdAt: now },
    { name: "Nails", slug: "nails", sortOrder: 2, isActive: true, createdAt: now },
    { name: "Massage", slug: "massage", sortOrder: 3, isActive: true, createdAt: now },
    { name: "Facial", slug: "facial", sortOrder: 4, isActive: true, createdAt: now },
    { name: "Tattoo", slug: "tattoo", sortOrder: 5, isActive: true, createdAt: now },
    { name: "Salon", slug: "salon", sortOrder: 6, isActive: true, createdAt: now },
    { name: "Spa", slug: "spa", sortOrder: 7, isActive: true, createdAt: now },
    { name: "Makeup", slug: "makeup", sortOrder: 8, isActive: true, createdAt: now },
    { name: "Waxing", slug: "waxing", sortOrder: 9, isActive: true, createdAt: now },
    { name: "Lashes", slug: "lashes", sortOrder: 10, isActive: true, createdAt: now },
    { name: "Piercing", slug: "piercing", sortOrder: 11, isActive: true, createdAt: now },
  ]);

  await db.insert(users).values([
    {
      id: "11111111-1111-1111-1111-111111111111",
      email: "customer@test.com",
      phone: "+254712345678",
      role: "customer",
      status: "active",
      emailVerified: true,
      createdAt: daysAgo(30),
      updatedAt: now,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      email: "provider@test.com",
      phone: "+254712345678",
      role: "provider",
      status: "active",
      emailVerified: true,
      createdAt: daysAgo(60),
      updatedAt: now,
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      email: "admin@nlbb.ke",
      phone: "+254700000000",
      role: "admin",
      status: "active",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(userProfiles).values([
    {
      userId: "11111111-1111-1111-1111-111111111111",
      fullName: "Amani Wanjiku",
      avatarUrl: "https://images.unsplash.com/photo-1531123897727-8f129e1bf98c?q=80&w=200&auto=format&fit=crop",
      location: "Kilimani, Nairobi",
      createdAt: daysAgo(30),
      updatedAt: now,
    },
    {
      userId: "22222222-2222-2222-2222-222222222222",
      fullName: "Luxe Glow Owner",
      avatarUrl: null,
      location: "Westlands, Nairobi",
      createdAt: daysAgo(60),
      updatedAt: now,
    },
    {
      userId: "33333333-3333-3333-3333-333333333333",
      fullName: "NLBB Admin",
      avatarUrl: null,
      location: "Nairobi",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const [provider] = await db
    .insert(providers)
    .values({
      ownerUserId: "22222222-2222-2222-2222-222222222222",
      categoryId: hairCategory.id,
      name: "Luxe Glow Studio",
      description: "A premium hair and aesthetics studio offering world-class services in the heart of Westlands.",
      location: "Westlands, Nairobi",
      address: "The Address Building, 4th Fl, Muthangari Drive, Westlands",
      phone: "+254712345678",
      whatsapp: "+254712345678",
      instagram: "@luxeglowstudio",
      facebook: "Luxe Glow Studio",
      mpesaPhone: "+254712345678",
      priceFrom: "2500",
      ratingAvg: "4.9",
      reviewCount: 2,
      isVerified: true,
      isOpen: true,
      adminStatus: "approved",
      createdAt: daysAgo(60),
      updatedAt: now,
    })
    .returning();

  const seededServices = await db.insert(providerServices).values([
    {
      providerId: provider.id,
      categoryId: hairCategory.id,
      name: "Silk Press & Trim",
      description: "Includes wash",
      durationMinutes: 90,
      priceAmount: "3500",
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      providerId: provider.id,
      categoryId: hairCategory.id,
      name: "Balayage & Toner",
      description: "Full head",
      durationMinutes: 165,
      priceAmount: "8500",
      isActive: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]).returning();

  const [seededPrimaryService] = seededServices;

  await db.insert(providerWorkingHours).values([
    { providerId: provider.id, weekday: 2, isOpen: true, openTime: "09:00", closeTime: "20:00", createdAt: now, updatedAt: now },
    { providerId: provider.id, weekday: 3, isOpen: true, openTime: "09:00", closeTime: "20:00", createdAt: now, updatedAt: now },
  ]);

  await db.insert(providerMedia).values({
    providerId: provider.id,
    kind: "cover",
    storageKey: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=1200",
    publicUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=1200",
    mimeType: null,
    fileSize: null,
    sortOrder: 0,
    createdAt: now,
  });

  await db.insert(providerSubscriptions).values({
    providerId: provider.id,
    planId: monthlyPlan.id,
    status: "active",
    startsAt: daysAgo(30),
    renewalAt: daysAhead(30),
    expiresAt: daysAhead(30),
    lastPaymentId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(bookings).values({
    referenceCode: "#NLBB-3001-2026",
    customerUserId: "11111111-1111-1111-1111-111111111111",
    providerId: provider.id,
    providerServiceId: seededPrimaryService?.id ?? null,
    scheduledStartAt: daysAhead(1),
    scheduledEndAt: daysAhead(1),
    status: "pending",
    notes: null,
    serviceName: "Silk Press & Trim",
    servicePriceAmount: "3500",
    totalAmount: "3500",
    createdAt: daysAgo(1),
    updatedAt: now,
  });

  await db.insert(payments).values({
    providerId: provider.id,
    amount: "300",
    currency: "KES",
    method: "mpesa",
    status: "success",
    phoneNumber: "+254712345678",
    checkoutRequestId: "SIM-CHK-1",
    merchantRequestId: "SIM-MER-1",
    mpesaReceiptNumber: "RCP123456",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(favorites).values({
    userId: "11111111-1111-1111-1111-111111111111",
    providerId: provider.id,
    createdAt: daysAgo(2),
  });

  await db.insert(reviews).values({
    providerId: provider.id,
    customerUserId: "11111111-1111-1111-1111-111111111111",
    bookingId: null,
    serviceName: "Silk Press & Trim",
    rating: 5,
    comment: "Excellent service and great attention to detail.",
    createdAt: daysAgo(8),
    updatedAt: now,
  });

  await db.insert(notifications).values({
    userId: "11111111-1111-1111-1111-111111111111",
    type: "general",
    title: "Welcome to NLBB",
    body: "Your marketplace is ready to use.",
    isRead: false,
    createdAt: now,
    readAt: null,
  });

  // eslint-disable-next-line no-console
  console.log("Seed complete: postgres data loaded.");
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
