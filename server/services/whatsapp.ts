import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { accounts, auditEvents, conversations, messages, whatsappConnections, whatsappNumbers, whatsappTemplates } from '../db/schema.js';
import { availability, config } from '../config.js';
import { ApiError, assert } from '../lib/http.js';
import { decrypt, encrypt } from '../lib/security.js';
import { createTemplate, exchangeSignupCode, listTemplates, registerPhone, templateBody,
  variableCount, verifyAndSubscribe } from '../providers/meta.js';
import { ProviderFailure } from '../providers/types.js';

function ensureConfigured() {
  if (!availability().whatsappTest && !availability().whatsappLive) {
    throw new ApiError(503, 'WHATSAPP_UNAVAILABLE', 'Meta WhatsApp onboarding is not configured. Contact support.');
  }
  if (!config().META_CONFIG_ID) throw new ApiError(503, 'WHATSAPP_UNAVAILABLE', 'Embedded Signup is not configured.');
}

function publicConnection(row: typeof whatsappConnections.$inferSelect) {
  return { id: row.id, wabaId: row.wabaId, businessId: row.businessId, status: row.status,
    tokenExpiresAt: row.tokenExpiresAt, lastError: row.lastError, syncedAt: row.syncedAt, createdAt: row.createdAt };
}

export async function onboardWhatsapp(input: {
  accountId: string; userId: string; code: string; wabaId: string; phoneNumberId: string;
  businessId?: string; pin?: string;
}) {
  ensureConfigured();
  const [existing] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.wabaId, input.wabaId));
  if (existing && existing.accountId !== input.accountId) {
    throw new ApiError(409, 'WABA_IN_USE', 'This WhatsApp Business account is connected to another DevRelay account.');
  }
  let token: string; let expiresIn: number | undefined;
  try {
    const exchanged = await exchangeSignupCode(input.code);
    token = exchanged.access_token; expiresIn = exchanged.expires_in;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'META_SIGNUP_UNCERTAIN', 'Meta signup could not be confirmed. Restart Embedded Signup.');
  }
  let phone;
  try {
    phone = await verifyAndSubscribe(token, input.wabaId, input.phoneNumberId);
  } catch (error) {
    if (error instanceof ProviderFailure) throw new ApiError(502, 'META_SIGNUP_FAILED', 'Meta could not verify the selected WhatsApp assets.');
    throw error;
  }
  if (input.pin) {
    try { await registerPhone(token, input.phoneNumberId, input.pin); }
    catch (error) {
      if (error instanceof ProviderFailure) throw new ApiError(502, 'META_REGISTRATION_FAILED', 'Meta could not register this number. Check the PIN and try again.');
      throw error;
    }
  }
  const result = await db.transaction(async tx => {
    const connectionId = existing?.id ?? randomUUID();
    const tokenEncrypted = encrypt(token, `whatsapp-token:${connectionId}`);
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    let connection: typeof whatsappConnections.$inferSelect;
    if (existing) {
      [connection] = await tx.update(whatsappConnections).set({ tokenEncrypted, tokenExpiresAt,
        businessId: input.businessId ?? existing.businessId, status: existing.status === 'active' ? 'active' : 'pending_activation',
        lastError: null, syncedAt: new Date(), updatedAt: new Date() }).where(eq(whatsappConnections.id, existing.id)).returning() as [typeof whatsappConnections.$inferSelect];
    } else {
      [connection] = await tx.insert(whatsappConnections).values({ id: connectionId, accountId: input.accountId,
        wabaId: input.wabaId, businessId: input.businessId, tokenEncrypted, tokenExpiresAt, status: 'pending_activation' }).returning() as [typeof whatsappConnections.$inferSelect];
    }
    assert(connection, 500, 'WHATSAPP_ERROR', 'Could not save the WhatsApp connection.');
    const [number] = await tx.insert(whatsappNumbers).values({ accountId: input.accountId, connectionId: connection.id,
      metaPhoneId: input.phoneNumberId, displayPhone: phone.display_phone_number ?? null,
      verifiedName: phone.verified_name ?? null, quality: phone.quality_rating ?? null,
      status: existing?.status === 'active' ? 'active' : 'pending_activation' }).onConflictDoUpdate({
      target: whatsappNumbers.metaPhoneId,
      set: { accountId: input.accountId, connectionId: connection.id, displayPhone: phone.display_phone_number ?? null,
        verifiedName: phone.verified_name ?? null, quality: phone.quality_rating ?? null, updatedAt: new Date() },
      setWhere: eq(whatsappNumbers.accountId, input.accountId),
    }).returning();
    assert(number, 409, 'PHONE_IN_USE', 'This WhatsApp number is connected to another DevRelay account.');
    await tx.insert(auditEvents).values({ actorUserId: input.userId, accountId: input.accountId,
      action: 'whatsapp.onboarding_completed', targetType: 'whatsapp_connection', targetId: connection.id,
      details: { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId } });
    return { connection: publicConnection(connection), number: { id: number.id, metaPhoneId: number.metaPhoneId,
      displayPhone: number.displayPhone, verifiedName: number.verifiedName, status: number.status } };
  });
  return { ...result, message: 'WhatsApp assets connected. An administrator must confirm Meta billing before sending is enabled.' };
}

