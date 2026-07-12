import { getDb, closeDb } from "../db/client";
import { providers, providerServices } from "../db/schema";
import { eq, and } from "drizzle-orm";

async function run() {
  console.log("Recalculating priceFrom for all providers...");
  const db = getDb();
  const allProviders = await db.select().from(providers);
  console.log(`Found ${allProviders.length} providers.`);

  for (const provider of allProviders) {
    const activeServices = await db
      .select({ priceAmount: providerServices.priceAmount })
      .from(providerServices)
      .where(
        and(
          eq(providerServices.providerId, provider.id),
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

    console.log(`Provider "${provider.name}" (ID: ${provider.id}): Calculated min price: Ksh ${minPrice} (was ${provider.priceFrom})`);
    await db
      .update(providers)
      .set({
        priceFrom: minPrice.toString(),
        updatedAt: new Date(),
      })
      .where(eq(providers.id, provider.id));
  }

  console.log("Done recalculating priceFrom!");
  await closeDb();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
