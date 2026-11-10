CREATE TYPE "public"."app_deployment_status" AS ENUM('queued', 'building', 'live', 'failed');--> statement-breakpoint
CREATE TYPE "public"."hosted_app_status" AS ENUM('pending', 'building', 'live', 'paused_no_funds', 'paused_manual', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "app_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"ref" varchar(120) NOT NULL,
	"status" "app_deployment_status" DEFAULT 'queued' NOT NULL,
	"build_log_tail" text,
	"error" varchar(240),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"slug" varchar(40) NOT NULL,
	"builder" varchar(20) NOT NULL,
	"repo_url" text NOT NULL,
	"repo_token_encrypted" text,
	"branch" varchar(120) DEFAULT 'main' NOT NULL,
	"plan" varchar(20) NOT NULL,
	"status" "hosted_app_status" DEFAULT 'pending' NOT NULL,
	"url" text,
	"container_ref" varchar(120),
	"current_deployment_id" uuid,
	"plan_started_at" timestamp with time zone,
	"plan_expires_at" timestamp with time zone,
	"last_error" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_app_id_hosted_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."hosted_apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_apps" ADD CONSTRAINT "hosted_apps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_apps" ADD CONSTRAINT "hosted_apps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_deployments_app_idx" ON "app_deployments" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_apps_slug_unique" ON "hosted_apps" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_apps_project_name_unique" ON "hosted_apps" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "hosted_apps_account_idx" ON "hosted_apps" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "hosted_apps_renewal_idx" ON "hosted_apps" USING btree ("status","plan_expires_at");