export async function getWhatsapp(accountId: string) {
  const connections = await db.select().from(whatsappConnections).where(eq(whatsappConnections.accountId, accountId))
    .orderBy(desc(whatsappConnections.createdAt));
  const numbers = await db.select({ id: whatsappNumbers.id, connectionId: whatsappNumbers.connectionId,
    metaPhoneId: whatsappNumbers.metaPhoneId, displayPhone: whatsappNumbers.displayPhone, verifiedName: whatsappNumbers.verifiedName,
    quality: whatsappNumbers.quality, status: whatsappNumbers.status, billingConfirmedAt: whatsappNumbers.billingConfirmedAt })
    .from(whatsappNumbers).where(eq(whatsappNumbers.accountId, accountId)).orderBy(desc(whatsappNumbers.createdAt));
  const templates = await db.select({ id: whatsappTemplates.id, connectionId: whatsappTemplates.connectionId,
    name: whatsappTemplates.name, language: whatsappTemplates.language, category: whatsappTemplates.category,
    body: whatsappTemplates.body, variableCount: whatsappTemplates.variableCount, status: whatsappTemplates.status,
    rejectionReason: whatsappTemplates.rejectionReason, syncedAt: whatsappTemplates.syncedAt })
    .from(whatsappTemplates).where(eq(whatsappTemplates.accountId, accountId)).orderBy(desc(whatsappTemplates.updatedAt)).limit(300);
  const recent = await db.select({ id: conversations.id, phoneId: conversations.phoneId,
    recipient: conversations.recipient, lastInboundAt: conversations.lastInboundAt, updatedAt: conversations.updatedAt })
    .from(conversations).where(eq(conversations.accountId, accountId)).orderBy(desc(conversations.updatedAt)).limit(50);
  return { connections: connections.map(publicConnection), numbers, templates, conversations: recent,
    availability: { configured: availability().whatsappTest || availability().whatsappLive,
      productionApproved: availability().whatsappLive } };
}

export async function syncTemplates(accountId: string, userId: string, connectionId?: string) {
  const conditions = [eq(whatsappConnections.accountId, accountId), eq(whatsappConnections.status, 'active')];
  if (connectionId) conditions.push(eq(whatsappConnections.id, connectionId));
  const [connection] = await db.select().from(whatsappConnections).where(and(...conditions));
  assert(connection, 404, 'WHATSAPP_NOT_CONNECTED', 'Activate a WhatsApp connection before syncing templates.');
  const token = decrypt(connection.tokenEncrypted, `whatsapp-token:${connection.id}`);
  let templates;
  try { templates = await listTemplates(token, connection.wabaId); }
  catch (error) {
    if (error instanceof ProviderFailure) throw new ApiError(502, 'META_TEMPLATE_SYNC_FAILED', 'Meta template sync failed. Reconnect WhatsApp or try later.');
    throw error;
  }
  for (const template of templates) {
    const body = templateBody(template);
    await db.insert(whatsappTemplates).values({ accountId, connectionId: connection.id,
      metaTemplateId: template.id ?? null, name: template.name, language: template.language,
      category: template.category.toUpperCase(), body, variableCount: variableCount(body),
      status: template.status.toUpperCase(), rejectionReason: template.rejected_reason ?? null, syncedAt: new Date() })
      .onConflictDoUpdate({ target: [whatsappTemplates.connectionId, whatsappTemplates.name, whatsappTemplates.language],
        set: { metaTemplateId: template.id ?? null, category: template.category.toUpperCase(), body,
          variableCount: variableCount(body), status: template.status.toUpperCase(),
          rejectionReason: template.rejected_reason ?? null, syncedAt: new Date(), updatedAt: new Date() } });
  }
  await db.update(whatsappConnections).set({ syncedAt: new Date(), updatedAt: new Date() }).where(eq(whatsappConnections.id, connection.id));
  await db.insert(auditEvents).values({ actorUserId: userId, accountId, action: 'whatsapp.templates_synced',
    targetType: 'whatsapp_connection', targetId: connection.id, details: { count: templates.length } });
  return { synced: templates.length };
}

