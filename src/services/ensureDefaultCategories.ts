import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { categories } from "../db/schema";

/** Canonical marketplace categories; missing rows are inserted on server boot (idempotent). */
const DEFAULT_MARKETPLACE_CATEGORIES = [
  { name: "Barber", slug: "barber", sortOrder: 0 },
  { name: "Hair", slug: "hair", sortOrder: 1 },
  { name: "Nails", slug: "nails", sortOrder: 2 },
  { name: "Massage", slug: "massage", sortOrder: 3 },
  { name: "Facial", slug: "facial", sortOrder: 4 },
  { name: "Tattoo", slug: "tattoo", sortOrder: 5 },
  { name: "Salon", slug: "salon", sortOrder: 6 },
  { name: "Spa", slug: "spa", sortOrder: 7 },
  { name: "Makeup", slug: "makeup", sortOrder: 8 },
  { name: "Waxing", slug: "waxing", sortOrder: 9 },
  { name: "Lashes", slug: "lashes", sortOrder: 10 },
  { name: "Piercing", slug: "piercing", sortOrder: 11 },
] as const;

export async function ensureDefaultCategories(): Promise<void> {
  const db = getDb();
  const now = new Date();

  for (const row of DEFAULT_MARKETPLACE_CATEGORIES) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, row.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(categories).values({
        name: row.name,
        slug: row.slug,
        sortOrder: row.sortOrder,
        isActive: true,
        createdAt: now,
      });
    }
  }
}
