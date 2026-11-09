import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ShieldAlert } from 'lucide-react';
import { usePageTitle } from '../../lib/hooks';
import { Callout, PageHeader } from '../../components/ui';

type Kind = 'terms' | 'privacy' | 'acceptable';

const meta: Record<Kind, { title: string; eyebrow: string; intro: string }> = {
  terms: {
    title: 'Terms of service',
    eyebrow: 'Legal · Draft',
    intro: 'These draft terms describe how a business may use DevRelay’s messaging dashboard and API. They require review by qualified Ghanaian counsel and completion of operator identity details before publication.',
  },
  privacy: {
    title: 'Privacy notice',
    eyebrow: 'Legal · Draft',
    intro: 'This draft explains what personal data DevRelay processes to provide messaging infrastructure, why it is processed, and the choices available to account holders and message recipients.',
  },
  acceptable: {
    title: 'Acceptable use policy',
    eyebrow: 'Legal · Draft',
    intro: 'Messaging can cause real harm when misused. This policy sets minimum expectations for consent, content and provider compliance. It applies to every account, project and API key.',
  },
};

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-lg font-semibold tracking-tight text-ink first:mt-0">{children}</h2>;
}

function Terms() {
  return (
    <>
      <H2>1. Who may use the service</H2>
      <p>You may use DevRelay only for a lawful business purpose and only if you can enter a binding contract. You must provide accurate business, contact and intended-use information, verify the owner email, and obtain administrator approval before funding or sending. We may refuse or suspend an account where identity, sender ownership or intended use cannot be verified.</p>
      <H2>2. Accounts and security</H2>
      <p>You are responsible for activity under your account, projects and API keys. Keep credentials confidential, use scoped keys, rotate keys after suspected exposure, and notify support promptly. Administrator accounts require multi-factor authentication. We may invalidate sessions after sensitive changes.</p>
      <H2>3. Prepaid credits</H2>
      <p>Messaging is prepaid in Ghanaian cedi credits. Funds are credited only after server-side verification with Paystack. Credits are not a bank deposit, do not earn interest and are not transferable except as required by law. Amounts are held as integer pesewas in a double-entry ledger. Where required, refunds of unused credit are handled by support after identity checks and deduction of non-refundable provider costs.</p>
      <H2>4. Prices, reservations and delivery</H2>
      <p>The price book published in the dashboard applies at the time a message is accepted. Credits are reserved when a message is queued and settled or released based on provider evidence. A queued or accepted response is not proof of delivery. If an upstream outcome is uncertain, the reservation remains pending until an operator reconciles it. We do not guarantee delivery, latency or a specific upstream provider.</p>
      <H2>5. Sender identities and WhatsApp</H2>
      <p>SMS sender IDs must be registered and approved by the upstream operator. You must have authority to use any brand name you submit. WhatsApp use is additionally governed by Meta’s terms and policies, including template approval, messaging limits and the 24-hour customer service window. DevRelay may keep WhatsApp connections inactive until Meta billing is confirmed.</p>
      <H2>6. Acceptable use</H2>
      <p>You must comply with the <Link to="/acceptable-use" className="link">acceptable use policy</Link>, applicable law and provider rules. We may investigate complaints, throttle or suspend traffic, remove sender IDs and preserve evidence where abuse is suspected.</p>
      <H2>7. Availability and changes</H2>
      <p>The service depends on third-party networks and may be interrupted. We may change features, limits or prices with notice where practicable. Material changes to these terms will be published on this page; continued use after the effective date means acceptance.</p>
      <H2>8. Liability</H2>
      <p>To the maximum extent permitted by Ghanaian law, DevRelay is not liable for indirect or consequential loss, lost profits, or loss caused by inaccurate recipient data, provider outages, or content you choose to send. Nothing in these terms excludes liability that cannot lawfully be excluded.</p>
      <H2>9. Suspension and termination</H2>
      <p>You may stop using the service at any time. We may suspend or terminate access for non-payment, failed verification, policy violations, legal requirements or security risk. On termination, we retain records for the periods described in the privacy notice and handle any remaining credit according to applicable law.</p>
      <H2>10. Contact</H2>
      <p>Questions about these terms can be submitted through <Link to="/support" className="link">support</Link>. Operator legal identity, registered address and regulatory details must be inserted before these terms are finalized.</p>
      <Callout tone="danger" title="Draft status">This document is a product draft, not legal advice. It must be reviewed and completed by qualified counsel before launch.</Callout>
    </>
  );
}

