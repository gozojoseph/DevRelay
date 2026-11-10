import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consentRecords, messages, senderRequests, suppressions, whatsappConnections,
  whatsappNumbers } from '../db/schema.js';
import { config } from '../config.js';
import { africasTalking } from '../providers/africastalking.js';
import { aigh } from '../providers/aigh.js';
import { simGateway } from '../providers/sim-gateway.js';
import { arkesel } from '../providers/arkesel.js';
import { metaCloud } from '../providers/meta.js';
import { ProviderFailure, type SmsAdapter } from '../providers/types.js';
import { decrypt } from '../lib/security.js';
import { settleReservation } from './ledger.js';
import { markAccepted, markFailedWithoutCharge, markPendingReconciliation, markRetryable } from './status.js';
import { deliverWebhook } from './webhooks.js';
import { reconcilePayment } from './payments.js';
import { processAppAction, processAppDeploy, renewDueHostingApps } from './hosting.js';
import { processDomainRegister, processDomainRenew, renewDueDomains } from './domains.js';
import { processGatewayCallback, processMetaEvent, processAtCallback } from './events.js';

/** One selected SMS rail for the whole worker (config choice, not per-message). */
function smsAdapter(): SmsAdapter {
  const provider = config().SMS_PROVIDER;
  return provider === 'aigh' ? aigh : provider === 'sim-gateway' ? simGateway
    : provider === 'arkesel' ? arkesel : africasTalking;
}

async function beginDispatch(messageId: string) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
    if (!message) return { state: 'missing' as const };
    if (message.status !== 'queued') return { state: message.status === 'sending' ? 'ambiguous' as const : 'skipped' as const, message };
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, message.accountId));
    if (!account || account.status !== 'active') {
      await settleReservation(tx, message, false);
      await tx.update(messages).set({ status: 'failed', errorCode: 'ACCOUNT_SUSPENDED', updatedAt: new Date() }).where(eq(messages.id, message.id));
      return { state: 'blocked' as const };
    }
    const [suppressed] = await tx.select().from(suppressions).where(and(eq(suppressions.accountId, message.accountId),
      eq(suppressions.channel, message.channel), eq(suppressions.recipient, message.recipient)));
    const [consent] = await tx.select().from(consentRecords).where(and(eq(consentRecords.accountId, message.accountId),
      eq(consentRecords.channel, message.channel), eq(consentRecords.recipient, message.recipient)));
    if (suppressed || !consent || consent.revokedAt) {
      await settleReservation(tx, message, false);
      await tx.update(messages).set({ status: 'failed', errorCode: suppressed ? 'RECIPIENT_SUPPRESSED' : 'CONSENT_REVOKED',
        updatedAt: new Date() }).where(eq(messages.id, message.id));
      return { state: 'blocked' as const };
    }
    const [updated] = await tx.update(messages).set({ status: 'sending', updatedAt: new Date() }).where(eq(messages.id, message.id)).returning();
    return { state: 'send' as const, message: updated! };
  });
}

export async function processSmsSend(messageId: string) {
  const dispatch = await beginDispatch(messageId);
  if (dispatch.state === 'ambiguous') {
    await markPendingReconciliation(messageId, 'SEND_STATE_UNCERTAIN');
    return { done: true, ambiguous: true };
  }
  if (dispatch.state !== 'send') return { done: true };
  const message = dispatch.message;
  const [sender] = await db.select().from(senderRequests).where(and(eq(senderRequests.accountId, message.accountId),
    eq(senderRequests.senderId, message.sender), eq(senderRequests.status, 'approved')));
  if (!sender) {
    await markFailedWithoutCharge(message.id, 'SENDER_NOT_APPROVED');
    return { done: true };
  }
  const body = message.bodyEncrypted ? decrypt(message.bodyEncrypted, `message:${message.accountId}`) : '';
  try {
    const result = await smsAdapter().send({ recipient: message.recipient, sender: message.sender, body });
    await markAccepted({ messageId: message.id, providerMessageId: result.id,
      supplierCostMinor: result.supplierCostMinor, supplierCurrency: result.supplierCurrency });
    return { done: true };
  } catch (error) {
    if (!(error instanceof ProviderFailure)) {
      await markPendingReconciliation(message.id, 'SEND_RESULT_UNCERTAIN');
      return { done: true, ambiguous: true };
    }
    if (error.kind === 'ambiguous') {
      await markPendingReconciliation(message.id, error.publicCode);
      return { done: true, ambiguous: true };
    }
    if (error.kind === 'retryable') {
      // A definite HTTP response (for example 429) means no provider acceptance.
      await markRetryable(message.id);
      return { done: false, retry: true, code: error.publicCode };
    }
    await markFailedWithoutCharge(message.id, error.publicCode);
    return { done: true };
  }
}

