const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');
let csrfToken: string | null = null;

export function apiUrl(path: string) { return `${base}${path}`; }
export function setCsrfToken(token: string | null) { csrfToken = token; }
export function getCsrfToken() { return csrfToken; }
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method, credentials: 'include', headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the DevRelay API. Check your connection and try again.');
  }
  const payload = await response.json().catch(() => null) as
    { data?: T; error?: { code?: string; message?: string }; requestId?: string } | null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
      window.dispatchEvent(new Event('devrelay:unauthorized'));
    }
    throw new ApiError(response.status, payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request could not be completed.', payload?.requestId);
  }
  return payload?.data as T;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}
