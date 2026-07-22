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

export const initializeDatabase = async () => {
  if (dbInstance) return;

  postgresClient = postgres(ensureDatabaseUrl(), {
    max: env.DATABASE_POOL_MAX,
    prepare: false,
  });

  dbInstance = drizzle(postgresClient, { schema });
};

export const getSqlClient = () => {
  if (!postgresClient) {
    postgresClient = postgres(ensureDatabaseUrl(), {
      max: env.DATABASE_POOL_MAX,
      prepare: false,
    });
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
