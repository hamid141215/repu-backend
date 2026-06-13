/**
 * Client-side auth via localStorage.
 *
 * Tradeoff documented in BLOCKERS.md: in this SPA we use localStorage instead
 * of an httpOnly cookie. The reason is operational — the SPA is served by the
 * same Express backend that hosts the API (same origin), so a "proxy +
 * httpOnly cookie" model would just add ceremony with no extra security on a
 * single-origin deployment. This matches the legacy admin.html behaviour.
 *
 * Tradeoff cost: XSS that smuggles in JavaScript can read the key. We accept
 * this for a B2B operator dashboard with a small audience.
 */

export const REPU_KEY_STORAGE = 'repu_key';

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(REPU_KEY_STORAGE); }
  catch { return null; }
}

export function setApiKey(value: string): void {
  try { window.localStorage.setItem(REPU_KEY_STORAGE, value); }
  catch { /* storage disabled — login will simply not persist */ }
}

export function clearApiKey(): void {
  try { window.localStorage.removeItem(REPU_KEY_STORAGE); }
  catch { /* ignore */ }
}
