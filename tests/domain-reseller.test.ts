import { describe, expect, it } from 'vitest';

// The domain reseller adapter is a SEAM STUB until the user pastes the
// documented reseller contract. These tests pin its honesty: it is never
// ready, every method refuses definitely, and nothing can be tricked into a
// guessed answer.
const { domainReseller, domainResellerReady, unconfiguredDomainReseller } =
  await import('../server/providers/domain-reseller.js');

describe('domain reseller stub', () => {
  it('is never ready while the real contract is missing', () => {
    expect(domainResellerReady()).toBe(false);
    expect(domainReseller).toBe(unconfiguredDomainReseller);
  });

  it('refuses lookups, registrations and renewals with a definite not-configured failure', async () => {
    const registrant = {
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.test', phone: '+233244000000',
      country: 'GH', city: 'Accra', addressLine: '12 Test Street',
    };
    await expect(domainReseller.lookup('example.com'))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
    await expect(domainReseller.register({ domain: 'example.com', periodYears: 1, registrant }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
    await expect(domainReseller.renew({ domain: 'example.com', currentExpiry: new Date(), periodYears: 1 }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
  });
});
