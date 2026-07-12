ALTER TABLE "bookings" ADD COLUMN "service_name" varchar(255);--> statement-breakpoint

UPDATE "bookings" AS b
SET "service_name" = ps."name"
FROM "provider_services" AS ps
WHERE b."provider_service_id" = ps."id"
  AND (b."service_name" IS NULL OR b."service_name" = '');--> statement-breakpoint

WITH matched_services AS (
  SELECT
    b."id" AS booking_id,
    ps."id" AS service_id,
    ps."name" AS service_name,
    row_number() OVER (
      PARTITION BY b."id"
      ORDER BY ps."sort_order", ps."created_at", ps."id"
    ) AS rn,
    count(*) OVER (PARTITION BY b."id") AS match_count
  FROM "bookings" AS b
  JOIN "provider_services" AS ps
    ON ps."provider_id" = b."provider_id"
   AND ps."price_amount" = b."service_price_amount"
  WHERE b."provider_service_id" IS NULL
)
UPDATE "bookings" AS b
SET
  "provider_service_id" = ms."service_id",
  "service_name" = COALESCE(NULLIF(b."service_name", ''), ms."service_name")
FROM matched_services AS ms
WHERE b."id" = ms."booking_id"
  AND ms."rn" = 1
  AND ms."match_count" = 1;--> statement-breakpoint
