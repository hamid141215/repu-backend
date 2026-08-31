import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const isInvite = params.get('invite') === '1';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    if (password !== confirm) { setError('كلمتا المرور غير متطابقتين'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'تعذر تحديث كلمة المرور'); return; }
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch { setError('تعذر الاتصال بالخادم'); }
    finally { setBusy(false); }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--color-bg)' }}>
        <div className="w-full max-w-md rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm text-center">
          <div className="text-[14px] text-[var(--color-bad)] mb-3">الرابط غير صالح. يرجى استخدام رابط من رسالة الاستعادة.</div>
          <Link to="/login" className="text-[13px]" style={{ color: 'var(--color-primary)' }}>← العودة لتسجيل الدخول</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-md rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-[20px] font-semibold text-[var(--color-text-1)]">
            {isInvite ? 'تفعيل حسابك' : 'تعيين كلمة مرور جديدة'}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-2)]">
            {isInvite ? 'مرحباً بك. اختر كلمة مرور للبدء.' : 'اختر كلمة مرور قوية، 8 أحرف على الأقل.'}
          </p>
        </div>

        {done ? (
          <div className="space-y-3 text-center">
            <div className="rounded-[7px] p-3 text-[13px]" style={{ background: 'var(--color-good-light)', color: '#047857' }}>
              تم تحديث كلمة المرور. جاري تحويلك لتسجيل الدخول…
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">كلمة المرور الجديدة</span>
              <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
                className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                dir="ltr" autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">تأكيد كلمة المرور</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy}
                className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2.5 text-[13.5px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                dir="ltr" autoComplete="new-password" />
            </label>
            {error ? <div className="rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px] text-[var(--color-bad)]">{error}</div> : null}
            <button type="submit" disabled={busy || !password || !confirm}
              className="w-full rounded-[7px] px-4 py-2.5 text-[13.5px] font-medium text-white transition disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>
              {busy ? 'جاري الحفظ…' : (isInvite ? 'تفعيل الحساب والدخول' : 'حفظ كلمة المرور')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