export async function processWhatsappSend(messageId: string) {
  const dispatch = await beginDispatch(messageId);
  if (dispatch.state === 'ambiguous') {
    await markPendingReconciliation(messageId, 'SEND_STATE_UNCERTAIN');
    return { done: true, ambiguous: true };
  }
  if (dispatch.state !== 'send') return { done: true };
  const message = dispatch.message;
  const [row] = await db.select({ message: messages, connection: whatsappConnections, number: whatsappNumbers })
    .from(messages)
    .innerJoin(whatsappNumbers, eq(whatsappNumbers.id, messages.whatsappPhoneId))
    .innerJoin(whatsappConnections, eq(whatsappConnections.id, whatsappNumbers.connectionId))
    .where(and(eq(messages.id, message.id), eq(whatsappConnections.status, 'active'),
      eq(whatsappConnections.accountId, message.accountId), eq(whatsappNumbers.status, 'active')));
  if (!row) {
    await markFailedWithoutCharge(message.id, 'WHATSAPP_CONNECTION_UNAVAILABLE');
    return { done: true };
  }
  let body: string | undefined;
  let variables: string[] = [];
  try {
    body = message.bodyEncrypted ? decrypt(message.bodyEncrypted, `message:${message.accountId}`) : undefined;
    variables = message.variablesEncrypted ? JSON.parse(decrypt(message.variablesEncrypted, `message:${message.accountId}`)) as string[] : [];
    const token = decrypt(row.connection.tokenEncrypted, `whatsapp-token:${row.connection.id}`);
    const result = await metaCloud.send({ phoneId: row.number.metaPhoneId,
      recipient: message.recipient, body, token, messageId: message.id,
      template: message.templateName && message.templateLanguage ? { name: message.templateName, language: message.templateLanguage, variables } : undefined });
    await markAccepted({ messageId: message.id, providerMessageId: result.id });
    return { done: true };
  } catch (error) {
    if (error instanceof ProviderFailure && error.kind === 'retryable') {
      await markRetryable(message.id);
      return { done: false, retry: true, code: error.publicCode };
    }
    if (error instanceof ProviderFailure && error.kind === 'rejected') {
      await markFailedWithoutCharge(message.id, error.publicCode);
      return { done: true };
    }
    await markPendingReconciliation(message.id, error instanceof ProviderFailure ? error.publicCode : 'SEND_RESULT_UNCERTAIN');
    return { done: true, ambiguous: true };
  }
}

export async function processJob(job: { kind: string; payload: Record<string, unknown>; attempts: number; id: string }) {
  switch (job.kind) {
    case 'sms.send': return processSmsSend(String(job.payload.messageId));
    case 'whatsapp.send': return processWhatsappSend(String(job.payload.messageId));
    case 'webhook.deliver': {
      await deliverWebhook({ eventId: String(job.payload.eventId), endpointId: String(job.payload.endpointId), attempt: job.attempts });
      return { done: true };
    }
    case 'payment.reconcile': {
      await reconcilePayment(String(job.payload.reference));
      return { done: true };
    }
    case 'meta.webhook': return processMetaEvent(String(job.payload.eventId));
    case 'at.callback': return processAtCallback(String(job.payload.eventId));
    case 'gateway.callback': return processGatewayCallback(String(job.payload.eventId));
    case 'app.deploy': return processAppDeploy(String(job.payload.deploymentId));
    case 'app.stop': return processAppAction(String(job.payload.appId), 'stop');
    case 'app.start': return processAppAction(String(job.payload.appId), 'start');
    case 'app.delete': return processAppAction(String(job.payload.appId), 'delete');
    case 'hosting.renew': return renewDueHostingApps();
    case 'domain.register': return processDomainRegister(String(job.payload.orderId));
    case 'domain.renew': return processDomainRenew(String(job.payload.orderId));
    case 'domains.sweep': return renewDueDomains();
    default: return { done: false, dead: true, code: 'UNKNOWN_JOB_KIND' };
  }
}
