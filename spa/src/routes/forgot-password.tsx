import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; reset_url?: string; note?: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'تعذر إرسال الطلب'); return; }
      setDone(body);
    } catch { setError('تعذر الاتصال بالخادم'); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-md rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-[20px] font-semibold text-[var(--color-text-1)]">استعادة كلمة المرور</h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-2)]">أدخل بريدك وسنرسل لك رابط إعادة التعيين</p>
        </div>

        {done ? (
          <div className="space-y-3">
            <div className="rounded-[7px] p-3 text-[13px]" style={{ background: 'var(--color-good-light)', color: '#047857' }}>
              {done.message}
            </div>
            {done.reset_url ? (
              <div className="rounded-[7px] p-3 text-[12.5px]" style={{ background: '#FFF7ED', color: '#7C2D12', border: '1px solid #FED7AA' }}>
                <div className="font-medium mb-2">{done.note}</div>
                <input readOnly value={done.reset_url} dir="ltr"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="w-full rounded-[6px] border border-[#FED7AA] bg-white px-2 py-1.5 text-[11.5px] font-mono cursor-pointer" />
              </div>
            ) : null}
            <Link to="/login" className="block text-center text-[13px]" style={{ color: 'var(--color-primary)' }}>
              ← العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">البريد الإلكتروني</span>
              <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
                className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                dir="ltr" autoComplete="email" />
            </label>
            {error ? <div className="rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px] text-[var(--color-bad)]">{error}</div> : null}
            <button type="submit" disabled={busy || !email}
              className="w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {busy ? 'جاري الإرسال…' : 'إرسال رابط الاستعادة'}
            </button>
            <Link to="/login" className="block text-center text-[12.5px]" style={{ color: 'var(--color-text-2)' }}>
              العودة لتسجيل الدخول
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
