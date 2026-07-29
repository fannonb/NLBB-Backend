import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { env } from "../config/env";
import * as schema from "./schema";

let postgresClient: postgres.Sql | null = null;
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

const ensureDatabaseUrl = () => {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in backend/.env before starting the server.",
    );
  }
  return env.DATABASE_URL;
};

const createPostgresClient = () =>
  postgres(ensureDatabaseUrl(), {
    max: env.DATABASE_POOL_MAX,
    // Required for Supabase pooler (PgBouncer transaction/session modes).
    prepare: false,
    // Fail fast instead of hanging ~30s on a cold or dropped pooler connection.
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });

export const initializeDatabase = async () => {
  if (dbInstance) return;

  postgresClient = createPostgresClient();
  dbInstance = drizzle(postgresClient, { schema });

  // Warm the pool so the first admin action does not pay connection setup cost.
  await postgresClient`select 1`;
};

export const getSqlClient = () => {
  if (!postgresClient) {
    postgresClient = createPostgresClient();
  }
  return postgresClient;
};

export const getDb = () => {
  if (!dbInstance) {
    dbInstance = drizzle(getSqlClient(), { schema });
  }
  return dbInstance;
};

export const closeDb = async () => {
  if (postgresClient) {
    const current = postgresClient;
    postgresClient = null;
    dbInstance = null;
    await current.end();
  }
};
