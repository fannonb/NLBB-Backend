ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "booking_id" uuid;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "purpose" varchar(32) NOT NULL DEFAULT 'provider_subscription';

DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
