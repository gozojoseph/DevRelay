export type Channel = 'sms' | 'whatsapp';
export type MessageStatus = 'queued' | 'sending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed'
  | 'pending_reconciliation' | 'reconciled' | 'incoming';
export type AccountStatus = 'pending_verification' | 'pending_approval' | 'active' | 'suspended';

export interface Availability { paystack: boolean; sms: boolean; whatsappTest: boolean; whatsappLive: boolean }
export interface PublicConfig {
  name: string; currency: string; country: string; publicApiUrl: string; supportEmail: string | null;
  minimumFundingMinor: number | null; fundingAvailable: boolean; smsAvailable: boolean; whatsappAvailable: boolean;
  whatsappProductionApproved: boolean; metaAppId: string | null; metaConfigId: string | null;
  metaGraphVersion: string; environment: string; pricingConfigured: boolean;
  hostingAvailable: boolean; domainsAvailable: boolean;
}
export interface HostingPlanPublic { id: string; label: string; memoryMb: number; cpuMilli: number; priceMinor: number }
export interface DomainPricePublic { tld: string; priceMinor: number }
export interface CloudPublic {
  hosting: { available: boolean; plans: HostingPlanPublic[] };
  domains: { available: boolean; periodDays: number; pricing: DomainPricePublic[] };
}
export interface PricingItem { id: string; channel: Channel; country: string; route: string; category: string;
  customerUnitMinor: number; effectiveFrom: string }
export interface PricingResponse { currency: string; unit: 'pesewas'; items: PricingItem[];
  minimumFundingMinor: number | null; note: string }

export interface AccountSummary { id: string; businessName: string; status: AccountStatus; country: string;
  dailySpendLimitMinor: number; dailyVolumeLimit: number }
export interface Me {
  user: { id: string; email: string; role: 'developer' | 'admin'; verified: boolean; mfaEnabled: boolean };
  account: AccountSummary | null;
  csrfToken: string;
  availability: Availability;
}
export interface LoginResponse { csrfToken: string; role: 'developer' | 'admin'; mfaSetupRequired: boolean }

export interface Project { id: string; accountId: string; name: string; dailySpendLimitMinor: number;
  dailyVolumeLimit: number; perMinuteLimit: number; createdAt: string; updatedAt: string }