export async function submitTemplate(accountId: string, userId: string, connectionId: string, input: {
  name: string; language: string; category: 'MARKETING' | 'UTILITY'; body: string; examples?: string[];
}) {
  const [connection] = await db.select().from(whatsappConnections).where(and(eq(whatsappConnections.id, connectionId),
    eq(whatsappConnections.accountId, accountId), eq(whatsappConnections.status, 'active')));
  assert(connection, 404, 'WHATSAPP_NOT_CONNECTED', 'Activate a WhatsApp connection before submitting templates.');
  const token = decrypt(connection.tokenEncrypted, `whatsapp-token:${connection.id}`);
  let result;
  try { result = await createTemplate(token, connection.wabaId, input); }
  catch (error) {
    if (error instanceof ProviderFailure) throw new ApiError(502, 'META_TEMPLATE_REJECTED', 'Meta did not accept the template. Check its name, body and examples.');
    throw error;
  }
  const body = input.body;
  const [template] = await db.insert(whatsappTemplates).values({ accountId, connectionId,
    metaTemplateId: result.id ?? null, name: input.name, language: input.language, category: input.category,
    body, variableCount: variableCount(body), status: (result.status ?? 'PENDING').toUpperCase(), syncedAt: new Date() })
    .onConflictDoUpdate({ target: [whatsappTemplates.connectionId, whatsappTemplates.name, whatsappTemplates.language],
      set: { metaTemplateId: result.id ?? null, category: input.category, body, variableCount: variableCount(body),
        status: (result.status ?? 'PENDING').toUpperCase(), syncedAt: new Date(), updatedAt: new Date() } }).returning();
  await db.insert(auditEvents).values({ actorUserId: userId, accountId, action: 'whatsapp.template_submitted',
    targetType: 'whatsapp_template', targetId: template!.id, details: { name: input.name, language: input.language } });
  return template;
}

export async function conversationMessages(accountId: string, conversationId: string) {
  const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId),
    eq(conversations.accountId, accountId)));
  assert(conversation, 404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  const rows = await db.select().from(messages).where(and(eq(messages.accountId, accountId),
    eq(messages.recipient, conversation.recipient))).orderBy(desc(messages.createdAt)).limit(100);
  return { conversation, messages: rows.map(row => ({ id: row.id, direction: row.direction, status: row.status,
    body: row.bodyEncrypted ? decrypt(row.bodyEncrypted, `message:${accountId}`) : null, templateName: row.templateName,
    createdAt: row.createdAt })) };
}

export async function activateWhatsappConnection(input: { actorUserId: string; connectionId: string; billingConfirmed: boolean }) {
  if (!input.billingConfirmed) throw new ApiError(400, 'BILLING_CONFIRMATION_REQUIRED', 'Confirm that Meta billing is configured before activation.');
  return db.transaction(async tx => {
    const [connection] = await tx.select().from(whatsappConnections).where(eq(whatsappConnections.id, input.connectionId)).for('update');
    assert(connection, 404, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp connection not found.');
    const [updated] = await tx.update(whatsappConnections).set({ status: 'active', lastError: null, updatedAt: new Date() })
      .where(eq(whatsappConnections.id, connection.id)).returning();
    await tx.update(whatsappNumbers).set({ status: 'active', billingConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappNumbers.connectionId, connection.id));
    await tx.insert(auditEvents).values({ actorUserId: input.actorUserId, accountId: connection.accountId,
      action: 'whatsapp.connection_activated', targetType: 'whatsapp_connection', targetId: connection.id,
      details: { billingConfirmed: true } });
    return updated;
  });
}

export async function setWhatsappConnectionStatus(input: { actorUserId: string; connectionId: string; status: 'suspended' | 'active' }) {
  return db.transaction(async tx => {
    const [connection] = await tx.select().from(whatsappConnections).where(eq(whatsappConnections.id, input.connectionId));
    assert(connection, 404, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp connection not found.');
    if (input.status === 'active') {
      const numbers = await tx.select().from(whatsappNumbers).where(eq(whatsappNumbers.connectionId, connection.id));
      if (!numbers.some(number => number.billingConfirmedAt)) {
        throw new ApiError(400, 'BILLING_CONFIRMATION_REQUIRED', 'Billing must be confirmed before reactivation.');
      }
    }
    const [updated] = await tx.update(whatsappConnections).set({ status: input.status, updatedAt: new Date() })
      .where(eq(whatsappConnections.id, connection.id)).returning();
    await tx.update(whatsappNumbers).set({ status: input.status, updatedAt: new Date() }).where(eq(whatsappNumbers.connectionId, connection.id));
    await tx.insert(auditEvents).values({ actorUserId: input.actorUserId, accountId: connection.accountId,
      action: `whatsapp.connection_${input.status}`, targetType: 'whatsapp_connection', targetId: connection.id });
    return updated;
  });
}

export async function listWhatsappConnections() {
  return db.select({ id: whatsappConnections.id, accountId: whatsappConnections.accountId, wabaId: whatsappConnections.wabaId,
    businessId: whatsappConnections.businessId, status: whatsappConnections.status, tokenExpiresAt: whatsappConnections.tokenExpiresAt,
    lastError: whatsappConnections.lastError, createdAt: whatsappConnections.createdAt,
    businessName: accounts.businessName, contactEmail: accounts.contactEmail })
    .from(whatsappConnections).innerJoin(accounts, eq(accounts.id, whatsappConnections.accountId))
    .orderBy(desc(whatsappConnections.createdAt));
}
