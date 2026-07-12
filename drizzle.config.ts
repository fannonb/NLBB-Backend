import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://nlbb:nlbb_dev@127.0.0.1:55432/nlbb",
  },
  verbose: true,
  strict: true,
});
