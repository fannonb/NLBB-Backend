-- Migrate to Supabase Auth
-- Removes custom auth tables and password_hash column; IDs are now owned by auth.users

--> statement-breakpoint
DROP TABLE IF EXISTS "auth_action_tokens";
--> statement-breakpoint
DROP TABLE IF EXISTS "auth_sessions";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer';
