import "dotenv/config";
import pg from "pg";

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const role = await client.query(
    "select current_user, session_user, current_setting('role') as role"
  );
  console.log("ROLE", role.rows[0]);

  const tables = await client.query(`
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           coalesce((
             select count(*)::int from pg_policies p
             where p.schemaname = n.nspname and p.tablename = c.relname
           ), 0) as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  `);
  console.log("TABLES");
  for (const row of tables.rows) {
    console.log(JSON.stringify(row));
  }

  const grants = await client.query(`
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon','authenticated','public')
    group by table_name, grantee
    order by table_name, grantee
  `);
  console.log("GRANTS");
  for (const row of grants.rows) {
    console.log(JSON.stringify(row));
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
