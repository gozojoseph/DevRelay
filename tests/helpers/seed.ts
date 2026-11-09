import { randomUUID } from 'node:crypto';
import {
  accounts, consentRecords, conversations, dailyUsage, ledgerAccounts, messages,
  messageReservations, pricingVersions, projects, senderRequests, suppressions,
  users, webhookEndpoints, whatsappConnections, whatsappNumbers, whatsappTemplates,
} from '../../server/db/schema.js';
import type { TestDb } from './db.js';

const AUTO = 'DEVRELAY';
export const RECIPIENT = '+233244000000';
export const WA_RECIPIENT = '+233201234567';
const DAY_AGO = () => new Date(Date.now() - 86_400_000);

export type Account = typeof accounts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Message = typeof messages.$inferSelect;

export async function seedAccount(
  db: TestDb,
  overrides: Partial<typeof accounts.$inferInsert> = {},
): Promise<Account> {
  const [row] = await db.insert(accounts).values({
    businessName: 'Dev Relay Test Ltd',
    contactEmail: `owner-${randomUUID()}@example.test`,
    intendedUse: 'Appointment reminders for a clinic network',
    expectedMonthlyVolume: 5_000,
    status: 'active',
    termsVersion: '2026-01',
    termsAcceptedAt: DAY_AGO(),
    ...overrides,
  }).returning();
  return row!;
}

export async function seedLedgerWallets(
  db: TestDb,
  accountId: string,
  availableMinor = 100_000,
  reservedMinor = 0,
): Promise<void> {
  await db.insert(ledgerAccounts).values([
    { accountId, kind: 'customer_available', balanceMinor: availableMinor },
    { accountId, kind: 'customer_reserved', balanceMinor: reservedMinor },
  ]);
}

export async function seedPlatformWallet(db: TestDb, kind: string, balanceMinor: number): Promise<void> {
  await db.insert(ledgerAccounts).values({ accountId: null, kind, balanceMinor });
}

export async function seedProject(
  db: TestDb,
  accountId: string,
  overrides: Partial<typeof projects.$inferInsert> = {},
): Promise<Project> {
  const [row] = await db.insert(projects).values({
    accountId, name: `Test Project ${randomUUID().slice(0, 8)}`, ...overrides,
  }).returning();
  return row!;
}

export async function seedUser(
  db: TestDb,
  accountId: string | null,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
  const [row] = await db.insert(users).values({
    accountId,
    email: `user-${randomUUID()}@example.test`,
    passwordHash: 'scrypt$32768$salt$x',
    role: accountId ? 'developer' : 'admin',
    emailVerifiedAt: DAY_AGO(),
    ...overrides,
  }).returning();
  return row!;
}

export async function seedSender(
  db: TestDb,
  accountId: string,
  senderId = AUTO,
  status = 'approved',
): Promise<typeof senderRequests.$inferSelect> {
  const [row] = await db.insert(senderRequests).values({
    accountId, senderId, brand: 'Dev Relay Clinic', website: 'https://example.test',
    sampleMessage: 'Your appointment is confirmed.', status,
  }).returning();
  return row!;
}

export async function seedConsent(
  db: TestDb,
  accountId: string,
  channel: 'sms' | 'whatsapp',
  recipient: string,
): Promise<typeof consentRecords.$inferSelect> {
  const [row] = await db.insert(consentRecords).values({
    accountId, channel, recipient, source: 'dashboard', consentedAt: DAY_AGO(),
  }).returning();
  return row!;
}

export async function seedRevokedConsent(
  db: TestDb,
  accountId: string,
  channel: 'sms' | 'whatsapp',
  recipient: string,
): Promise<typeof consentRecords.$inferSelect> {
  const [row] = await db.insert(consentRecords).values({
    accountId, channel, recipient, source: 'dashboard', consentedAt: DAY_AGO(), revokedAt: new Date(),
  }).returning();
  return row!;
}

export async function seedSuppression(
  db: TestDb,
  accountId: string,
  channel: 'sms' | 'whatsapp',
  recipient: string,
): Promise<typeof suppressions.$inferSelect> {
  const [row] = await db.insert(suppressions).values({
    accountId, channel, recipient, reason: 'customer_opt_out',
  }).returning();
  return row!;
}

