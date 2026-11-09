CREATE TYPE "public"."account_status" AS ENUM('pending_verification', 'pending_approval', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_reconciliation', 'reconciled', 'incoming');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('none', 'reserved', 'settled', 'released');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('developer', 'admin');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" varchar(160) NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"country" varchar(2) DEFAULT 'GH' NOT NULL,
	"intended_use" text NOT NULL,
	"expected_monthly_volume" integer NOT NULL,
	"status" "account_status" DEFAULT 'pending_verification' NOT NULL,
	"terms_version" varchar(24) NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"daily_spend_limit_minor" bigint DEFAULT 50000 NOT NULL,
	"daily_volume_limit" integer DEFAULT 50 NOT NULL,
	"per_minute_limit" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_limits_positive" CHECK ("accounts"."daily_spend_limit_minor" >= 0 AND "accounts"."daily_volume_limit" >= 0 AND "accounts"."per_minute_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"account_id" uuid,
	"action" varchar(90) NOT NULL,
	"target_type" varchar(50),
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"recipient" varchar(24) NOT NULL,
	"source" varchar(180) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"phone_id" uuid NOT NULL,
	"recipient" varchar(24) NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_key" varchar(80) NOT NULL,
	"day" date NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"message_id" uuid,
	"provider" varchar(32) NOT NULL,
	"provider_message_id" text NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" varchar(40) NOT NULL,
	"occurred_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"body_hash" varchar(64) NOT NULL,
	"response" jsonb NOT NULL,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"project_id" uuid,
	"kind" varchar(40) NOT NULL,
	"dedup_key" varchar(180) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"locked_by" varchar(80),
	"last_error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"kind" varchar(30) NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_nonnegative_customer" CHECK ("ledger_accounts"."account_id" IS NULL OR "ledger_accounts"."balance_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_nonzero_entry" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"reference" varchar(180) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"state" "reservation_status" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid,
	"channel" "message_channel" NOT NULL,
	"direction" varchar(8) DEFAULT 'outbound' NOT NULL,
	"recipient" varchar(24) NOT NULL,
	"sender" varchar(40) NOT NULL,
	"body_encrypted" text,
	"template_name" varchar(180),
	"template_language" varchar(18),
	"variables_encrypted" text,
	"whatsapp_phone_id" uuid,
	"segments" integer,
	"pricing_id" uuid,
	"quoted_minor" bigint DEFAULT 0 NOT NULL,
	"charged_minor" bigint DEFAULT 0 NOT NULL,
	"supplier_cost_minor" bigint,
	"supplier_currency" varchar(3),
	"reservation_status" "reservation_status" DEFAULT 'none' NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"provider_pricing_type" varchar(40),
	"provider_pricing_category" varchar(40),
	"error_code" varchar(60),
	"last_provider_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reference" varchar(80) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'GHS' NOT NULL,
	"status" varchar(24) DEFAULT 'initializing' NOT NULL,
	"provider_transaction_id" varchar(40),
	"credited_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_positive" CHECK ("payment_attempts"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid,
	"event_hash" varchar(64) NOT NULL,
	"kind" varchar(60) NOT NULL,
	"reference" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"minimum_funding_minor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_singleton" CHECK ("platform_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "pricing_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "message_channel" NOT NULL,
	"country" varchar(2) NOT NULL,
	"route" varchar(60) NOT NULL,
	"category" varchar(32) NOT NULL,
	"customer_unit_minor" bigint NOT NULL,
	"provider_cost_minor" bigint,
	"provider_cost_currency" varchar(3),
	"provider_fee_minor" bigint DEFAULT 0 NOT NULL,
	"service_margin_minor" bigint DEFAULT 0 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_nonnegative" CHECK ("pricing_versions"."customer_unit_minor" > 0 AND "pricing_versions"."provider_fee_minor" >= 0 AND "pricing_versions"."service_margin_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"daily_spend_limit_minor" bigint DEFAULT 10000 NOT NULL,
	"daily_volume_limit" integer DEFAULT 25 NOT NULL,
	"per_minute_limit" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_limits_positive" CHECK ("projects"."daily_spend_limit_minor" >= 0 AND "projects"."daily_volume_limit" >= 0 AND "projects"."per_minute_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"raw_payload" text NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"sender_id" varchar(11) NOT NULL,
	"brand" varchar(160) NOT NULL,
	"website" text NOT NULL,
	"sample_message" text NOT NULL,
	"provider_details" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"provider_reference" varchar(200),
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"email" varchar(254) NOT NULL,
	"subject" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"recipient" varchar(24) NOT NULL,
	"reason" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'developer' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"mfa_secret_encrypted" text,
	"mfa_pending_encrypted" text,
	"mfa_last_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"http_status" integer,
	"error" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"message_id" uuid,
	"type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"waba_id" varchar(40) NOT NULL,
	"business_id" varchar(40),
	"token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" varchar(30) DEFAULT 'pending_registration' NOT NULL,
	"last_error" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"meta_phone_id" varchar(40) NOT NULL,
	"display_phone" varchar(32),
	"verified_name" varchar(160),
	"quality" varchar(30),
	"status" varchar(30) DEFAULT 'pending_registration' NOT NULL,
	"billing_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"meta_template_id" varchar(60),
	"name" varchar(180) NOT NULL,
	"language" varchar(18) NOT NULL,
	"category" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"variable_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) NOT NULL,
	"rejection_reason" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_phone_id_whatsapp_numbers_id_fk" FOREIGN KEY ("phone_id") REFERENCES "public"."whatsapp_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reservations" ADD CONSTRAINT "message_reservations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reservations" ADD CONSTRAINT "message_reservations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_phone_id_whatsapp_numbers_id_fk" FOREIGN KEY ("whatsapp_phone_id") REFERENCES "public"."whatsapp_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_pricing_id_pricing_versions_id_fk" FOREIGN KEY ("pricing_id") REFERENCES "public"."pricing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_versions" ADD CONSTRAINT "pricing_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_requests" ADD CONSTRAINT "sender_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_requests" ADD CONSTRAINT "sender_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_event_id_webhook_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_project_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_account_idx" ON "audit_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_current_unique" ON "consent_records" USING btree ("account_id","channel","recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_unique" ON "conversations" USING btree ("phone_id","recipient");--> statement-breakpoint
CREATE INDEX "conversations_account_idx" ON "conversations" USING btree ("account_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_usage_unique" ON "daily_usage" USING btree ("entity_key","day");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_fingerprint_unique" ON "delivery_events" USING btree ("provider","fingerprint");--> statement-breakpoint
CREATE INDEX "delivery_message_idx" ON "delivery_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_project_key_unique" ON "idempotency_records" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_unique" ON "jobs" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_customer_kind_unique" ON "ledger_accounts" USING btree ("account_id","kind") WHERE "ledger_accounts"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_platform_kind_unique" ON "ledger_accounts" USING btree ("kind") WHERE "ledger_accounts"."account_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ledger_entry_tx_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_account_idx" ON "ledger_entries" USING btree ("ledger_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reference_unique" ON "ledger_transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "ledger_tx_account_idx" ON "ledger_transactions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_message_unique" ON "message_reservations" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "reservation_account_idx" ON "message_reservations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "messages_project_idx" ON "messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_account_idx" ON "messages" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_unique" ON "messages" USING btree ("channel","provider_message_id") WHERE "messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_unique" ON "payment_attempts" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payments_account_idx" ON "payment_attempts" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_event_hash_unique" ON "payment_events" USING btree ("event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_version_unique" ON "pricing_versions" USING btree ("channel","country","route","category","effective_from");--> statement-breakpoint
CREATE INDEX "pricing_lookup_idx" ON "pricing_versions" USING btree ("channel","country","route","category","effective_from");--> statement-breakpoint
CREATE INDEX "projects_account_idx" ON "projects" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_unique" ON "provider_configs" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_webhook_fingerprint_unique" ON "provider_webhook_events" USING btree ("provider","fingerprint");--> statement-breakpoint
CREATE INDEX "provider_webhook_time_idx" ON "provider_webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_counter_unique" ON "rate_counters" USING btree ("key","minute");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_account_name_unique" ON "sender_requests" USING btree ("account_id","sender_id");--> statement-breakpoint
CREATE INDEX "sender_status_idx" ON "sender_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_status_idx" ON "support_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_unique" ON "suppressions" USING btree ("account_id","channel","recipient");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_account_idx" ON "users" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "webhook_attempt_endpoint_idx" ON "webhook_attempts" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_project_idx" ON "webhook_endpoints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_event_project_idx" ON "webhook_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_waba_unique" ON "whatsapp_connections" USING btree ("waba_id");--> statement-breakpoint
CREATE INDEX "whatsapp_account_idx" ON "whatsapp_connections" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_number_unique" ON "whatsapp_numbers" USING btree ("meta_phone_id");--> statement-breakpoint
CREATE INDEX "whatsapp_numbers_account_idx" ON "whatsapp_numbers" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_template_unique" ON "whatsapp_templates" USING btree ("connection_id","name","language");