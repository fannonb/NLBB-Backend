import { app } from "./app";
import { env } from "./config/env";
import { initializeDatabase } from "./db/client";
import { ensureDefaultCategories } from "./services/ensureDefaultCategories";
import { getEmailDiagnostics, verifyEmailTransport } from "./services/emailService";

async function start() {
  try {
    await initializeDatabase();
    await ensureDefaultCategories();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("ensureDefaultCategories failed (check DATABASE_URL and migrations):", error);
    process.exit(1);
  }

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`NLBB backend running on http://localhost:${env.PORT}`);

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
