import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { providers, pushTokens, userPreferences, userProfiles, users } from "../db/schema";
import type { UserRole } from "../types/domain";
import { ApiError } from "../utils/apiError";
import type { User } from "@supabase/supabase-js";

export const upsertPushTokenSchema = z.object({
  platform: z.enum(["ios", "android"]),
  token: z.string().min(10),
});

export const upsertUserProfileSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().min(9),
  role: z.enum(["customer", "provider"] as [UserRole, UserRole]),
  location: z.string().optional(),
  avatar: z.string().url().optional(),
});

export const notificationSettingsSchema = z.object({
  bookingConfirmation: z.boolean(),
  bookingReminder: z.boolean(),
  bookingUpdate: z.boolean(),
  providerMessage: z.boolean(),
  providerPromo: z.boolean(),
  providerReview: z.boolean(),
  appUpdate: z.boolean(),
  accountAlert: z.boolean(),
});

export const upsertUserPreferencesSchema = z.object({
  themeMode: z.enum(["light", "dark"]).optional(),
  notificationSettings: notificationSettingsSchema.partial().optional(),
});

export interface UserPreferences {
  themeMode: "light" | "dark";
  notificationSettings: z.infer<typeof notificationSettingsSchema>;
}

const DEFAULT_USER_PREFERENCES: UserPreferences = {
  themeMode: "light",
  notificationSettings: {
    bookingConfirmation: true,
    bookingReminder: true,
    bookingUpdate: true,
    providerMessage: true,
    providerPromo: false,
    providerReview: true,
    appUpdate: false,
    accountAlert: true,
  },
};

const getUserWithProfile = async (uid: string) => {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  if (!user) {
    return null;
  }
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
  return { user, profile: profile ?? null };
};

const userOwnsProviderProfile = async (uid: string) => {
  const db = getDb();
  const [provider] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.ownerUserId, uid))
    .limit(1);
  return !!provider;
};

const fallbackDisplayName = (email: string | undefined, fullName?: string | null) => {
  const normalizedFullName = fullName?.trim();
  if (normalizedFullName) {
    return normalizedFullName;
  }

  const localPart = email?.split("@")[0]?.trim();
  if (localPart) {
    return localPart;
  }

  return "User";
};

