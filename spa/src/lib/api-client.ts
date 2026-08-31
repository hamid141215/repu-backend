/**
 * Browser-side fetch — hits the backend at same-origin /api/*.
 * Picks credentials in this order:
 *   1. session token (Phase E user login) → Authorization: Bearer
 *   2. api_key (legacy / owner master)    → x-api-key
 * On 401/403 we clear creds and redirect to login.
 */

import { clearApiKey, clearSession, getApiKey, getSessionToken } from './auth';

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

function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  if (token) return { 'Authorization': `Bearer ${token}` };
  const key = getApiKey();
  if (key) return { 'x-api-key': key };
  return {};
}

export async function apiClient<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const auth = authHeaders();
  if (!auth['Authorization'] && !auth['x-api-key']) {
    if (typeof window !== 'undefined' && window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
    throw new ApiClientError(401, null, 'No credentials');
  }

  const cleanPath = path.replace(/^\/?api\//, '').replace(/^\//, '');
  const url = `/api/${cleanPath}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...(init?.headers ?? {})
    }
  });

  if (res.status === 401) {
    // Session expired or invalid creds — clear and bounce.
    clearApiKey();
    clearSession();
    if (typeof window !== 'undefined') window.location.hash = '#/login';
    throw new ApiClientError(401, null, 'Unauthorized');
  }
  // 403 = authenticated but lacks permission. Don't clear creds.

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

/**
 * Email/password login.
 * On success, returns { token, user }. Caller stores them via setSession().
 */
export interface LoginResult {
  token: string;
  expires_at: string;
  user: {
    id: number; email: string; name: string;
    role: 'owner' | 'manager' | 'viewer';
    client_id: number; client_name: string;
  };
}
export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const res = await fetch('/api/auth/user-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await readJsonSafe(res);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body
      ? String((body as { error: unknown }).error)
      : 'تعذر تسجيل الدخول';
    throw new ApiClientError(res.status, body, msg);
  }
  return body as LoginResult;
}

/** Server-side logout — invalidates the current session token in the DB. */
export async function serverLogout(): Promise<void> {
  const token = getSessionToken();
  if (!token) return;
  try {
    await fetch('/api/auth/user-logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch { /* ignore */ }
}
