import { app } from "./app";
import { env } from "./config/env";
import { initializeDatabase } from "./db/client";
import { ensureDefaultCategories } from "./services/ensureDefaultCategories";

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
  });
}

void start();
