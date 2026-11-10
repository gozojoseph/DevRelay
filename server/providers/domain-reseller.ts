import { ProviderFailure } from './types.js';

// Domain reseller adapter (docs/domains.md): DevRelay registers and renews
// customer domains through a reseller API (HostAfrica verified as supplier).
//
// SEAM STUB — do not "implement" from guesses. The reseller contract (base
// endpoint URL, the per-request token derivation from API key + email + the
// current UTC hour, request/response shapes for lookup/register/renew) is
// documented only behind the reseller login. Until the user pastes those docs,
// every method must refuse and the feature must report unavailable — env vars
// alone NEVER make domains available (honest-only posture).

/** Registrant contact required by registrars; shape per docs/domains.md. */
export interface DomainRegistrant {
  firstName: string; lastName: string; email: string; phone: string;
  country: string; // ISO 3166-1 alpha-2, e.g. GH
  city: string; addressLine: string;
  organisation?: string;
}

export interface DomainRegisterInput {
  domain: string; periodYears: number; registrant: DomainRegistrant;
}

export interface DomainActionResult {
  providerReference: string;
}

export interface DomainResellerAdapter {
  /** Registry availability. Ambiguous answers surface as ProviderFailure, never a guessed boolean. */
  lookup(domain: string): Promise<{ available: boolean }>;
  register(input: DomainRegisterInput): Promise<DomainActionResult>;
  renew(input: { domain: string; providerReference?: string; currentExpiry: Date; periodYears: number }): Promise<DomainActionResult>;
}

export class ProviderNotConfiguredError extends ProviderFailure {
  constructor() { super('rejected', 'DOMAIN_RESELLER_NOT_CONFIGURED'); }
}

/**
 * Readiness flag consumed by config availability(). The stub is never ready;
 * the real adapter returns true only when its documented env credentials are
 * set. This keeps `domainsAvailable` honest during the seam-first phase.
 */
export function domainResellerReady(): boolean {
  return false;
}

function refuse(): never {
  throw new ProviderNotConfiguredError();
}

export const unconfiguredDomainReseller: DomainResellerAdapter = {
  async lookup() { return refuse(); },
  async register() { return refuse(); },
  async renew() { return refuse(); },
};

/** The wired adapter. Swapping in the real one is a one-line change here. */
export const domainReseller: DomainResellerAdapter = unconfiguredDomainReseller;
