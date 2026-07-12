import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb, initializeDatabase } from "./client";

const run = async () => {
  try {
    await initializeDatabase();
    await migrate(getDb(), {
      migrationsFolder: "./drizzle",
    });
    // eslint-disable-next-line no-console
    console.log("Database migrations applied successfully.");
  } finally {
    await closeDb();
  }
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to run database migrations.", error);
  process.exitCode = 1;
});
