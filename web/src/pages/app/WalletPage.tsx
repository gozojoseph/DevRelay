import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine, CircleDollarSign, CreditCard, Download, ExternalLink, ReceiptText, RefreshCw, WalletCards,
} from 'lucide-react';
import { api, apiUrl, errorMessage } from '../../lib/api';
import { useApi, usePageTitle } from '../../lib/hooks';
import { formatDate, formatMinor, minorToGhs, parseGhsToMinor, titleCase } from '../../lib/format';
import type { LedgerEntry, PaymentAttempt, Wallet } from '../../lib/types';
import { useToast } from '../../context/ToastContext';
import {
  Badge, Button, Callout, EmptyState, Field, Loading, PageHeader, Panel, StatCard, StatusBadge, TextInput,
} from '../../components/ui';

interface FundResponse { reference: string; authorizationUrl: string }
interface VerifyResponse { status: string; reference: string }

export function WalletPage() {
  usePageTitle('Wallet');
  const { toast } = useToast();
  const [params] = useSearchParams();
  const reference = params.get('reference');
  const checked = useRef<string | null>(null);
  const wallet = useApi<Wallet>('/app/wallet');
  const payments = useApi<PaymentAttempt[]>('/app/wallet/payments');
  const history = useApi<LedgerEntry[]>('/app/wallet/history');
  const [amount, setAmount] = useState('');
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (!reference || checked.current === reference) return;
    checked.current = reference;
    setVerifying(reference);
    api<VerifyResponse>(`/app/wallet/payments/${reference}/verify`, { method: 'POST' })
      .then(result => {
        if (result.status === 'credited') {
          setPaymentNotice({ tone: 'success', text: 'Payment verified and credited to your available balance.' });
        } else if (['failed', 'abandoned', 'reversed', 'mismatch'].includes(result.status)) {
          setPaymentNotice({ tone: 'danger', text: `Payment was not credited. Paystack status: ${titleCase(result.status)}. Contact support with the reference if you believe this is wrong.` });
        } else {
          setPaymentNotice({ tone: 'warning', text: `Payment is not yet confirmed. Paystack status: ${titleCase(result.status)}. Do not pay twice; verify again shortly or contact support.` });
        }
      })
      .catch(cause => setPaymentNotice({ tone: 'danger', text: errorMessage(cause) }))
      .finally(() => {
        setVerifying(null);
        void wallet.reload(); void payments.reload(); void history.reload();
      });
  }, [reference, wallet, payments, history]);
  const minimum = wallet.data?.minimumFundingMinor ?? null;
  const available = wallet.data?.fundingAvailable ?? false;
  const presets = [1000, 2000, 5000, 10000, 20000, 50000].filter(value => !minimum || value >= minimum);
  async function fund(event: FormEvent) {
    event.preventDefault();
    const minor = parseGhsToMinor(amount);
    setFundError(null);
    if (minor === null) { setFundError('Enter an amount in GHS with at most two decimal places.'); return; }
    if (minimum && minor < minimum) { setFundError(`The minimum funding amount is ${formatMinor(minimum)}.`); return; }
    setFunding(true);
    try {
      const result = await api<FundResponse>('/app/wallet/fund', { method: 'POST', body: { amountMinor: minor } });
      window.location.assign(result.authorizationUrl);
    } catch (cause) { setFundError(errorMessage(cause)); setFunding(false); }
  }
  async function verifyPayment(value: string) {
    setVerifying(value);
    try {
      const result = await api<VerifyResponse>(`/app/wallet/payments/${value}/verify`, { method: 'POST' });
      toast(result.status === 'credited' ? 'Payment credited.' : `Payment status: ${titleCase(result.status)}.`, result.status === 'credited' ? 'success' : 'info');
      await Promise.all([wallet.reload(), payments.reload(), history.reload()]);
    } catch (cause) { toast(errorMessage(cause), 'error'); } finally { setVerifying(null); }
  }
  return (
    <>
      <PageHeader eyebrow="Billing" title="Wallet"
        description="Prepaid GHS credit. Funding is credited only after Paystack is verified server-side. Every ledger movement is balanced and immutable." />
      {paymentNotice ? <div className="mb-5"><Callout tone={paymentNotice.tone} title={paymentNotice.tone === 'success' ? 'Payment confirmed' : 'Payment verification'}>{paymentNotice.text}{reference ? <span className="ml-1 break-all font-mono text-[11px]">Ref: {reference}</span> : null}</Callout></div> : null}
      {wallet.loading && !wallet.data ? <Loading label="Loading wallet…" /> : wallet.error ? <Callout tone="danger" title="Could not load wallet">{wallet.error}</Callout> : wallet.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Available" value={formatMinor(wallet.data.availableMinor)} hint="Ready to reserve for messages" icon={WalletCards} />
            <StatCard label="Reserved" value={formatMinor(wallet.data.reservedMinor)} hint="Queued, sending or awaiting reconciliation" icon={ArrowDownToLine} tone="amber" />
            <StatCard label="Minimum funding" value={minimum ? formatMinor(minimum) : 'Not configured'} hint={available ? 'Paystack is configured' : 'Funding is currently unavailable'} icon={CircleDollarSign} tone="sky" />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Panel title="Add credit" description="You will be redirected to Paystack. DevRelay never accepts card details and never treats a client-side redirect as payment success.">
              {!available ? <Callout tone="warning" title="Funding unavailable">Paystack or the minimum funding amount is not configured. Top-ups are disabled until an operator completes setup.</Callout> : (
                <form onSubmit={fund} className="space-y-4">
                  {fundError ? <Callout tone="danger">{fundError}</Callout> : null}
                  <Field label="Amount (GHS)" htmlFor="fund-amount" required hint={minimum ? `Minimum ${formatMinor(minimum)}.` : undefined}>
                    <TextInput id="fund-amount" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="50.00" />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {presets.map(value => <button key={value} type="button" onClick={() => setAmount(minorToGhs(value))} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-muted hover:bg-elevated hover:text-ink">{formatMinor(value)}</button>)}
                  </div>
                  <Button type="submit" loading={funding} className="w-full"><CreditCard className="h-4 w-4" /> Continue to Paystack <ExternalLink className="h-3.5 w-3.5" /></Button>
                  <p className="text-xs leading-5 text-muted">Funding is confirmed by the Paystack webhook or a server-side verification call. If you close the Paystack page, use “Verify” on the payment attempt instead of paying twice.</p>
                </form>
              )}
            </Panel>
            <Panel title="Payment attempts" description="References created by this account, newest first." action={<Button variant="ghost" size="sm" onClick={() => void payments.reload()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>} bodyClassName="p-0">
              {payments.loading && !payments.data ? <Loading label="Loading payments…" /> : payments.data?.length ? (
                <div className="table-wrap border-0">
                  <table className="data-table">
                    <thead><tr><th>Reference</th><th>Amount</th><th>Status</th><th>Created</th><th></th></tr></thead>
                    <tbody>
                      {payments.data.map(payment => (
                        <tr key={payment.reference}>
                          <td className="max-w-[180px] truncate font-mono text-[11px] text-muted" title={payment.reference}>{payment.reference}</td>
                          <td className="font-medium text-ink">{formatMinor(payment.amountMinor)}</td>
                          <td><StatusBadge status={payment.status} /></td>
                          <td className="text-xs text-muted">{formatDate(payment.createdAt)}</td>
                          <td>{!payment.creditedAt && ['pending', 'initializing', 'reconciliation_required', 'mismatch'].includes(payment.status) ? (
                            <Button size="sm" variant="secondary" loading={verifying === payment.reference} onClick={() => void verifyPayment(payment.reference)}>Verify</Button>
                          ) : payment.creditedAt ? <span className="text-[11px] text-muted">Credited</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="p-5"><EmptyState icon={CreditCard} title="No payment attempts" description="A Paystack attempt will appear here when you start funding." /></div>}
            </Panel>
          </div>
          <Panel className="mt-6" title="Credit history" description="Ledger entries for the customer available account. Amounts are integer pesewas." action={<a href={apiUrl('/app/wallet/history?format=csv')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"><Download className="h-3.5 w-3.5" /> CSV</a>} bodyClassName="p-0">
            {history.loading && !history.data ? <Loading label="Loading ledger history…" /> : history.data?.length ? (
              <div className="table-wrap border-0">
                <table className="data-table">
                  <thead><tr><th>Reference</th><th>Type</th><th className="text-right">Available change</th><th>Created</th></tr></thead>
                  <tbody>
                    {history.data.map((entry, index) => (
                      <tr key={`${entry.reference}-${index}`}>
                        <td className="max-w-[260px] truncate font-mono text-[11px] text-muted" title={entry.reference}>{entry.reference}</td>
                        <td><Badge tone="neutral">{titleCase(entry.kind)}</Badge></td>
                        <td className={`text-right font-semibold ${entry.amountMinor >= 0 ? 'text-brand-700 dark:text-brand-300' : 'text-rose-600 dark:text-rose-400'}`}>{entry.amountMinor >= 0 ? '+' : ''}{formatMinor(entry.amountMinor)}</td>
                        <td className="text-xs text-muted">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="p-5"><EmptyState icon={ReceiptText} title="No ledger entries" description="Funding, reservations, settlements and releases will appear here." /></div>}
          </Panel>
          <p className="mt-4 text-xs leading-5 text-muted">Need an invoice or a refund review? <Link to="/app/support" className="link">Contact support</Link> with the payment reference. Refund eligibility depends on unused credit and non-refundable provider costs.</p>
        </>
      ) : null}
    </>
  );
}
