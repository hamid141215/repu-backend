/**
 * Browser-side fetch — hits the backend at same-origin /api/* with x-api-key
 * from localStorage. No proxy, no cookie, no CORS (same origin).
 *
 * On 401 we clear the key and reload to /login. Reload — not router push —
 * to flush all TanStack Query state for the now-stale tenant.
 */

import { clearApiKey, getApiKey } from './auth';

export class ApiClientError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try { return await res.json(); }
  catch { return null; }
}

export async function apiClient<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const key = getApiKey();
  if (!key) {
    // No key in storage — kick to login if we're in the browser.
    if (typeof window !== 'undefined' && window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
    throw new ApiClientError(401, null, 'No api key');
  }

  // Normalise: 'api/x' / '/api/x' both work; we always prefix /api/ once.
  const cleanPath = path.replace(/^\/?api\//, '').replace(/^\//, '');
  const url = `/api/${cleanPath}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (res.status === 401 || res.status === 403) {
    clearApiKey();
    if (typeof window !== 'undefined') {
      window.location.hash = '#/login';
    }
    throw new ApiClientError(res.status, null, 'Unauthorized');
  }

  const body = await readJsonSafe(res);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status}`;
    throw new ApiClientError(res.status, body, msg);
  }
  return body as T;
}

/** Validates a key by calling /api/client-info. Returns true on 200. */
export async function validateApiKey(key: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const res = await fetch('/api/client-info', { headers: { 'x-api-key': key } });
  if (res.ok) return { ok: true };
  return {
    ok: false,
    status: res.status,
    message: res.status === 401 || res.status === 403
      ? 'مفتاح الدخول غير صحيح'
      : `تعذر التحقق من المفتاح (HTTP ${res.status})`
  };
}
