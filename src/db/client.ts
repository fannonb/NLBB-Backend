import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { env } from "../config/env";
import * as schema from "./schema";

let postgresClient: postgres.Sql | null = null;
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;
type Database = PostgresJsDatabase<typeof schema>;
const transactionContext = new AsyncLocalStorage<{ db: Database; afterCommit: Array<() => void | Promise<unknown>> }>();

// Nested services use the same transaction and connection through getDb().
export const withDbTransaction = async <T>(work: () => Promise<T>): Promise<T> => {
  if (transactionContext.getStore()) return work();
  const afterCommit: Array<() => void | Promise<unknown>> = [];
  const result = await getDb().transaction((tx) =>
    transactionContext.run({ db: tx as unknown as Database, afterCommit }, work)
  );
  for (const effect of afterCommit) {
    void Promise.resolve().then(effect).catch((error) => console.error("[after-commit] delivery failed", error));
  }
  return result;
};

export const afterDbCommit = (effect: () => void | Promise<unknown>) => {
  const context = transactionContext.getStore();
  if (context) context.afterCommit.push(effect);
  else void Promise.resolve().then(effect).catch((error) => console.error("[after-commit] delivery failed", error));
};

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
  const context = transactionContext.getStore();
  if (context) return context.db;
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
