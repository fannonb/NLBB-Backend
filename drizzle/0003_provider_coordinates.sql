ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "latitude" numeric(10, 7);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN IF NOT EXISTS "longitude" numeric(10, 7);
