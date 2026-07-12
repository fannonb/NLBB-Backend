import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 32 }),
    role: varchar("role", { length: 32 }).notNull().default("customer"),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    emailVerified: boolean("email_verified").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  location: varchar("location", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  themeMode: varchar("theme_mode", { length: 16 }).notNull().default("light"),
  bookingConfirmation: boolean("booking_confirmation").notNull().default(true),
  bookingReminder: boolean("booking_reminder").notNull().default(true),
  bookingUpdate: boolean("booking_update").notNull().default(true),
  providerMessage: boolean("provider_message").notNull().default(true),
  providerPromo: boolean("provider_promo").notNull().default(false),
  providerReview: boolean("provider_review").notNull().default(true),
  appUpdate: boolean("app_update").notNull().default(false),
  accountAlert: boolean("account_alert").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushTokens = pgTable("push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: varchar("platform", { length: 32 }).notNull(),
  pushToken: text("push_token").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable("providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  serviceCategories: text("service_categories"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 255 }),
  address: text("address"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  phone: varchar("phone", { length: 32 }),
  whatsapp: varchar("whatsapp", { length: 32 }),
  instagram: varchar("instagram", { length: 128 }),
  facebook: varchar("facebook", { length: 128 }),
  mpesaPhone: varchar("mpesa_phone", { length: 32 }),
  priceFrom: numeric("price_from", { precision: 12, scale: 2 }).notNull().default("0"),
  ratingAvg: numeric("rating_avg", { precision: 4, scale: 2 }).notNull().default("0"),
  reviewCount: integer("review_count").notNull().default(0),
  isVerified: boolean("is_verified").notNull().default(false),
  isOpen: boolean("is_open").notNull().default(false),
  adminStatus: varchar("admin_status", { length: 32 }).notNull().default("pending"),
  ...timestamps,
});

export const providerServices = pgTable("provider_services", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  priceAmount: numeric("price_amount", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const providerWorkingHours = pgTable("provider_working_hours", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  isOpen: boolean("is_open").notNull().default(true),
  openTime: varchar("open_time", { length: 16 }),
  closeTime: varchar("close_time", { length: 16 }),
  ...timestamps,
});

export const providerMedia = pgTable("provider_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32 }).notNull(),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url"),
  mimeType: varchar("mime_type", { length: 128 }),
  fileSize: integer("file_size"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerVerificationEvents = pgTable("provider_verification_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    favoriteUniqueIdx: uniqueIndex("favorites_user_provider_idx").on(table.userId, table.providerId),
  }),
);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  referenceCode: varchar("reference_code", { length: 64 }).notNull(),
  customerUserId: uuid("customer_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  providerServiceId: uuid("provider_service_id").references(() => providerServices.id, {
    onDelete: "set null",
  }),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),
  scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  notes: text("notes"),
  serviceName: varchar("service_name", { length: 255 }),
  servicePriceAmount: numeric("service_price_amount", { precision: 12, scale: 2 }).notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  ...timestamps,
});

export const bookingStatusHistory = pgTable("booking_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 32 }),
  toStatus: varchar("to_status", { length: 32 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  customerUserId: uuid("customer_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  serviceName: varchar("service_name", { length: 255 }).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  ...timestamps,
});

export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  billingPeriod: varchar("billing_period", { length: 32 }).notNull(),
  priceAmount: numeric("price_amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("KES"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerSubscriptions = pgTable("provider_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  renewalAt: timestamp("renewal_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastPaymentId: uuid("last_payment_id"),
  creditBalance: numeric("credit_balance", { precision: 12, scale: 2 }).notNull().default("0"),
  ...timestamps,
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => providerSubscriptions.id, {
    onDelete: "set null",
  }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("KES"),
  method: varchar("method", { length: 32 }).notNull().default("mpesa"),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  phoneNumber: varchar("phone_number", { length: 32 }),
  checkoutRequestId: varchar("checkout_request_id", { length: 255 }),
  merchantRequestId: varchar("merchant_request_id", { length: 255 }),
  mpesaReceiptNumber: varchar("mpesa_receipt_number", { length: 255 }),
  ...timestamps,
});

export const paymentCallbacks = pgTable("payment_callbacks", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "cascade" }),
  externalReference: varchar("external_reference", { length: 255 }),
  payloadJson: text("payload_json").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentEvents = pgTable("payment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "cascade" }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payloadJson: text("payload_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  actionType: varchar("action_type", { length: 64 }),
  actionId: varchar("action_id", { length: 255 }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

export const adminLogs = pgTable("admin_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  targetType: varchar("target_type", { length: 64 }).notNull(),
  targetId: varchar("target_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 64 }),
  targetId: varchar("target_id", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
