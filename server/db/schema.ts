import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => time('created_at').defaultNow().notNull();
const amount = (name: string) => bigint(name, { mode: 'number' });

export const accountStatus = pgEnum('account_status', ['pending_verification', 'pending_approval', 'active', 'suspended']);
export const userRole = pgEnum('user_role', ['developer', 'admin']);
export const channel = pgEnum('message_channel', ['sms', 'whatsapp']);
export const messageStatus = pgEnum('message_status', ['queued', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'pending_reconciliation', 'reconciled', 'incoming']);
export const reservationStatus = pgEnum('reservation_status', ['none', 'reserved', 'settled', 'released']);
export const jobStatus = pgEnum('job_status', ['pending', 'running', 'done', 'dead']);
export const hostedAppStatus = pgEnum('hosted_app_status', [
  'pending', 'building', 'live', 'paused_no_funds', 'paused_manual', 'failed', 'deleted',
]);
export const appDeploymentStatus = pgEnum('app_deployment_status', ['queued', 'building', 'live', 'failed']);

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessName: varchar('business_name', { length: 160 }).notNull(),
  contactEmail: varchar('contact_email', { length: 254 }).notNull(),
  country: varchar('country', { length: 2 }).notNull().default('GH'),
  intendedUse: text('intended_use').notNull(),
  expectedMonthlyVolume: integer('expected_monthly_volume').notNull(),
  status: accountStatus('status').notNull().default('pending_verification'),
  termsVersion: varchar('terms_version', { length: 24 }).notNull(),
  termsAcceptedAt: time('terms_accepted_at').notNull(),
  dailySpendLimitMinor: amount('daily_spend_limit_minor').notNull().default(50000),
  dailyVolumeLimit: integer('daily_volume_limit').notNull().default(50),
  perMinuteLimit: integer('per_minute_limit').notNull().default(10),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [check('account_limits_positive', sql`${t.dailySpendLimitMinor} >= 0 AND ${t.dailyVolumeLimit} >= 0 AND ${t.perMinuteLimit} > 0`)]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').references(() => accounts.id),
  email: varchar('email', { length: 254 }).notNull(), passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('developer'), emailVerifiedAt: time('email_verified_at'),
  mfaSecretEncrypted: text('mfa_secret_encrypted'), mfaPendingEncrypted: text('mfa_pending_encrypted'),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email), index('users_account_idx').on(t.accountId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(), expiresAt: time('expires_at').notNull(),
  invalidatedAt: time('invalidated_at'), createdAt: created(),
}, (t) => [uniqueIndex('sessions_token_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(), userId: uuid('user_id').notNull().references(() => users.id),
  kind: varchar('kind', { length: 24 }).notNull(), tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: time('expires_at').notNull(), consumedAt: time('consumed_at'), createdAt: created(),
}, (t) => [uniqueIndex('auth_tokens_hash_unique').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId)]);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: varchar('name', { length: 100 }).notNull(), dailySpendLimitMinor: amount('daily_spend_limit_minor').notNull().default(10000),
  dailyVolumeLimit: integer('daily_volume_limit').notNull().default(25), perMinuteLimit: integer('per_minute_limit').notNull().default(5),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [index('projects_account_idx').on(t.accountId), check('project_limits_positive', sql`${t.dailySpendLimitMinor} >= 0 AND ${t.dailyVolumeLimit} >= 0 AND ${t.perMinuteLimit} > 0`)]);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: varchar('name', { length: 100 }).notNull(), prefix: varchar('prefix', { length: 32 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(), scopes: text('scopes').array().notNull(),
  lastUsedAt: time('last_used_at'), revokedAt: time('revoked_at'), createdAt: created(),
}, (t) => [uniqueIndex('api_keys_hash_unique').on(t.keyHash), index('api_keys_project_idx').on(t.projectId)]);

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').references(() => accounts.id),
  kind: varchar('kind', { length: 30 }).notNull(), currency: varchar('currency', { length: 3 }).notNull().default('GHS'),
  balanceMinor: amount('balance_minor').notNull().default(0), createdAt: created(),
}, (t) => [
  uniqueIndex('ledger_customer_kind_unique').on(t.accountId, t.kind).where(sql`${t.accountId} IS NOT NULL`),
  uniqueIndex('ledger_platform_kind_unique').on(t.kind).where(sql`${t.accountId} IS NULL`),
  check('ledger_nonnegative_customer', sql`${t.accountId} IS NULL OR ${t.balanceMinor} >= 0`),
]);

