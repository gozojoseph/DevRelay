import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { Button, Callout, Field, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  usePageTitle('Sign in');
  const { login, me } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = (location.state as { message?: string } | null)?.message;
  const from = (location.state as { from?: string } | null)?.from;
  if (me) {
    return (
      <AuthShell title="You are already signed in" description="Continue to your console or sign out from there to switch accounts.">
        <Link to={me.user.role === 'admin' ? '/admin' : '/app'} className="block rounded-xl bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-700">
          Continue to {me.user.role === 'admin' ? 'admin console' : 'dashboard'}
        </Link>
      </AuthShell>
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      const result = await login(email, password, mfaCode.trim() || undefined);
      if (result.mfaSetupRequired) navigate('/admin/mfa', { replace: true });
      else if (result.role === 'admin') navigate('/admin', { replace: true });
      else navigate(from && from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
      if (!showMfa) setShowMfa(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthShell title="Sign in to DevRelay" description="Use your business account. Administrator accounts require a one-time code after MFA is enabled."
      footer={<p>New to DevRelay? <Link to="/register" className="link">Create an account</Link></p>}>
      <form onSubmit={submit} className="space-y-4">
        {notice ? <Callout tone="success">{notice}</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Field label="Email address" htmlFor="login-email" required>
          <TextInput id="login-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password" htmlFor="login-password" required>
          <TextInput id="login-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Your password" />
        </Field>
        {showMfa ? (
          <Field label="Authentication code" htmlFor="login-mfa" hint="Required for administrators with MFA. Leave blank for developer accounts.">
            <TextInput id="login-mfa" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={mfaCode}
              onChange={event => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowMfa(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink">
            <KeyRound className="h-3.5 w-3.5" /> Signing in as an administrator?
          </button>
        )}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted">Sessions expire after 7 days.</span>
          <Link to="/forgot-password" className="link">Forgot password?</Link>
        </div>
        <Button type="submit" loading={loading} className="w-full"><LogIn className="h-4 w-4" /> Sign in</Button>
      </form>
    </AuthShell>
  );
}
