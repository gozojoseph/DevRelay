import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { useAuth } from '../../context/AuthContext';
import { Button, Callout, CopyButton, Field, Loading, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function AdminMfaPage() {
  usePageTitle('Admin MFA setup');
  const { me, clear, logout } = useAuth();
  const navigate = useNavigate();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <Navigate to="/login" replace />;
  if (me.user.role !== 'admin') return <Navigate to="/app" replace />;
  if (me.user.mfaEnabled) return <Navigate to="/admin" replace />;
  async function setup() {
    setLoading(true); setError(null);
    try {
      const result = await api<{ secret: string; otpauthUrl: string }>('/auth/admin/mfa/setup', { method: 'POST' });
      setSecret(result.secret); setOtpauthUrl(result.otpauthUrl);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  async function confirm() {
    setLoading(true); setError(null);
    try {
      const result = await api<{ message: string }>('/auth/admin/mfa/confirm', { method: 'POST', body: { code } });
      clear();
      navigate('/login', { replace: true, state: { message: result.message } });
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  async function exit() {
    await logout();
    navigate('/login', { replace: true });
  }
  return (
    <AuthShell title="Protect the admin console" description="Administrator routes require multi-factor authentication. Set up a TOTP authenticator now; there is no bypass."
      footer={<button type="button" onClick={() => void exit()} className="text-sm text-muted hover:text-ink">Sign out instead</button>}>
      <div className="space-y-5">
        <Callout tone="warning" title="Required before admin access">
          Use a standards-based authenticator such as 1Password, Authy, Google Authenticator or a hardware-backed TOTP app. Store recovery access securely with your team; DevRelay has no automatic email bypass for admins.
        </Callout>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {!secret ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Smartphone className="h-4 w-4 text-brand-600" /> Prepare your authenticator</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-muted">
                <li>Keep the authenticator app open on your phone.</li>
                <li>Generate a new secret below.</li>
                <li>Add the secret manually or open the setup URI.</li>
                <li>Enter the current 6-digit code to activate MFA.</li>
              </ol>
            </div>
            <Button type="button" onClick={() => void setup()} loading={loading} className="w-full"><ShieldCheck className="h-4 w-4" /> Generate TOTP secret</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">TOTP secret</p>
                <CopyButton value={secret} />
              </div>
              <p className="mt-2 break-all font-mono text-sm tracking-wider text-ink">{secret}</p>
              {otpauthUrl ? (
                <a href={otpauthUrl} className="link mt-3 inline-flex items-center gap-1.5 text-xs"><KeyRound className="h-3.5 w-3.5" /> Open authenticator setup URI</a>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-muted">If the URI does not open, enter the secret manually in your app with issuer “DevRelay”, 6 digits, 30-second period.</p>
            </div>
            <Field label="Current 6-digit code" htmlFor="mfa-code" required hint="Codes rotate every 30 seconds and cannot be reused.">
              <TextInput id="mfa-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required
                value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
            </Field>
            <Button type="button" onClick={() => void confirm()} loading={loading} disabled={code.length !== 6} className="w-full">
              <ShieldCheck className="h-4 w-4" /> Activate MFA
            </Button>
            <p className="text-center text-xs leading-5 text-muted">Activation invalidates this session. You will sign in again with the code. Need help? <Link to="/support" className="link">Contact support</Link>.</p>
          </div>
        )}
        {loading && !secret ? <Loading label="Generating…" /> : null}
      </div>
    </AuthShell>
  );
}
