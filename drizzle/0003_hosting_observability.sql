CREATE TABLE "hosted_app_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"message" varchar(300) NOT NULL,
	"deployment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_app_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" varchar(120) NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_app_events" ADD CONSTRAINT "hosted_app_events_app_id_hosted_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."hosted_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_app_events" ADD CONSTRAINT "hosted_app_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_app_env_vars" ADD CONSTRAINT "hosted_app_env_vars_app_id_hosted_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."hosted_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hosted_app_events_app_idx" ON "hosted_app_events" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_app_env_app_key_unique" ON "hosted_app_env_vars" USING btree ("app_id","key");
