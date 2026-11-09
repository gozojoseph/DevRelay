export function formatMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return '—';
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', minimumFractionDigits: 2 })
    .format(minor / 100);
}

export function parseGhsToMinor(input: string): number | null {
  const value = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [units = '0', fraction = ''] = value.split('.');
  const minor = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function minorToGhs(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium' }).format(date);
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '—';
  const diff = date - Date.now();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000], ['month', 2592000000], ['week', 604800000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ];
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (abs >= size) return format.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

export function titleCase(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (['active', 'delivered', 'read', 'approved', 'settled', 'credited', 'resolved'].includes(status)) return 'success';
  if (['queued', 'sending', 'accepted', 'pending', 'pending_approval', 'pending_activation', 'pending_verification',
    'sent', 'incoming', 'initializing'].includes(status)) return 'info';
  if (['reserved', 'reconciliation_required', 'pending_reconciliation', 'paused', 'suspended'].includes(status)) return 'warning';
  if (['failed', 'rejected', 'dead', 'mismatch', 'reversed', 'disabled', 'flagged'].includes(status)) return 'danger';
  return 'neutral';
}

export function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}