export interface ApiKeySummary { id: string; name: string; prefix: string; scopes: string[];
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
export interface NewApiKey { id: string; prefix: string; scopes: string[]; key: string }
export interface Wallet { currency: string; availableMinor: number; reservedMinor: number;
  minimumFundingMinor?: number | null; fundingAvailable?: boolean }
export interface PaymentAttempt { reference: string; amountMinor: number; currency: string; status: string;
  createdAt: string; creditedAt?: string | null }
export interface LedgerEntry { reference: string; kind: string; amountMinor: number; createdAt: string }
export interface SenderRequest { id: string; senderId: string; brand: string; website: string; sampleMessage: string;
  providerDetails: string | null; status: string; providerReference: string | null; rejectionReason: string | null;
  reviewedAt: string | null; createdAt: string }
export interface ConsentRecord { id: string; channel: Channel; recipient: string; source: string;
  consentedAt: string; revokedAt: string | null }
export interface Suppression { id: string; channel: Channel; recipient: string; reason: string; createdAt: string }

export interface MessageListItem { id: string; projectId: string | null; projectName?: string | null;
  channel: Channel; recipient: string; sender?: string; status: MessageStatus; segments: number | null;
  quotedMinor: number; chargedMinor: number; templateName?: string | null; errorCode: string | null;
  createdAt: string; lastProviderAt?: string | null; currency?: string }
export interface DeliveryEvent { status: string; occurredAt: string | null; createdAt: string;
  details: Record<string, unknown> }
export interface MessageDetail { id: string; direction: string; channel: Channel; recipient: string; sender: string;
  projectName?: string | null; status: MessageStatus; segments: number | null; quotedMinor: number;
  chargedMinor: number; currency: string; reservationStatus: string; templateName: string | null;
  templateLanguage: string | null; body: string | null; variables: string[]; errorCode: string | null;
  providerPricingType: string | null; providerPricingCategory: string | null; createdAt: string;
  acceptedAt: string | null; lastProviderAt: string | null; events: DeliveryEvent[] }
export interface SendAccepted { id: string; status: string; channel: Channel; recipient: string;
  segments: number | null; estimatedChargeMinor: number; currency: string; acceptedAt: string; note: string }

export interface WebhookEndpoint { id: string; projectId: string; url: string; events: string[];
  active: boolean; createdAt: string }
export interface WebhookAttempt { eventId: string; endpointId: string; attempt: number; httpStatus: number | null;
  error: string | null; createdAt: string }
export interface WebhookEvent { id: string; projectId: string; type: string; messageId: string | null;
  createdAt: string; attempts: WebhookAttempt[] }
export interface WebhookOverview { endpoints: WebhookEndpoint[]; events: WebhookEvent[] }
export interface NewWebhook { endpoint: WebhookEndpoint; secret: string }

export interface WhatsappConnection { id: string; wabaId: string; businessId: string | null; status: string;
  tokenExpiresAt: string | null; lastError: string | null; syncedAt: string | null; createdAt: string }
export interface WhatsappNumber { id: string; connectionId: string; metaPhoneId: string;
  displayPhone: string | null; verifiedName: string | null; quality: string | null; status: string;
  billingConfirmedAt: string | null }
export interface WhatsappTemplate { id: string; connectionId: string; name: string; language: string;
  category: string; body: string; variableCount: number; status: string; rejectionReason: string | null;
  syncedAt: string | null; createdAt?: string }
export interface Conversation { id: string; phoneId: string; recipient: string; lastInboundAt: string | null;
  updatedAt: string }
export interface WhatsappOverview { connections: WhatsappConnection[]; numbers: WhatsappNumber[];
  templates: WhatsappTemplate[]; conversations: Conversation[];
  availability: { configured: boolean; productionApproved: boolean } }
export interface ConversationMessages { conversation: Conversation; messages: {
  id: string; direction: string; status: MessageStatus; body: string | null; templateName: string | null;
  createdAt: string }[] }

export interface Overview { account: AccountSummary; wallet: Wallet;
  today: { messages: number; byStatus: Record<string, number> }; projectCount: number;
  approvedSenderCount: number; activeWebhookCount: number; recent: MessageListItem[]; availability: Availability }

export interface AdminAccount extends AccountSummary { contactEmail: string; intendedUse: string;
  expectedMonthlyVolume: number; termsVersion: string; createdAt: string; updatedAt: string; messageCount: number;
  users: { id: string; accountId: string | null; email: string; role: string; emailVerifiedAt: string | null;
    mfaEnabled: boolean }[] }
export interface AdminOverview { accounts: Record<string, number>; messagesToday: Record<string, number>;
  pendingSenders: number; pendingReconciliation: number; openSupport: number; platformRevenueMinor: number;
  availability: Availability; mfaRequiredForAdmin: boolean }
export interface AdminAccountDetail { account: AdminAccount; users: AdminAccount['users']; projects: Project[];
  payments: PaymentAttempt[]; senders: SenderRequest[] }
export interface AdminSender extends SenderRequest { businessName: string; contactEmail: string }
export interface AdminMessage { id: string; accountId: string; businessName: string; channel: Channel;
  recipient: string; status: MessageStatus; segments: number | null; quotedMinor: number; chargedMinor: number;
  reservationStatus: string; errorCode: string | null; providerMessageId: string | null; createdAt: string;
  lastProviderAt: string | null }
export interface ReconciliationItem { id: string; accountId: string; businessName: string; channel: Channel;
  recipient: string; status: MessageStatus; quotedMinor: number; reservationStatus: string;
  errorCode: string | null; createdAt: string }
export interface AdminSupport { id: string; accountId: string | null; businessName: string | null; email: string;
  subject: string; body: string; status: string; createdAt: string; updatedAt: string }
export interface AuditEvent { id: string; actorUserId: string | null; accountId: string | null; action: string;
  targetType: string | null; targetId: string | null; details: Record<string, unknown>; createdAt: string }
export interface AdminWhatsappConnection extends WhatsappConnection { accountId: string; businessName: string;
  contactEmail: string }
export interface PricingVersion extends PricingItem { providerCostMinor: number | null;
  providerCostCurrency: string | null; providerFeeMinor: number; serviceMarginMinor: number;
  effectiveTo: string | null; createdBy: string | null; createdAt: string }
export interface PlatformSettings { id: number; minimumFundingMinor: number | null; updatedAt: string }

// DevRelay Cloud (hosting) — docs/hosting.md
export interface HostingPlanOption { id: string; label: string; memoryMb: number; cpuMilli: number; priceMinor: number }
export interface HostingAppListItem { id: string; projectId: string; projectName: string | null; name: string;
  slug: string; plan: string; status: string; url: string | null; branch: string; builder: string;
  planExpiresAt: string | null; lastError: string | null; createdAt: string }
export interface HostingDeployment { id: string; ref: string; status: string; error: string | null;
  startedAt: string | null; finishedAt: string | null; createdAt: string }
export interface HostingAppDetail extends HostingAppListItem { containerRef: string | null;
  currentDeploymentId: string | null; repoUrl: string; deployments: HostingDeployment[] }
export interface HostingOverview { available: boolean; plans: HostingPlanOption[]; items: HostingAppListItem[] }

// In-platform domain reselling — docs/domains.md
export interface DomainPricing { tld: string; priceMinor: number }
export interface DomainListItem { id: string; projectId: string; projectName: string | null; name: string;
  tld: string; status: string; autoRenew: boolean; periodYears: number; expiresAt: string | null;
  nameservers: string[] | null; lastWarningLevel: number; lastError: string | null; createdAt: string }
export interface DomainOrderItem { id: string; action: 'register' | 'renew'; amountMinor: number;
  status: string; error: string | null; createdAt: string }
export interface DomainDetail extends DomainListItem { registrant: Record<string, string>;
  providerReference: string | null; orders: DomainOrderItem[] }
export interface DomainsOverview { available: boolean; periodDays: number; graceDays: number;
  pricing: DomainPricing[]; items: DomainListItem[] }
export interface DomainLookup { domain: string; tld: string; available: boolean; priceMinor: number; currency: string }
