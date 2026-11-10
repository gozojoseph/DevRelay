CREATE TYPE "public"."domain_order_action" AS ENUM('register', 'renew');--> statement-breakpoint
CREATE TYPE "public"."domain_order_status" AS ENUM('pending', 'done', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending_register', 'active', 'expired', 'lapsed', 'failed');--> statement-breakpoint
CREATE TABLE "domain_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"action" "domain_order_action" NOT NULL,
	"period_years" integer DEFAULT 1 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "domain_order_status" DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(120),
	"error" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(253) NOT NULL,
	"tld" varchar(30) NOT NULL,
	"status" "domain_status" DEFAULT 'pending_register' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"period_years" integer DEFAULT 1 NOT NULL,
	"registrant" jsonb NOT NULL,
	"nameservers" jsonb,
	"provider_reference" varchar(120),
	"registered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_warning_level" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_orders_domain_idx" ON "domain_orders" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_unique" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "domains_account_idx" ON "domains" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "domains_renewal_idx" ON "domains" USING btree ("status","auto_renew","expires_at");