export const ledgerTransactions = pgTable('ledger_transactions', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  kind: varchar('kind', { length: 32 }).notNull(), reference: varchar('reference', { length: 180 }).notNull(),
  description: text('description'), createdAt: created(),
}, (t) => [uniqueIndex('ledger_reference_unique').on(t.reference), index('ledger_tx_account_idx').on(t.accountId, t.createdAt)]);

export const ledgerEntries = pgTable('ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(), transactionId: uuid('transaction_id').notNull().references(() => ledgerTransactions.id),
  ledgerAccountId: uuid('ledger_account_id').notNull().references(() => ledgerAccounts.id),
  amountMinor: amount('amount_minor').notNull(), createdAt: created(),
}, (t) => [index('ledger_entry_tx_idx').on(t.transactionId), index('ledger_entry_account_idx').on(t.ledgerAccountId), check('ledger_nonzero_entry', sql`${t.amountMinor} <> 0`)]);

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  userId: uuid('user_id').notNull().references(() => users.id), reference: varchar('reference', { length: 80 }).notNull(),
  amountMinor: amount('amount_minor').notNull(), currency: varchar('currency', { length: 3 }).notNull().default('GHS'),
  status: varchar('status', { length: 24 }).notNull().default('initializing'),
  providerTransactionId: varchar('provider_transaction_id', { length: 40 }), creditedAt: time('credited_at'),
  lastCheckedAt: time('last_checked_at'), createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('payments_reference_unique').on(t.reference), index('payments_account_idx').on(t.accountId, t.createdAt), check('payment_positive', sql`${t.amountMinor} > 0`)]);

export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(), attemptId: uuid('attempt_id').references(() => paymentAttempts.id),
  eventHash: varchar('event_hash', { length: 64 }).notNull(), kind: varchar('kind', { length: 60 }).notNull(),
  reference: varchar('reference', { length: 80 }), createdAt: created(),
}, (t) => [uniqueIndex('payment_event_hash_unique').on(t.eventHash)]);

export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1), minimumFundingMinor: amount('minimum_funding_minor'),
  updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [check('platform_singleton', sql`${t.id} = 1`)]);

export const providerConfigs = pgTable('provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(), provider: varchar('provider', { length: 40 }).notNull(),
  enabled: boolean('enabled').notNull().default(false), settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('provider_configs_unique').on(t.provider)]);

