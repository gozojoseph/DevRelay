import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { Button, Callout, Field, TextInput } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  usePageTitle('Reset password');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(null);
    try {
      const result = await api<{ message: string }>('/auth/request-reset', { method: 'POST', body: { email } });
      setMessage(result.message);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  return (
    <AuthShell title="Reset your password" description="Enter the account email. If it exists, a reset link valid for 30 minutes will be sent. The response is intentionally the same for unknown addresses."
      footer={<p>Remembered it? <Link to="/login" className="link">Back to sign in</Link></p>}>
      {message ? (
        <Callout tone="success" title="Check your email">{message}</Callout>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Field label="Email address" htmlFor="forgot-email" required>
            <TextInput id="forgot-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="owner@company.com" />
          </Field>
          <Button type="submit" loading={loading} className="w-full"><MailCheck className="h-4 w-4" /> Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
