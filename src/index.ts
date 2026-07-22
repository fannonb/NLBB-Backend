import { networkInterfaces } from "node:os";
import { app } from "./app";
import { env } from "./config/env";
import { initializeDatabase } from "./db/client";
import { ensureDefaultCategories } from "./services/ensureDefaultCategories";
import { getEmailDiagnostics, verifyEmailTransport } from "./services/emailService";
import { startSubscriptionReminderScheduler } from "./services/subscriptionReminderService";

const listLanAddresses = () => {
  const addresses = new Set<string>();
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses];
};

async function start() {
  try {
    await initializeDatabase();
    await ensureDefaultCategories();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("ensureDefaultCategories failed (check DATABASE_URL and migrations):", error);
    process.exit(1);
  }

  app.listen(env.PORT, env.HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`NLBB backend running on http://localhost:${env.PORT} (host ${env.HOST})`);
    for (const address of listLanAddresses()) {
      // eslint-disable-next-line no-console
      console.log(`  reachable at http://${address}:${env.PORT}/api`);
    }
    if (!env.SUPABASE_JWT_SECRET && env.APP_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] SUPABASE_JWT_SECRET is not set — every request verifies tokens via Supabase over the network. " +
          "Add it from Supabase Dashboard > Project Settings > API > JWT Secret for much faster auth."
      );
    }
    startSubscriptionReminderScheduler();

    const email = getEmailDiagnostics();
    if (!email.configured) {
      // eslint-disable-next-line no-console
      console.warn("[email] email transport is not fully configured", {
        provider: email.provider,
        missing: email.missing,
      });
      return;
    }

    void verifyEmailTransport()
      .then((result) => {
        if (result.ok) {
          // eslint-disable-next-line no-console
          console.log(`[email] verification succeeded using ${result.candidate}`);
          return;
        }

        // eslint-disable-next-line no-console
        console.error("[email] verification failed:", result.reason);
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error("[email] verification crashed:", error);
      });
  });
}

void start();
