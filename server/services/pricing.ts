import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { SegmentedMessage } from 'sms-segments-calculator';
import { db } from '../db/client.js';
import { pricingVersions } from '../db/schema.js';
import { ApiError } from '../lib/http.js';

export function normalizePhone(input: string, smsOnlyGhana = false) {
  const phone = parsePhoneNumberFromString(input, 'GH');
  if (!phone?.isValid() || !phone.country) throw new ApiError(400, 'INVALID_RECIPIENT', 'Enter a valid phone number including country code.');
  if (smsOnlyGhana && phone.country !== 'GH') throw new ApiError(400, 'UNSUPPORTED_DESTINATION', 'SMS currently supports Ghana numbers only.');
  return { e164: phone.number, country: phone.country };
}

export function smsSegments(body: string) {
  if (!body.trim() || body.length > 1600) throw new ApiError(400, 'INVALID_MESSAGE', 'SMS body must contain 1–1600 characters.');
  const segmented = new SegmentedMessage(body);
  if (!Number.isInteger(segmented.segmentsCount) || segmented.segmentsCount < 1 || segmented.segmentsCount > 12) {
    throw new ApiError(400, 'MESSAGE_TOO_LONG', 'SMS exceeds 12 billable segments.');
  }
  return { count: segmented.segmentsCount, encoding: segmented.encodingName };
}

export async function currentPrice(
  input: { channel: 'sms' | 'whatsapp'; country: string; route: string; category: string; now?: Date },
  exec: Pick<typeof db, 'select'> = db,
) {
  const now = input.now ?? new Date();
  const [price] = await exec.select().from(pricingVersions).where(and(
    eq(pricingVersions.channel, input.channel), eq(pricingVersions.country, input.country),
    eq(pricingVersions.route, input.route), eq(pricingVersions.category, input.category),
    lte(pricingVersions.effectiveFrom, now), or(isNull(pricingVersions.effectiveTo), gt(pricingVersions.effectiveTo, now)),
  )).orderBy(desc(pricingVersions.effectiveFrom)).limit(1);
  if (!price) throw new ApiError(503, 'PRICE_UNAVAILABLE', 'Pricing is not yet available for this route and category. Contact support.');
  return price;
}

export function quoteMinor(unitMinor: number, units: number) {
  const total = unitMinor * units;
  if (!Number.isSafeInteger(total) || total < 1) throw new ApiError(503, 'PRICE_UNAVAILABLE', 'A valid price cannot be calculated.');
  return total;
}
