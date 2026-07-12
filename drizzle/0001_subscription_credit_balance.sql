ALTER TABLE "provider_subscriptions"
ADD COLUMN IF NOT EXISTS "credit_balance" numeric(12, 2) DEFAULT '0' NOT NULL;
