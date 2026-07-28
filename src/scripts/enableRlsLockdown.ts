/**
 * Enable RLS on all public tables and revoke Data API access from anon/authenticated.
 *
 * NLBB accesses Postgres only through the Express backend (postgres role / DATABASE_URL),
 * which bypasses RLS. The mobile app must not query tables via the Supabase anon key.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATION_SQL = `
-- Security fix: close public Data API exposure (Supabase advisor: rls_disabled_in_public)
-- Backend continues to use the postgres role, which bypasses RLS.

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
  end loop;
end $$;

-- Deny direct PostgREST access even if a future policy is added by mistake.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
`;

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Applying RLS lockdown migration...");
  await client.query("begin");
  try {
    await client.query(MIGRATION_SQL);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  const tables = await client.query(`
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  `);

  const stillOpen = tables.rows.filter((row) => !row.rls_enabled);
  console.log(`Tables with RLS enabled: ${tables.rows.length - stillOpen.length}/${tables.rows.length}`);
  if (stillOpen.length) {
    console.error("Still missing RLS:", stillOpen.map((r) => r.table_name).join(", "));
    process.exitCode = 1;
  }

  const grants = await client.query(`
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon','authenticated')
    group by table_name, grantee
    order by table_name, grantee
  `);
  console.log(`Remaining anon/authenticated grants: ${grants.rows.length}`);
  for (const row of grants.rows) {
    console.log(JSON.stringify(row));
  }

  // Smoke: backend role can still read.
  const smoke = await client.query("select count(*)::int as providers from public.providers");
  console.log("Backend read smoke providers=", smoke.rows[0].providers);

  await client.end();

  const outDir = path.join(process.cwd(), "drizzle");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "0001_enable_rls_lockdown.sql");
  fs.writeFileSync(outPath, `${MIGRATION_SQL.trim()}\n`, "utf8");
  console.log("Wrote migration file:", outPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
