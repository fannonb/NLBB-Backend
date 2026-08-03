import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

await client.connect();
await client.query(`ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL`);
console.log("is_featured migration applied");
await client.end();