function Privacy() {
  return (
    <>
      <H2>1. Controller and scope</H2>
      <p>This notice covers account-holder data and personal data contained in messages processed through DevRelay. The operating entity’s legal name, address and Data Protection Commission registration details must be completed before publication. Account holders are responsible for their own notices and lawful basis for contacting recipients.</p>
      <H2>2. Data we collect</H2>
      <ul>
        <li><strong>Account data:</strong> business name, contact email, login email, password hash, country, intended use, expected volume, approval notes and session records.</li>
        <li><strong>Billing data:</strong> Paystack references, amounts, currency, payment status and ledger entries. Card data is handled by Paystack, not stored by DevRelay.</li>
        <li><strong>Messaging data:</strong> sender and recipient numbers, message content and template variables (encrypted at rest), provider identifiers, delivery events and error codes.</li>
        <li><strong>Consent and suppression data:</strong> recipient number, channel, consent source and time, opt-out reason and time.</li>
        <li><strong>Technical data:</strong> API key identifiers, IP-derived rate-limit counters, request IDs, audit events and support correspondence.</li>
      </ul>
      <H2>3. Why we process it</H2>
      <p>We process data to create and secure accounts, verify identity, approve sending, route messages, settle prepaid charges, provide delivery evidence, prevent abuse, respond to support requests, comply with law and maintain business records. Depending on the context, processing is based on contract performance, legal obligation, legitimate interests in security and fraud prevention, or consent. You must not rely on this notice as your own legal basis for marketing messages.</p>
      <H2>4. Sharing</H2>
      <p>We share the minimum necessary data with infrastructure and provider partners, which may include Paystack for funding, Africa’s Talking for SMS delivery, Meta for WhatsApp services, hosting and email providers. These providers process data under their own terms. We may disclose data where required by law, to investigate abuse, or during a corporate transaction with appropriate safeguards. We do not sell personal data.</p>
      <H2>5. International transfers</H2>
      <p>Some providers process data outside Ghana. Before production launch, the operator must document an appropriate transfer mechanism and update this section with the relevant safeguards and destinations.</p>
      <H2>6. Retention</H2>
      <p>Operational records are retained for as long as needed to provide the service and meet legal, tax and dispute obligations. Raw provider webhook payloads are retained for a limited period and then removed by the retention job. Message content, payment records and audit events may be retained longer where required by law or an active investigation.</p>
      <H2>7. Security</H2>
      <p>DevRelay uses HTTP-only sessions, CSRF protection, hashed passwords, hashed API keys, TOTP for administrators, encrypted provider tokens and message content, tenant-scoped queries, signed webhooks and rate limits. No system is perfectly secure; report suspected incidents through support promptly.</p>
      <H2>8. Your choices and rights</H2>
      <p>Depending on applicable law, individuals may request access, correction, deletion, restriction or objection, and may withdraw consent where consent is the basis. Account holders can update consent records and record opt-outs in the dashboard. Recipients can ask the sending business to stop messages; DevRelay support can assist with suppression where appropriate. You may also complain to the Ghana Data Protection Commission.</p>
      <H2>9. Contact</H2>
      <p>Privacy questions can be submitted through <Link to="/support" className="link">support</Link>. The final notice must include the operator’s registered identity, privacy contact and DPC registration status.</p>
      <Callout tone="danger" title="Draft status">This is a product draft. It is not a substitute for a Data Protection Impact Assessment, a records-of-processing register, or legal review of Ghanaian data-protection requirements.</Callout>
    </>
  );
}

function Acceptable() {
  return (
    <>
      <H2>1. Consent comes first</H2>
      <p>You may send marketing or informational messages only to recipients who gave valid, documented consent for that sender and channel, unless a narrow legal exception applies. Consent must be recorded in the dashboard before sending. Opt-outs must be honoured immediately and are enforced by a suppression list. Purchased, scraped or rented lists are prohibited.</p>
      <H2>2. Prohibited content and conduct</H2>
      <ul>
        <li>Fraud, phishing, impersonation, unauthorised financial promotions or attempts to obtain credentials or payment details.</li>
        <li>Illegal goods or services, unlicensed financial or medical claims, gambling where not permitted, or adult content sent without lawful controls.</li>
        <li>Harassment, hate speech, threats, exploitation, or content that endangers a person.</li>
        <li>Malware, deceptive links, spoofed sender identities or attempts to bypass provider review.</li>
        <li>Using the service to evade sanctions, law-enforcement requests or provider restrictions.</li>
      </ul>
      <H2>3. Sender IDs</H2>
      <p>Only request sender IDs you are authorised to use. Do not use a brand you do not own or represent. Keep samples and website details accurate. An approved sender ID may be withdrawn if ownership, complaints or traffic patterns raise concerns.</p>
      <H2>4. WhatsApp rules</H2>
      <p>WhatsApp traffic must comply with Meta’s Business Messaging Policy and Commerce Policy. Use approved templates for messages outside the customer service window, do not send prohibited categories, and respect template pause or quality restrictions. Connecting a WhatsApp Business account does not override Meta’s own enforcement.</p>
      <H2>5. Monitoring and enforcement</H2>
      <p>We may review sender requests, consent evidence, delivery patterns and abuse reports. We may throttle, suspend or terminate accounts, disable keys, block destinations or preserve records for investigation. Where legally required, we may report suspected unlawful activity.</p>
      <H2>6. Report abuse</H2>
      <p>If you receive unwanted or deceptive messages, contact the sending business and our support team with the sender ID, recipient number and approximate time. Do not forward sensitive personal data that is not needed to investigate.</p>
      <Callout tone="danger" title="Draft status">This policy is a product draft and must be aligned with final provider contracts and Ghanaian legal review before launch.</Callout>
    </>
  );
}

export function LegalPage({ kind }: { kind: Kind }) {
  usePageTitle(meta[kind].title);
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={meta[kind].eyebrow} title={meta[kind].title} description={meta[kind].intro} />
        <div className="mb-8 flex items-center gap-2 rounded-xl border border-line bg-elevated px-4 py-3 text-xs text-muted">
          <FileText className="h-4 w-4 shrink-0" /> Last updated: 5 November 2026 · Version 2026-11-draft
        </div>
        <div className="prose-docs">
          {kind === 'terms' ? <Terms /> : kind === 'privacy' ? <Privacy /> : <Acceptable />}
        </div>
        <div className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6 text-xs">
          <Link to="/terms" className="link">Terms</Link><span className="text-muted">·</span>
          <Link to="/privacy" className="link">Privacy</Link><span className="text-muted">·</span>
          <Link to="/acceptable-use" className="link">Acceptable use</Link>
        </div>
        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Policies are published as drafts while external legal, regulatory and provider approvals are completed.</p>
      </div>
    </div>
  );
}