export const pricingVersions = pgTable('pricing_versions', {
  id: uuid('id').primaryKey().defaultRandom(), channel: channel('channel').notNull(),
  country: varchar('country', { length: 2 }).notNull(), route: varchar('route', { length: 60 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  customerUnitMinor: amount('customer_unit_minor').notNull(), providerCostMinor: amount('provider_cost_minor'),
  providerCostCurrency: varchar('provider_cost_currency', { length: 3 }),
  providerFeeMinor: amount('provider_fee_minor').notNull().default(0), serviceMarginMinor: amount('service_margin_minor').notNull().default(0),
  effectiveFrom: time('effective_from').notNull(), effectiveTo: time('effective_to'),
  createdBy: uuid('created_by').references(() => users.id), createdAt: created(),
}, (t) => [
  uniqueIndex('pricing_version_unique').on(t.channel, t.country, t.route, t.category, t.effectiveFrom),
  index('pricing_lookup_idx').on(t.channel, t.country, t.route, t.category, t.effectiveFrom),
  check('pricing_nonnegative', sql`${t.customerUnitMinor} > 0 AND ${t.providerFeeMinor} >= 0 AND ${t.serviceMarginMinor} >= 0`),
]);

export const senderRequests = pgTable('sender_requests', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  senderId: varchar('sender_id', { length: 11 }).notNull(), brand: varchar('brand', { length: 160 }).notNull(),
  website: text('website').notNull(), sampleMessage: text('sample_message').notNull(),
  providerDetails: text('provider_details'), status: varchar('status', { length: 16 }).notNull().default('pending'),
  providerReference: varchar('provider_reference', { length: 200 }), rejectionReason: text('rejection_reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id), reviewedAt: time('reviewed_at'), createdAt: created(),
}, (t) => [uniqueIndex('sender_account_name_unique').on(t.accountId, t.senderId), index('sender_status_idx').on(t.status)]);

export const whatsappConnections = pgTable('whatsapp_connections', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  wabaId: varchar('waba_id', { length: 40 }).notNull(), businessId: varchar('business_id', { length: 40 }),
  tokenEncrypted: text('token_encrypted').notNull(), tokenExpiresAt: time('token_expires_at'),
  status: varchar('status', { length: 30 }).notNull().default('pending_registration'),
  lastError: text('last_error'), syncedAt: time('synced_at'),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('whatsapp_waba_unique').on(t.wabaId), index('whatsapp_account_idx').on(t.accountId)]);

export const whatsappNumbers = pgTable('whatsapp_numbers', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id),
  metaPhoneId: varchar('meta_phone_id', { length: 40 }).notNull(), displayPhone: varchar('display_phone', { length: 32 }),
  verifiedName: varchar('verified_name', { length: 160 }), quality: varchar('quality', { length: 30 }),
  status: varchar('status', { length: 30 }).notNull().default('pending_registration'),
  billingConfirmedAt: time('billing_confirmed_at'), createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('whatsapp_number_unique').on(t.metaPhoneId), index('whatsapp_numbers_account_idx').on(t.accountId)]);

export const whatsappTemplates = pgTable('whatsapp_templates', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id),
  metaTemplateId: varchar('meta_template_id', { length: 60 }), name: varchar('name', { length: 180 }).notNull(),
  language: varchar('language', { length: 18 }).notNull(), category: varchar('category', { length: 32 }).notNull(),
  body: text('body').notNull(), variableCount: integer('variable_count').notNull().default(0),
  status: varchar('status', { length: 30 }).notNull(), rejectionReason: text('rejection_reason'),
  syncedAt: time('synced_at'), createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('whatsapp_template_unique').on(t.connectionId, t.name, t.language)]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  phoneId: uuid('phone_id').notNull().references(() => whatsappNumbers.id),
  recipient: varchar('recipient', { length: 24 }).notNull(), lastInboundAt: time('last_inbound_at'),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('conversation_unique').on(t.phoneId, t.recipient), index('conversations_account_idx').on(t.accountId, t.updatedAt)]);

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  channel: channel('channel').notNull(), recipient: varchar('recipient', { length: 24 }).notNull(),
  source: varchar('source', { length: 180 }).notNull(), consentedAt: time('consented_at').notNull(),
  revokedAt: time('revoked_at'), createdAt: created(),
}, (t) => [uniqueIndex('consent_current_unique').on(t.accountId, t.channel, t.recipient)]);

export const suppressions = pgTable('suppressions', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  channel: channel('channel').notNull(), recipient: varchar('recipient', { length: 24 }).notNull(),
  reason: varchar('reason', { length: 80 }).notNull(), createdAt: created(),
}, (t) => [uniqueIndex('suppression_unique').on(t.accountId, t.channel, t.recipient)]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  projectId: uuid('project_id').references(() => projects.id), channel: channel('channel').notNull(),
  direction: varchar('direction', { length: 8 }).notNull().default('outbound'),
  recipient: varchar('recipient', { length: 24 }).notNull(), sender: varchar('sender', { length: 40 }).notNull(),
  bodyEncrypted: text('body_encrypted'), templateName: varchar('template_name', { length: 180 }),
  templateLanguage: varchar('template_language', { length: 18 }), variablesEncrypted: text('variables_encrypted'),
  whatsappPhoneId: uuid('whatsapp_phone_id').references(() => whatsappNumbers.id),
  segments: integer('segments'), pricingId: uuid('pricing_id').references(() => pricingVersions.id),
  quotedMinor: amount('quoted_minor').notNull().default(0), chargedMinor: amount('charged_minor').notNull().default(0),
  supplierCostMinor: amount('supplier_cost_minor'), supplierCurrency: varchar('supplier_currency', { length: 3 }),
  reservationStatus: reservationStatus('reservation_status').notNull().default('none'),
  status: messageStatus('status').notNull().default('queued'), providerMessageId: text('provider_message_id'),
  providerPricingType: varchar('provider_pricing_type', { length: 40 }), providerPricingCategory: varchar('provider_pricing_category', { length: 40 }),
  errorCode: varchar('error_code', { length: 60 }), lastProviderAt: time('last_provider_at'),
  acceptedAt: time('accepted_at'), createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [
  index('messages_project_idx').on(t.projectId, t.createdAt), index('messages_account_idx').on(t.accountId, t.createdAt),
  uniqueIndex('messages_provider_unique').on(t.channel, t.providerMessageId).where(sql`${t.providerMessageId} IS NOT NULL`),
]);