export async function seedSmsPrice(
  db: TestDb,
  unitMinor = 20,
  options: { daysAgo?: number } = {},
): Promise<typeof pricingVersions.$inferSelect> {
  const [row] = await db.insert(pricingVersions).values({
    channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional',
    customerUnitMinor: unitMinor, providerCostMinor: 8, providerCostCurrency: 'GHS',
    effectiveFrom: new Date(Date.now() - (options.daysAgo ?? 1) * 86_400_000),
  }).returning();
  return row!;
}

export async function seedWhatsappPrice(
  db: TestDb,
  category = 'marketing',
  unitMinor = 150,
): Promise<typeof pricingVersions.$inferSelect> {
  const [row] = await db.insert(pricingVersions).values({
    channel: 'whatsapp', country: 'GH', route: 'meta_cloud', category,
    customerUnitMinor: unitMinor, providerFeeMinor: 0, serviceMarginMinor: 0,
    effectiveFrom: DAY_AGO(),
  }).returning();
  return row!;
}

export async function seedWhatsappSender(
  db: TestDb,
  accountId: string,
  options: { connectionStatus?: string; numberStatus?: string } = {},
): Promise<{ connection: typeof whatsappConnections.$inferSelect; number: typeof whatsappNumbers.$inferSelect }> {
  const [connection] = await db.insert(whatsappConnections).values({
    accountId,
    wabaId: `waba${randomUUID().slice(0, 12)}`,
    tokenEncrypted: 'test-connection-token-encoded',
    status: options.connectionStatus ?? 'active',
  }).returning();
  const [number] = await db.insert(whatsappNumbers).values({
    accountId, connectionId: connection.id,
    metaPhoneId: `phone${randomUUID().slice(0, 12)}`,
    displayPhone: '+233201234567', verifiedName: 'Dev Relay Test',
    status: options.numberStatus ?? 'active',
  }).returning();
  return { connection, number };
}

export async function seedTemplate(
  db: TestDb,
  accountId: string,
  connectionId: string,
  overrides: Partial<typeof whatsappTemplates.$inferInsert> = {},
): Promise<typeof whatsappTemplates.$inferSelect> {
  const [row] = await db.insert(whatsappTemplates).values({
    accountId, connectionId, name: 'delivery_update', language: 'en',
    category: 'MARKETING', body: 'Hello {{1}}', variableCount: 0,
    status: 'APPROVED', ...overrides,
  }).returning();
  return row!;
}

export async function seedConversation(
  db: TestDb,
  accountId: string,
  phoneId: string,
  options: { recipient?: string; lastInboundAt?: Date | null } = {},
): Promise<typeof conversations.$inferSelect> {
  const lastInboundAt = options.lastInboundAt ?? new Date();
  const [row] = await db.insert(conversations).values({
    accountId, phoneId, recipient: options.recipient ?? WA_RECIPIENT, lastInboundAt,
  }).onConflictDoUpdate({
    target: [conversations.phoneId, conversations.recipient],
    set: { lastInboundAt, updatedAt: new Date() },
  }).returning();
  return row!;
}

export async function seedMessage(
  db: TestDb,
  accountId: string,
  projectId: string,
  overrides: Partial<typeof messages.$inferInsert> = {},
): Promise<Message> {
  const [row] = await db.insert(messages).values({
    accountId, projectId, channel: 'sms', recipient: RECIPIENT, sender: AUTO,
    status: 'sent', reservationStatus: 'reserved', quotedMinor: 400, segments: 1,
    providerMessageId: `pmsg${randomUUID().slice(0, 12)}`,
    acceptedAt: DAY_AGO(),
    ...overrides,
  }).returning();
  return row!;
}

export async function seedReservation(
  db: TestDb,
  message: Message,
  amountMinor = message.quotedMinor,
): Promise<typeof messageReservations.$inferSelect> {
  const [row] = await db.insert(messageReservations).values({
    messageId: message.id, accountId: message.accountId, amountMinor,
  }).returning();
  return row!;
}

export async function seedWebhookEndpoint(
  db: TestDb,
  accountId: string,
  projectId: string,
  events: string[] = ['*'],
): Promise<typeof webhookEndpoints.$inferSelect> {
  const [row] = await db.insert(webhookEndpoints).values({
    accountId, projectId, url: 'https://hooks.example.test/devrelay',
    secretEncrypted: 'test-secret-encoded', events,
  }).returning();
  return row!;
}

export async function seedDailyUsage(
  db: TestDb,
  entityKey: string,
  volume: number,
  spendMinor: number,
): Promise<void> {
  await db.insert(dailyUsage).values({ entityKey, day: new Date().toISOString().slice(0, 10), volume, spendMinor });
}
