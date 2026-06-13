import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { validateApiKey } from '@/lib/api-client';
import { setApiKey } from '@/lib/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [apiKey, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await validateApiKey(apiKey.trim());
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setApiKey(apiKey.trim());
      navigate(next, { replace: true });
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-md rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-md text-white num"
            style={{ background: 'var(--color-primary)', fontWeight: 700, fontSize: 20 }}
          >R</div>
          <h1 className="text-[20px] font-semibold text-[var(--color-text-1)]">RepuSystem</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-2)]">أدخل مفتاح الدخول للمتابعة</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">مفتاح الدخول</span>
            <input
              type="password"
              autoFocus
              value={apiKey}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy}
              className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-primary)] focus:ring-3 focus:ring-[var(--color-primary)]/10 disabled:opacity-60"
              dir="ltr"
              autoComplete="off"
            />
          </label>

          {error ? (
            <div className="rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px] text-[var(--color-bad)]">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || apiKey.length === 0}
            className="w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-medium text-white transition disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >
            {busy ? 'جاري التحقق…' : 'الدخول إلى لوحة التحكم'}
          </button>
        </form>
      </div>
    </div>
  );
}
