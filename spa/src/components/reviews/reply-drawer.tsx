'use client';

import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { Stars } from './rating-overview';
import { useReplyReview } from '@/lib/queries';
import { relativeTimeAr } from '@/lib/format';
import type { ReviewRow } from '@/types/api';

interface Props {
  review: ReviewRow | null;
  onClose: () => void;
}

export function ReplyDrawer({ review, onClose }: Props) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reply = useReplyReview();

  useEffect(() => {
    setText('');
    setErr(null);
  }, [review?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!review) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!review) return;
    const trimmed = text.trim();
    if (!trimmed) { setErr('نص الرد مطلوب'); return; }
    if (trimmed.length > 2000) { setErr('الرد طويل جداً (الحد الأقصى 2000 حرف)'); return; }
    setErr(null);
    try {
      await reply.mutateAsync({ id: review.id, text: trimmed });
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'تعذر إرسال الرد';
      setErr(msg);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="الرد على التقييم"
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="flex-1 cursor-default"
        style={{ background: 'rgba(10, 14, 26, 0.4)' }}
      />
      {/* Drawer slides in from the start side (right in RTL) */}
      <div
        className="flex h-full flex-col"
        style={{
          width: 460, maxWidth: '100%',
          background: 'var(--color-surface)',
          borderInlineStart: '1px solid var(--color-border)'
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-text-1)]">الرد على التقييم</div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-3)]">سيُحفظ الرد داخلياً ولا يُنشر تلقائياً</div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="rounded-[7px] p-1.5 transition hover:bg-[#F4F5F7]"
          ><IconX size={16} style={{ color: 'var(--color-text-3)' }} /></button>
        </header>

        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="text-[13px] font-medium text-[var(--color-text-1)]">{review.name || 'عميل'}</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]" suppressHydrationWarning>
            {[review.branch, relativeTimeAr(review.sent_at)].filter(Boolean).join(' · ')}
          </div>
          <Stars rating={review.rating} size={14} className="mt-2" />
          <div className="mt-2 text-[13px] leading-[1.6]" style={{ color: 'var(--color-text-2)' }}>
            {review.feedback?.trim() || <span className="text-[var(--color-text-3)] italic">لا يوجد نص مكتوب</span>}
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-1 flex-col px-5 py-4">
          <label className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">نص الرد</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب ردك على هذا التقييم…"
            disabled={reply.isPending}
            className="flex-1 rounded-[7px] border border-[var(--color-border-strong)] bg-white p-3 text-[13px] outline-none focus:border-[var(--color-primary)] focus:ring-3 focus:ring-[var(--color-primary)]/10 disabled:opacity-60"
            style={{ minHeight: 180, resize: 'vertical', fontFamily: 'inherit' }}
            maxLength={2000}
          />
          <div className="mt-1 text-[11px] text-[var(--color-text-3)] text-start" dir="ltr">
            {text.length} / 2000
          </div>
          {err ? (
            <div className="mt-2 rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px] text-[var(--color-bad)]">
              {err}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={reply.isPending}
              className="rounded-[7px] border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
            >إلغاء</button>
            <button
              type="submit"
              disabled={reply.isPending || text.trim().length === 0}
              className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >{reply.isPending ? 'جاري الإرسال…' : 'إرسال الرد'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
