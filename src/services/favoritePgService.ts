import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { favorites } from "../db/schema";
import { ApiError } from "../utils/apiError";
import { getProviderById } from "./providerService";

export const upsertFavoriteSchema = z.object({
  providerId: z.string().min(1),
});

export const listFavoriteProviders = async (userId: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt));

  const providers = await Promise.all(
    rows.map((favorite) =>
      getProviderById(favorite.providerId, {
        uid: userId,
        role: "customer",
      })
    )
  );

  return providers.filter((provider): provider is NonNullable<typeof provider> => !!provider);
};

export const addFavoriteProvider = async (userId: string, providerId: string) => {
  const provider = await getProviderById(providerId, { uid: userId, role: "customer" });
  if (!provider) {
    throw new ApiError(404, "Provider not found", "PROVIDER_NOT_FOUND");
  }

  const db = getDb();
  await db
    .insert(favorites)
    .values({
      userId,
      providerId,
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  return {
    id: `${userId}__${providerId}`,
    userId,
    providerId,
    createdAt: new Date().toISOString(),
  };
};

export const removeFavoriteProvider = async (userId: string, providerId: string) => {
  const db = getDb();
  const result = await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.providerId, providerId)))
    .returning({ id: favorites.id });

  return { deleted: result.length > 0 };
};
