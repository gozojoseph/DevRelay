import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { Button, Callout, Field, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function ResetPasswordPage() {
  usePageTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const result = await api<{ message: string }>('/auth/reset', { method: 'POST', body: { token, password } });
      setMessage(result.message);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  return (
    <AuthShell title="Choose a new password" description="Resetting signs out every existing session, including on other devices."
      footer={<p><Link to="/login" className="link">Back to sign in</Link></p>}>
      {!token ? (
        <Callout tone="danger" title="Reset link missing">Open the link from your reset email, or <Link to="/forgot-password" className="link">request a new one</Link>.</Callout>
      ) : message ? (
        <div className="space-y-5">
          <Callout tone="success" title="Password changed">{message}</Callout>
          <Link to="/login" className="inline-flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="New password" htmlFor="reset-password" required hint="At least 12 characters.">
            <TextInput id="reset-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="reset-confirm" required>
            <TextInput id="reset-confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
          </Field>
          <Button type="submit" loading={loading} className="w-full"><KeyRound className="h-4 w-4" /> Change password</Button>
        </form>
      )}
    </AuthShell>
  );
}