export const providerWebhookEvents = pgTable('provider_webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(), provider: varchar('provider', { length: 32 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  rawPayload: text('raw_payload').notNull(), processedAt: time('processed_at'), lastError: varchar('last_error', { length: 240 }),
  createdAt: created(),
}, (t) => [uniqueIndex('provider_webhook_fingerprint_unique').on(t.provider, t.fingerprint), index('provider_webhook_time_idx').on(t.createdAt)]);

export const deliveryEvents = pgTable('delivery_events', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').references(() => accounts.id),
  messageId: uuid('message_id').references(() => messages.id), provider: varchar('provider', { length: 32 }).notNull(),
  providerMessageId: text('provider_message_id').notNull(), fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  status: varchar('status', { length: 40 }).notNull(), occurredAt: time('occurred_at'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(),
}, (t) => [uniqueIndex('delivery_fingerprint_unique').on(t.provider, t.fingerprint), index('delivery_message_idx').on(t.messageId)]);

export const messageReservations = pgTable('message_reservations', {
  id: uuid('id').primaryKey().defaultRandom(), messageId: uuid('message_id').notNull().references(() => messages.id),
  accountId: uuid('account_id').notNull().references(() => accounts.id), amountMinor: amount('amount_minor').notNull(),
  state: reservationStatus('state').notNull().default('reserved'), createdAt: created(), settledAt: time('settled_at'),
}, (t) => [uniqueIndex('reservation_message_unique').on(t.messageId), index('reservation_account_idx').on(t.accountId)]);

export const idempotencyRecords = pgTable('idempotency_records', {
  id: uuid('id').primaryKey().defaultRandom(), projectId: uuid('project_id').notNull().references(() => projects.id),
  key: varchar('key', { length: 128 }).notNull(), bodyHash: varchar('body_hash', { length: 64 }).notNull(),
  response: jsonb('response').$type<Record<string, unknown>>().notNull(), messageId: uuid('message_id').references(() => messages.id),
  createdAt: created(),
}, (t) => [uniqueIndex('idempotency_project_key_unique').on(t.projectId, t.key)]);

export const dailyUsage = pgTable('daily_usage', {
  id: uuid('id').primaryKey().defaultRandom(), entityKey: varchar('entity_key', { length: 80 }).notNull(),
  day: date('day').notNull(), volume: integer('volume').notNull().default(0), spendMinor: amount('spend_minor').notNull().default(0),
}, (t) => [uniqueIndex('daily_usage_unique').on(t.entityKey, t.day)]);

export const rateCounters = pgTable('rate_counters', {
  id: uuid('id').primaryKey().defaultRandom(), key: varchar('key', { length: 100 }).notNull(),
  minute: timestamp('minute', { withTimezone: true, mode: 'date' }).notNull(), count: integer('count').notNull().default(0),
}, (t) => [uniqueIndex('rate_counter_unique').on(t.key, t.minute)]);

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').references(() => accounts.id),
  projectId: uuid('project_id').references(() => projects.id), kind: varchar('kind', { length: 40 }).notNull(),
  dedupKey: varchar('dedup_key', { length: 180 }).notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: jobStatus('status').notNull().default('pending'), attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5), runAt: time('run_at').defaultNow().notNull(),
  leaseUntil: time('lease_until'), lockedBy: varchar('locked_by', { length: 80 }), lastError: varchar('last_error', { length: 300 }),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [uniqueIndex('jobs_dedup_unique').on(t.dedupKey), index('jobs_due_idx').on(t.status, t.runAt)]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  projectId: uuid('project_id').notNull().references(() => projects.id), url: text('url').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(), events: text('events').array().notNull(),
  active: boolean('active').notNull().default(true), createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [index('webhook_endpoints_project_idx').on(t.projectId)]);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  messageId: uuid('message_id').references(() => messages.id), type: varchar('type', { length: 64 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(), createdAt: created(),
}, (t) => [index('webhook_event_project_idx').on(t.projectId, t.createdAt)]);