export const ensureUserFromSupabaseAuth = async (
  authUser: User,
  overrides?: {
    role?: UserRole;
    fullName?: string | null;
    phone?: string | null;
    location?: string | null;
  }
) => {
  const db = getDb();
  const now = new Date();
  const metadata = authUser.user_metadata ?? {};
  const role = (overrides?.role ??
    metadata.role ??
    "customer") as UserRole;
  const email = authUser.email ?? `${authUser.id}@supabase.local`;
  const phone =
    overrides?.phone ??
    (typeof metadata.phone === "string" ? metadata.phone : null);
  const fullName = fallbackDisplayName(
    email,
    overrides?.fullName ??
      (typeof metadata.full_name === "string" ? metadata.full_name : null)
  );
  const location =
    overrides?.location ??
    (typeof metadata.location === "string" ? metadata.location : null);

  const [existingUser] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
  if (!existingUser) {
    await db.insert(users).values({
      id: authUser.id,
      email,
      phone,
      role,
      status: "active",
      emailVerified: authUser.email_confirmed_at != null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(users)
      .set({
        email,
        phone: phone ?? existingUser.phone,
        role: role ?? existingUser.role,
        emailVerified: authUser.email_confirmed_at != null,
        updatedAt: now,
      })
      .where(eq(users.id, authUser.id));
  }

  const [existingProfile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, authUser.id))
    .limit(1);

  if (!existingProfile) {
    await db.insert(userProfiles).values({
      userId: authUser.id,
      fullName,
      avatarUrl: null,
      location,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(userProfiles)
      .set({
        fullName: existingProfile.fullName || fullName,
        location: existingProfile.location ?? location,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, authUser.id));
  }

  if (role === "provider") {
    const [existingProvider] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.ownerUserId, authUser.id))
      .limit(1);

    if (!existingProvider) {
      await db.insert(providers).values({
        ownerUserId: authUser.id,
        name: fullName,
        description: null,
        location,
        address: null,
        phone,
        whatsapp: phone,
        instagram: null,
        facebook: null,
        mpesaPhone: null,
        priceFrom: "0",
        ratingAvg: "0",
        reviewCount: 0,
        isVerified: false,
        isOpen: false,
        adminStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return getUserProfile(authUser.id);
};

export const upsertUserProfile = async (
  uid: string,
  email: string | undefined,
  payload: z.infer<typeof upsertUserProfileSchema>
) => {
  const db = getDb();
  const now = new Date();
  const requestedEmail = payload.email?.trim().toLowerCase();

  if (requestedEmail) {
    const [emailOwner] = await db.select({ id: users.id }).from(users).where(eq(users.email, requestedEmail)).limit(1);
    if (emailOwner && emailOwner.id !== uid) {
      throw new ApiError(409, "Email is already in use", "EMAIL_IN_USE");
    }
  }

  const [existingUser] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const roleForWrite = existingUser?.role ?? payload.role;
  if (!existingUser) {
    await db.insert(users).values({
      id: uid,
      email: requestedEmail ?? email ?? `${uid}@nlbb.local`,
      phone: payload.phone,
      role: roleForWrite,
      status: "active",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(users)
      .set({
        email: requestedEmail ?? email ?? existingUser.email,
        phone: payload.phone,
        updatedAt: now,
      })
      .where(eq(users.id, uid));
  }

  const [existingProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);
  if (!existingProfile) {
    await db.insert(userProfiles).values({
      userId: uid,
      fullName: payload.name,
      location: payload.location ?? null,
      avatarUrl: payload.avatar ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(userProfiles)
      .set({
        fullName: payload.name,
        location: payload.location ?? null,
        avatarUrl: payload.avatar ?? existingProfile.avatarUrl ?? null,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, uid));
  }

  if (payload.role === "provider") {
    const [existingProvider] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.ownerUserId, uid))
      .limit(1);

    if (!existingProvider) {
      await db.insert(providers).values({
        ownerUserId: uid,
        name: payload.name,
        description: null,
        location: payload.location ?? null,
        address: null,
        phone: payload.phone,
        whatsapp: payload.phone,
        instagram: null,
        facebook: null,
        mpesaPhone: null,
        priceFrom: "0",
        ratingAvg: "0",
        reviewCount: 0,
        isVerified: false,
        isOpen: false,
        adminStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return getUserProfile(uid);
};

export const getUserProfile = async (uid: string) => {
  const data = await getUserWithProfile(uid);
  if (!data) {
    return null;
  }

  let { user, profile } = data;
  if (user.role === "customer" && (await userOwnsProviderProfile(uid))) {
    const db = getDb();
    const now = new Date();
    await db
      .update(users)
      .set({
        role: "provider",
        updatedAt: now,
      })
      .where(eq(users.id, uid));

    user = {
      ...user,
      role: "provider",
      updatedAt: now,
    };
  }

  return {
    id: user.id,
    email: user.email,
    phone: user.phone ?? "",
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    name: fallbackDisplayName(user.email, profile?.fullName ?? null),
    avatar: profile?.avatarUrl ?? null,
    location: profile?.location ?? null,
    createdAt: profile?.createdAt?.toISOString?.() ?? user.createdAt.toISOString(),
    updatedAt: profile?.updatedAt?.toISOString?.() ?? user.updatedAt.toISOString(),
  };
};

export const upsertPushToken = async (
  uid: string,
  payload: z.infer<typeof upsertPushTokenSchema>
) => {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(eq(pushTokens.pushToken, payload.token))
    .limit(1);

  if (existing) {
    await db
      .update(pushTokens)
      .set({ userId: uid, platform: payload.platform, lastSeenAt: now })
      .where(eq(pushTokens.id, existing.id));
    console.log("[push] push token refreshed", { userId: uid, platform: payload.platform });
    return;
  }

  await db.insert(pushTokens).values({
    userId: uid,
    platform: payload.platform,
    pushToken: payload.token,
    lastSeenAt: now,
    createdAt: now,
  });
  console.log("[push] push token registered", { userId: uid, platform: payload.platform });
};

export const getPushTokensForUser = async (uid: string): Promise<string[]> => {
  const db = getDb();
  const rows = await db
    .select({ token: pushTokens.pushToken })
    .from(pushTokens)
    .where(eq(pushTokens.userId, uid));
  return rows.map((row) => row.token);
};

export const getUserRole = async (uid: string) => {
  const db = getDb();
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, uid)).limit(1);
  return (user?.role ?? "customer") as UserRole;
};

export const setUserAvatar = async (uid: string, avatarUrl: string) => {
  const db = getDb();
  const now = new Date();
  const [existingProfile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uid)).limit(1);

  if (!existingProfile) {
    const [existingUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);

    if (!existingUser) {
      throw new ApiError(404, "Account not found", "ACCOUNT_NOT_FOUND");
    }

    const fallbackName = existingUser.email.split("@")[0] || "User";
    await db.insert(userProfiles).values({
      userId: uid,
      fullName: fallbackName,
      avatarUrl,
      location: null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(userProfiles)
      .set({
        avatarUrl,
        updatedAt: now,
      })
      .where(eq(userProfiles.userId, uid));
  }

  const profile = await getUserProfile(uid);
  if (!profile) {
    throw new ApiError(404, "Account not found", "ACCOUNT_NOT_FOUND");
  }

  return profile;
};

const toUserPreferences = (
  row:
    | {
        themeMode: string;
        bookingConfirmation: boolean;
        bookingReminder: boolean;
        bookingUpdate: boolean;
        providerMessage: boolean;
        providerPromo: boolean;
        providerReview: boolean;
        appUpdate: boolean;
        accountAlert: boolean;
      }
    | null
): UserPreferences => {
  if (!row) {
    return DEFAULT_USER_PREFERENCES;
  }

  return {
    themeMode: row.themeMode === "dark" ? "dark" : "light",
    notificationSettings: {
      bookingConfirmation: row.bookingConfirmation,
      bookingReminder: row.bookingReminder,
      bookingUpdate: row.bookingUpdate,
      providerMessage: row.providerMessage,
      providerPromo: row.providerPromo,
      providerReview: row.providerReview,
      appUpdate: row.appUpdate,
      accountAlert: row.accountAlert,
    },
  };
};

export const getUserPreferences = async (uid: string): Promise<UserPreferences> => {
  const db = getDb();
  const [existing] = await db
    .select({
      themeMode: userPreferences.themeMode,
      bookingConfirmation: userPreferences.bookingConfirmation,
      bookingReminder: userPreferences.bookingReminder,
      bookingUpdate: userPreferences.bookingUpdate,
      providerMessage: userPreferences.providerMessage,
      providerPromo: userPreferences.providerPromo,
      providerReview: userPreferences.providerReview,
      appUpdate: userPreferences.appUpdate,
      accountAlert: userPreferences.accountAlert,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, uid))
    .limit(1);

  return toUserPreferences(existing ?? null);
};

export const upsertUserPreferences = async (
  uid: string,
  payload: z.infer<typeof upsertUserPreferencesSchema>
): Promise<UserPreferences> => {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, uid))
    .limit(1);

  const base = toUserPreferences(existing ?? null);
  const nextThemeMode = payload.themeMode ?? base.themeMode;
  const nextNotificationSettings = {
    ...base.notificationSettings,
    ...(payload.notificationSettings ?? {}),
  };

  if (!existing) {
    await db.insert(userPreferences).values({
      userId: uid,
      themeMode: nextThemeMode,
      bookingConfirmation: nextNotificationSettings.bookingConfirmation,
      bookingReminder: nextNotificationSettings.bookingReminder,
      bookingUpdate: nextNotificationSettings.bookingUpdate,
      providerMessage: nextNotificationSettings.providerMessage,
      providerPromo: nextNotificationSettings.providerPromo,
      providerReview: nextNotificationSettings.providerReview,
      appUpdate: nextNotificationSettings.appUpdate,
      accountAlert: nextNotificationSettings.accountAlert,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(userPreferences)
      .set({
        themeMode: nextThemeMode,
        bookingConfirmation: nextNotificationSettings.bookingConfirmation,
        bookingReminder: nextNotificationSettings.bookingReminder,
        bookingUpdate: nextNotificationSettings.bookingUpdate,
        providerMessage: nextNotificationSettings.providerMessage,
        providerPromo: nextNotificationSettings.providerPromo,
        providerReview: nextNotificationSettings.providerReview,
        appUpdate: nextNotificationSettings.appUpdate,
        accountAlert: nextNotificationSettings.accountAlert,
        updatedAt: now,
      })
      .where(eq(userPreferences.userId, uid));
  }

  return getUserPreferences(uid);
};
