import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Building2, MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { Button, Callout, Field, Select, TextArea, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

const volumes = [100, 500, 1000, 5000, 10000, 50000, 100000];

export function RegisterPage() {
  usePageTitle('Create an account');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [intendedUse, setIntendedUse] = useState('');
  const [volume, setVolume] = useState('1000');
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api('/auth/register', { method: 'POST', body: { businessName: businessName.trim(), email: email.trim(),
        contactEmail: (contactEmail.trim() || email.trim()), password, country: 'GH', intendedUse: intendedUse.trim(),
        expectedMonthlyVolume: Number(volume), acceptTerms: true } });
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  if (done) {
    return (
      <AuthShell title="Check your email" description={`We sent a verification link to ${email}. Verify it, then an administrator can review the account.`}>
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <MailCheck className="mx-auto h-10 w-10 text-brand-600" />
          <h2 className="mt-3 text-base font-semibold text-ink">Verification required</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Verification links expire after 24 hours. If the message does not arrive, request a new link from the sign-in page. Email delivery must be configured by the operator; the UI never pretends an email was sent when the server rejects it.</p>
          <Link to="/login" className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Create a business account" description="Registration is free. You must verify your email and be approved before funding, sending or connecting WhatsApp."
      footer={<p>Already registered? <Link to="/login" className="link">Sign in</Link></p>}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Field label="Business name" htmlFor="register-business" required>
          <TextInput id="register-business" required minLength={2} maxLength={160} autoComplete="organization" value={businessName} onChange={event => setBusinessName(event.target.value)} placeholder="Example Trading Ltd" />
        </Field>
        <Field label="Owner email" htmlFor="register-email" required hint="Used to sign in and verify the account.">
          <TextInput id="register-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="owner@company.com" />
        </Field>
        <Field label="Billing contact email" htmlFor="register-contact" hint="Optional. Defaults to the owner email.">
          <TextInput id="register-contact" type="email" autoComplete="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} placeholder="billing@company.com" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" htmlFor="register-password" required hint="At least 12 characters.">
            <TextInput id="register-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirm password" htmlFor="register-confirm" required>
            <TextInput id="register-confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
          </Field>
        </div>
        <Field label="What will you send?" htmlFor="register-use" required hint="15–1500 characters. Be specific: use cases, audience and how consent is collected.">
          <TextArea id="register-use" required minLength={15} maxLength={1500} rows={4} value={intendedUse} onChange={event => setIntendedUse(event.target.value)} placeholder="Order pickup alerts and appointment reminders for customers who opt in at checkout." />
        </Field>
        <Field label="Expected monthly messages" htmlFor="register-volume" required>
          <Select id="register-volume" value={volume} onChange={event => setVolume(event.target.value)}>
            {volumes.map(value => <option key={value} value={value}>{value.toLocaleString('en-GH')} messages / month</option>)}
          </Select>
        </Field>
        <label className="flex items-start gap-2.5 text-xs leading-5 text-muted">
          <input type="checkbox" checked={accept} onChange={event => setAccept(event.target.checked)} required
            className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500" />
          <span>I accept the <Link to="/terms" className="link">terms</Link>, <Link to="/privacy" className="link">privacy notice</Link> and <Link to="/acceptable-use" className="link">acceptable use policy</Link>. I will only message recipients with lawful consent.</span>
        </label>
        <Button type="submit" loading={loading} disabled={!accept} className="w-full"><Building2 className="h-4 w-4" /> Create account</Button>
      </form>
    </AuthShell>
  );
}