export const webhookAttempts = pgTable('webhook_attempts', {
  id: uuid('id').primaryKey().defaultRandom(), eventId: uuid('event_id').notNull().references(() => webhookEvents.id),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id),
  attempt: integer('attempt').notNull(), httpStatus: integer('http_status'), error: varchar('error', { length: 200 }),
  createdAt: created(),
}, (t) => [index('webhook_attempt_endpoint_idx').on(t.endpointId, t.createdAt)]);

// DevRelay Cloud: hosted customer apps (docs/hosting.md). One container per
// app on the host agent; billing is a monthly plan charged in advance from the
// GHS wallet. States are honest: `paused_no_funds` means the wallet could not
// cover renewal, never a silent outage; a failed redeploy keeps the previous
// container serving.
export const hostedApps = pgTable('hosted_apps', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').notNull().references(() => accounts.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  name: varchar('name', { length: 60 }).notNull(), slug: varchar('slug', { length: 40 }).notNull(),
  builder: varchar('builder', { length: 20 }).notNull(), // 'dockerfile' | 'node'
  repoUrl: text('repo_url').notNull(), repoTokenEncrypted: text('repo_token_encrypted'),
  branch: varchar('branch', { length: 120 }).notNull().default('main'),
  plan: varchar('plan', { length: 20 }).notNull(), status: hostedAppStatus('status').notNull().default('pending'),
  url: text('url'), containerRef: varchar('container_ref', { length: 120 }),
  currentDeploymentId: uuid('current_deployment_id'),
  planStartedAt: time('plan_started_at'), planExpiresAt: time('plan_expires_at'),
  lastError: varchar('last_error', { length: 240 }),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('hosted_apps_slug_unique').on(t.slug),
  uniqueIndex('hosted_apps_project_name_unique').on(t.projectId, t.name),
  index('hosted_apps_account_idx').on(t.accountId), index('hosted_apps_renewal_idx').on(t.status, t.planExpiresAt),
]);

export const appDeployments = pgTable('app_deployments', {
  id: uuid('id').primaryKey().defaultRandom(), appId: uuid('app_id').notNull().references(() => hostedApps.id),
  ref: varchar('ref', { length: 120 }).notNull(), status: appDeploymentStatus('status').notNull().default('queued'),
  buildLogTail: text('build_log_tail'), error: varchar('error', { length: 240 }),
  startedAt: time('started_at'), finishedAt: time('finished_at'), createdAt: created(),
}, (t) => [index('app_deployments_app_idx').on(t.appId, t.createdAt)]);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), actorUserId: uuid('actor_user_id').references(() => users.id),
  accountId: uuid('account_id').references(() => accounts.id), action: varchar('action', { length: 90 }).notNull(),
  targetType: varchar('target_type', { length: 50 }), targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(),
}, (t) => [index('audit_account_idx').on(t.accountId, t.createdAt), index('audit_time_idx').on(t.createdAt)]);

export const supportRequests = pgTable('support_requests', {
  id: uuid('id').primaryKey().defaultRandom(), accountId: uuid('account_id').references(() => accounts.id),
  email: varchar('email', { length: 254 }).notNull(), subject: varchar('subject', { length: 160 }).notNull(),
  body: text('body').notNull(), status: varchar('status', { length: 20 }).notNull().default('open'),
  createdAt: created(), updatedAt: time('updated_at').defaultNow().notNull(),
}, (t) => [index('support_status_idx').on(t.status, t.createdAt)]);
