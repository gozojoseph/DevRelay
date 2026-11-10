import { Router } from 'express';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { platformSettings, pricingVersions, supportRequests, rateCounters } from '../db/schema.js';
import { availability, config, neonAvailability } from '../config.js';
import { ApiError, ok } from '../lib/http.js';
import { sha256 } from '../lib/security.js';

export const publicRouter = Router();

async function publicSettings() {
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
  return settings;
}

publicRouter.get('/config', async (req, res) => {
  const c = config();
  const settings = await publicSettings();
  const flags = availability();
  ok(req, res, {
    name: 'DevRelay', currency: 'GHS', country: 'GH',
    publicApiUrl: c.PUBLIC_API_URL,
    supportEmail: c.SUPPORT_EMAIL ?? null,
    minimumFundingMinor: settings?.minimumFundingMinor ?? null,
    fundingAvailable: flags.paystack && Boolean(settings?.minimumFundingMinor),
    smsAvailable: flags.sms,
    hostingAvailable: flags.hosting,
    domainsAvailable: flags.domains,
    whatsappAvailable: flags.whatsappTest || flags.whatsappLive,
    whatsappProductionApproved: flags.whatsappLive,
    metaAppId: flags.whatsappTest || flags.whatsappLive ? c.META_APP_ID ?? null : null,
    metaConfigId: flags.whatsappTest || flags.whatsappLive ? c.META_CONFIG_ID ?? null : null,
    metaGraphVersion: c.META_GRAPH_VERSION,
    environment: c.NODE_ENV,
    pricingConfigured: (await db.select({ id: pricingVersions.id }).from(pricingVersions).where(and(
      lte(pricingVersions.effectiveFrom, new Date()), or(isNull(pricingVersions.effectiveTo), gt(pricingVersions.effectiveTo, new Date())))).limit(1)).length > 0,
  });
});

publicRouter.get('/pricing', async (req, res) => {
  const now = new Date();
  const rows = await db.select({ id: pricingVersions.id, channel: pricingVersions.channel,
    country: pricingVersions.country, route: pricingVersions.route, category: pricingVersions.category,
    customerUnitMinor: pricingVersions.customerUnitMinor, effectiveFrom: pricingVersions.effectiveFrom })
    .from(pricingVersions).where(and(lte(pricingVersions.effectiveFrom, now),
      or(isNull(pricingVersions.effectiveTo), gt(pricingVersions.effectiveTo, now))))
    .orderBy(pricingVersions.channel, pricingVersions.category);
  const settings = await publicSettings();
  ok(req, res, { currency: 'GHS', unit: 'pesewas', items: rows, minimumFundingMinor: settings?.minimumFundingMinor ?? null,
    note: 'Prices are charged per SMS segment or per WhatsApp message as configured. No prices are invented when none are published.' });
});

publicRouter.get('/status', async (req, res) => {
  const flags = availability();
  const settings = await publicSettings();
  ok(req, res, { channels: { sms: flags.sms, whatsapp: flags.whatsappTest || flags.whatsappLive,
    funding: flags.paystack && Boolean(settings?.minimumFundingMinor) },
  whatsappMode: flags.whatsappLive ? 'production' : flags.whatsappTest ? 'test' : 'unavailable',
  neon: neonAvailability(),
  note: 'This reports server configuration only, not upstream live delivery health.' });
});

publicRouter.post('/support', async (req, res) => {
  const input = z.object({ email: z.email().max(254), subject: z.string().trim().min(3).max(160),
    body: z.string().trim().min(20).max(4000) }).parse(req.body);
  const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
  const key = sha256(`support:${req.ip ?? 'unknown'}`);
  const [entry] = await db.insert(rateCounters).values({ key, minute, count: 1 })
    .onConflictDoUpdate({ target: [rateCounters.key, rateCounters.minute], set: { count: sql`${rateCounters.count} + 1` } }).returning();
  if (entry && entry.count > 3) throw new ApiError(429, 'RATE_LIMITED', 'Too many support requests. Try again in a minute.');
  const [row] = await db.insert(supportRequests).values({ email: input.email.toLowerCase(), subject: input.subject, body: input.body }).returning();
  ok(req, res, { id: row!.id, message: 'Your request has been recorded. Support will reply by email.' }, 201);
});
