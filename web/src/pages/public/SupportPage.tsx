import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, LifeBuoy, Mail, MessageSquareText } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import type { PublicConfig } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { Button, Callout, Field, PageHeader, Panel, TextArea, TextInput } from '../../components/ui';

export function SupportPage() {
  usePageTitle('Support');
  const config = useApi<PublicConfig>('/public/config');
  const { me } = useAuth();
  const [email, setEmail] = useState(me?.user.email ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      await api<{ id: string }>('/public/support', { method: 'POST', body: { email, subject, body } });
      setDone(true); setSubject(''); setBody('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="container-page py-12 sm:py-16">
      <PageHeader eyebrow="Support" title="Talk to a human"
        description="Ask about onboarding, sender approval, delivery reconciliation, WhatsApp setup or account security. Never send full API keys, passwords, one-time codes or complete card details." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Panel title="Submit a request" description="Include the business name, message ID (if any) and approximate time. Requests are recorded server-side and replied to by email.">
          {done ? (
            <div className="py-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-brand-600" />
              <h3 className="mt-3 text-base font-semibold text-ink">Request recorded</h3>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">Your request is in the support queue. A reply will go to the email you provided. For urgent account security concerns, also sign in and use the dashboard support form.</p>
              <Button variant="secondary" className="mt-4" onClick={() => setDone(false)}>Send another request</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error ? <Callout tone="danger">{error}</Callout> : null}
              <Field label="Email address" htmlFor="support-email" required>
                <TextInput id="support-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" />
              </Field>
              <Field label="Subject" htmlFor="support-subject" required>
                <TextInput id="support-subject" required minLength={3} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} placeholder="Sender ID approval question" />
              </Field>
              <Field label="How can we help?" htmlFor="support-body" required hint="At least 20 characters. Do not include secrets.">
                <TextArea id="support-body" required minLength={20} maxLength={4000} rows={7} value={body} onChange={event => setBody(event.target.value)} placeholder="Describe the issue, what you expected, and any relevant message reference." />
              </Field>
              <Button type="submit" loading={loading}>Send to support</Button>
            </form>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Other ways to get help">
            <div className="space-y-4 text-sm">
              {config.data?.supportEmail ? (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 text-brand-600" />
                  <div><p className="font-semibold text-ink">Email</p><a href={`mailto:${config.data.supportEmail}`} className="link break-all">{config.data.supportEmail}</a></div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 text-brand-600" />
                  <div><p className="font-semibold text-ink">Email</p><p className="text-muted">No public support email is configured yet. Use this form; it is stored in the platform queue.</p></div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MessageSquareText className="mt-0.5 h-4 w-4 text-brand-600" />
                <div><p className="font-semibold text-ink">Existing customers</p><p className="text-muted">Sign in and open <Link to="/app/support" className="link">dashboard support</Link> so the request is linked to your account.</p></div>
              </div>
              <div className="flex items-start gap-3">
                <LifeBuoy className="mt-0.5 h-4 w-4 text-brand-600" />
                <div><p className="font-semibold text-ink">Security issues</p><p className="text-muted">If you suspect key exposure, revoke the key immediately in Projects & keys and tell support. Do not send the key itself.</p></div>
              </div>
            </div>
          </Panel>
          <Callout tone="info" title="What support can and cannot do">
            Support can investigate recorded events, reconcile uncertain SMS charges, review sender and account approvals, and explain provider requirements. Support cannot guarantee delivery, override Meta policy, or refund provider-billed messages without evidence.
          </Callout>
        </div>
      </div>
    </div>
  );
}
