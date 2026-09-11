ALTER TABLE "provider_subscriptions" ADD COLUMN IF NOT EXISTS "paused_at" timestamptz;
ALTER TABLE "provider_subscriptions" ADD COLUMN IF NOT EXISTS "pause_reason" text;
ALTER TABLE "provider_subscriptions" ADD COLUMN IF NOT EXISTS "remaining_ms_at_pause" bigint;
ALTER TABLE "provider_subscriptions" ADD COLUMN IF NOT EXISTS "paused_by" uuid;

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" varchar(32) PRIMARY KEY,
  "subscriptions_paused" boolean NOT NULL DEFAULT false,
  "subscriptions_paused_at" timestamptz,
  "subscriptions_pause_reason" text,
  "subscriptions_paused_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "platform_settings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_subscriptions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "platform_settings" FROM anon, authenticated;
