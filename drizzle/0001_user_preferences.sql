CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme_mode" varchar(16) DEFAULT 'light' NOT NULL,
	"booking_confirmation" boolean DEFAULT true NOT NULL,
	"booking_reminder" boolean DEFAULT true NOT NULL,
	"booking_update" boolean DEFAULT true NOT NULL,
	"provider_message" boolean DEFAULT true NOT NULL,
	"provider_promo" boolean DEFAULT false NOT NULL,
	"provider_review" boolean DEFAULT true NOT NULL,
	"app_update" boolean DEFAULT false NOT NULL,
	"account_alert" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
