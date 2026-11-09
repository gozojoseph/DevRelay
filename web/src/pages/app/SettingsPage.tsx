import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, KeyRound, LockKeyhole, LogOut, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { usePageTitle } from '../../lib/hooks';
import { formatMinor, titleCase } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Badge, Button, Callout, Field, PageHeader, Panel, StatusBadge, TextInput,
} from '../../components/ui';

export function SettingsPage() {
  usePageTitle('Settings');
  const { me, logout, clear } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const result = await api<{ message: string }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      clear();
      navigate('/login', { replace: true, state: { message: result.message } });
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }
  return (
    <>
      <PageHeader eyebrow="Account" title="Settings"
        description="Account identity and approval are managed by the platform operator. You can change your password and interface theme here." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-600" /> Business account</span>} description="Legal identity changes require operator review. Contact support if these details are wrong.">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Business name</dt><dd className="mt-1 font-semibold text-ink">{me.account?.businessName ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">Account status</dt><dd className="mt-1"><StatusBadge status={me.account?.status ?? 'pending_verification'} /></dd></div>
              <div><dt className="text-xs text-muted">Country</dt><dd className="mt-1 text-ink">{me.account?.country ?? 'GH'}</dd></div>
              <div><dt className="text-xs text-muted">Daily spend ceiling</dt><dd className="mt-1 text-ink">{me.account ? formatMinor(me.account.dailySpendLimitMinor) : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Daily volume ceiling</dt><dd className="mt-1 text-ink">{me.account ? `${me.account.dailyVolumeLimit.toLocaleString('en-GH')} messages` : '—'}</dd></div>
              <div><dt className="text-xs text-muted">Account ID</dt><dd className="mt-1 break-all font-mono text-[11px] text-ink">{me.account?.id ?? '—'}</dd></div>
            </dl>
            <div className="mt-4"><Callout tone="info">Limits are set by the operator. Projects can use lower limits but cannot exceed these ceilings. To request a higher ceiling, <Link to="/app/support" className="link">contact support</Link> with your expected volume and use case.</Callout></div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><UserRound className="h-4 w-4 text-brand-600" /> Sign-in identity</span>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Email</dt><dd className="mt-1 break-all font-medium text-ink">{me.user.email}</dd></div>
              <div><dt className="text-xs text-muted">Email verified</dt><dd className="mt-1">{me.user.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}</dd></div>
              <div><dt className="text-xs text-muted">Role</dt><dd className="mt-1 text-ink">{titleCase(me.user.role)}</dd></div>
              <div><dt className="text-xs text-muted">MFA</dt><dd className="mt-1">{me.user.mfaEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Not enabled</Badge>}</dd></div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted">Email changes are not self-service. Contact support so the operator can verify ownership before changing the login identity.</p>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand-600" /> Change password</span>} description="Changing the password revokes every session, including this one. You will sign in again.">
            {error ? <div className="mb-4"><Callout tone="danger">{error}</Callout></div> : null}
            <form onSubmit={changePassword} className="space-y-4">
              <Field label="Current password" htmlFor="current-password" required>
                <TextInput id="current-password" type="password" required autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="New password" htmlFor="new-password" required hint="At least 12 characters.">
                  <TextInput id="new-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password" required>
                  <TextInput id="confirm-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} />
                </Field>
              </div>
              <Button type="submit" loading={busy}><LockKeyhole className="h-4 w-4" /> Update password</Button>
            </form>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={<span className="inline-flex items-center gap-2"><Palette className="h-4 w-4 text-brand-600" /> Appearance</span>}>
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium text-ink">Interface theme</p><p className="text-xs text-muted">Stored in this browser only.</p></div>
              <div className="flex rounded-xl border border-line bg-elevated p-1">
                {(['light', 'dark'] as const).map(value => (
                  <button key={value} type="button" onClick={() => setTheme(value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${theme === value ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>{titleCase(value)}</button>
                ))}
              </div>
            </div>
          </Panel>
          <Panel title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" /> Security</span>}>
            <div className="space-y-3 text-sm leading-6 text-muted">
              <p>Sessions are HTTP-only and expire after 7 days. API keys are separate credentials and should be rotated if exposed.</p>
              <div className="flex flex-wrap gap-2"><Link to="/app/projects" className="link text-xs">Manage API keys</Link><Link to="/docs#authentication" className="link text-xs">Auth docs</Link></div>
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <Button variant="secondary" onClick={() => void signOut()} className="w-full"><LogOut className="h-4 w-4" /> Sign out of this session</Button>
            </div>
          </Panel>
          <Panel title="Policies">
            <div className="space-y-2 text-sm">
              <Link to="/terms" className="block text-muted hover:text-ink">Terms of service</Link>
              <Link to="/privacy" className="block text-muted hover:text-ink">Privacy notice</Link>
              <Link to="/acceptable-use" className="block text-muted hover:text-ink">Acceptable use policy</Link>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">Draft policies remain subject to legal and regulatory review.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
