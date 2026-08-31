import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { loginWithPassword, validateApiKey } from '@/lib/api-client';
import { setApiKey, setSession } from '@/lib/auth';

type Mode = 'email' | 'apikey';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmitEmail(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const result = await loginWithPassword(email.trim(), password);
      setSession(result.token, result.user);
      navigate(next, { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'تعذر تسجيل الدخول');
    } finally { setBusy(false); }
  }

  async function onSubmitApiKey(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const result = await validateApiKey(apiKey.trim());
      if (!result.ok) { setError(result.message); return; }
      setApiKey(apiKey.trim());
      navigate(next, { replace: true });
    } catch { setError('تعذر الاتصال بالخادم'); }
    finally { setBusy(false); }
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
          <p className="mt-1 text-[13px] text-[var(--color-text-2)]">
            {mode === 'email' ? 'سجّل دخولك بحسابك' : 'أدخل مفتاح المنشأة الرئيسي'}
          </p>
        </div>

        {/* Mode tabs */}
        <div className="mb-5 flex gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <ModeTab active={mode === 'email'} onClick={() => { setMode('email'); setError(null); }}>الإيميل وكلمة المرور</ModeTab>
          <ModeTab active={mode === 'apikey'} onClick={() => { setMode('apikey'); setError(null); }}>مفتاح المنشأة</ModeTab>
        </div>

        {mode === 'email' ? (
          <form onSubmit={onSubmitEmail} className="space-y-3">
            <Field label="البريد الإلكتروني">
              <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
                className={inputCls} dir="ltr" autoComplete="email" />
            </Field>
            <Field label="كلمة المرور">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
                className={inputCls} dir="ltr" autoComplete="current-password" />
            </Field>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-[12px] font-medium" style={{ color: 'var(--color-primary)' }}>
                نسيت كلمة المرور؟
              </Link>
            </div>
            {error ? <ErrorMsg>{error}</ErrorMsg> : null}
            <button type="submit" disabled={busy || !email || !password}
              className="w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {busy ? 'جاري الدخول…' : 'الدخول'}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitApiKey} className="space-y-3">
            <Field label="مفتاح المنشأة">
              <input type="password" autoFocus value={apiKey} onChange={(e) => setKey(e.target.value)} disabled={busy}
                className={inputCls} dir="ltr" autoComplete="off" />
            </Field>
            <div className="text-[11.5px] text-[var(--color-text-3)] leading-relaxed">
              هذا المفتاح خاص بالمالك. يفتح الصلاحيات الكاملة. لإدارة فريقك، استخدم تبويب "الإيميل وكلمة المرور".
            </div>
            {error ? <ErrorMsg>{error}</ErrorMsg> : null}
            <button type="submit" disabled={busy || !apiKey}
              className="w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {busy ? 'جاري التحقق…' : 'الدخول إلى لوحة التحكم'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-primary)] focus:ring-3 focus:ring-[var(--color-primary)]/10 disabled:opacity-60';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px] text-[var(--color-bad)]">
      {children}
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="px-3 py-2 text-[12.5px] font-medium transition"
      style={{
        marginBottom: -1,
        borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
        color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
        cursor: 'pointer'
      }}>{children}</button>
  );
}
