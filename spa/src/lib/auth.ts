/**
 * Client-side auth via localStorage.
 *
 * Phase E: SPA supports BOTH legacy api_key (owner master) AND user session
 * tokens (email/password login). The api-client picks whichever is stored.
 */

export const REPU_KEY_STORAGE   = 'repu_key';
export const REPU_TOKEN_STORAGE = 'repu_session_token';
export const REPU_USER_STORAGE  = 'repu_session_user';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'owner' | 'manager' | 'viewer';
  client_id: number;
  client_name: string;
}

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(REPU_KEY_STORAGE); }
  catch { return null; }
}

export function setApiKey(value: string): void {
  try { window.localStorage.setItem(REPU_KEY_STORAGE, value); }
  catch { /* storage disabled */ }
}

export function clearApiKey(): void {
  try { window.localStorage.removeItem(REPU_KEY_STORAGE); }
  catch { /* ignore */ }
}

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(REPU_TOKEN_STORAGE); }
  catch { return null; }
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REPU_USER_STORAGE);
    return raw ? JSON.parse(raw) as SessionUser : null;
  } catch { return null; }
}

export function setSession(token: string, user: SessionUser): void {
  try {
    window.localStorage.setItem(REPU_TOKEN_STORAGE, token);
    window.localStorage.setItem(REPU_USER_STORAGE, JSON.stringify(user));
  } catch { /* ignore */ }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(REPU_TOKEN_STORAGE);
    window.localStorage.removeItem(REPU_USER_STORAGE);
  } catch { /* ignore */ }
}

/** True if any auth credential is present (api_key OR session). */
export function isAuthenticated(): boolean {
  return getApiKey() !== null || getSessionToken() !== null;
}

/** Returns the current role — 'owner' for api_key, the user's role for sessions, null otherwise. */
export function getRole(): 'owner' | 'manager' | 'viewer' | null {
  if (getApiKey()) return 'owner';
  return getSessionUser()?.role ?? null;
}

/** True if the current identity can perform write/admin actions. */
export function canWrite(): boolean {
  const r = getRole();
  return r === 'owner' || r === 'manager';
}
export function isOwner(): boolean { return getRole() === 'owner'; }
