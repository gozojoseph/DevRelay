import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb } from './helpers/db.js';
import { seedSmsPrice, seedWhatsappPrice } from './helpers/seed.js';

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { currentPrice } from '../server/services/pricing.js';
import { pricingVersions } from '../server/db/schema.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => resetTestDb());
afterAll(closeTestDb);

const DAY = 86_400_000;

describe('currentPrice', () => {
  it('uses the newest effective version for a route and category', async () => {
    const db = getTestDb();
    await db.insert(pricingVersions).values({
      channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional',
      customerUnitMinor: 12, effectiveFrom: new Date(Date.now() - 7 * DAY),
    });
    const newer = await seedSmsPrice(db, 20);
    const price = await currentPrice({ channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional' });
    expect(price.id).toBe(newer.id);
    expect(price.customerUnitMinor).toBe(20);
  });

  it('ignores versions whose effectiveTo window has closed', async () => {
    const db = getTestDb();
    await db.insert(pricingVersions).values({
      channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional',
      customerUnitMinor: 99, effectiveFrom: new Date(Date.now() - 7 * DAY), effectiveTo: new Date(Date.now() - DAY),
    });
    const old = await seedSmsPrice(db, 15, { daysAgo: 10 });
    const price = await currentPrice({ channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional' });
    expect(price.id).toBe(old.id);
    expect(price.customerUnitMinor).toBe(15);
  });

  it('fails with PRICE_UNAVAILABLE when nothing is published', async () => {
    await expect(currentPrice({ channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional' }))
      .rejects.toMatchObject({ status: 503, code: 'PRICE_UNAVAILABLE' });
    await expect(currentPrice({ channel: 'whatsapp', country: 'GB', route: 'meta_cloud', category: 'marketing' }))
      .rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });

  it('matches strictly on channel, country, route and category', async () => {
    const db = getTestDb();
    const sms = await seedSmsPrice(db, 20);
    const whatsapp = await seedWhatsappPrice(db, 'marketing', 150);

    expect((await currentPrice({ channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional' })).id).toBe(sms.id);
    expect((await currentPrice({ channel: 'whatsapp', country: 'GH', route: 'meta_cloud', category: 'marketing' })).id).toBe(whatsapp.id);

    await expect(currentPrice({ channel: 'whatsapp', country: 'GH', route: 'meta_cloud', category: 'service' }))
      .rejects.toMatchObject({ code: 'PRICE_UNAVAILABLE' });
  });
});
