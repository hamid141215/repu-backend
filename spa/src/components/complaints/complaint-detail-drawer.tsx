'use client';

import { useEffect, useState } from 'react';
import { IconX, IconBrandWhatsapp, IconBuildingStore, IconClock } from '@tabler/icons-react';
import { useComplaint, useUpdateComplaintStatus } from '@/lib/queries';
import { TimeAgo } from '@/components/time-ago';

interface Props {
  complaintId: number | null;
  onClose: () => void;
}

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'new',         label: 'جديدة' },
  { key: 'contacted',   label: 'تم التواصل' },
  { key: 'in_progress', label: 'قيد المعالجة' },
  { key: 'resolved',    label: 'حُلّت' },
  { key: 'closed',      label: 'مُغلقة' }
];

export function ComplaintDetailDrawer({ complaintId, onClose }: Props) {
  const query = useComplaint(complaintId);
  const update = useUpdateComplaintStatus();
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNote(query.data?.complaint_note ?? '');
    setErr(null);
  }, [query.data?.id, query.data?.complaint_note]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (complaintId == null) return null;

  const c = query.data;

  async function setStatus(newStatus: string) {
    if (!c) return;
    setErr(null);
    try {
      await update.mutateAsync({ id: c.id, complaint_status: newStatus, complaint_note: note.trim() || null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر تحديث الحالة');
    }
  }

  const waNumber = c?.phone?.replace(/[^\d]/g, '');
  const waLink = waNumber ? `https://wa.me/${waNumber}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل الشكوى"
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="flex-1 cursor-default"
        style={{ background: 'rgba(10, 14, 26, 0.4)' }}
      />
      <div
        className="flex h-full flex-col"
        style={{
          width: 480, maxWidth: '100%',
          background: 'var(--color-surface)',
          borderInlineStart: '1px solid var(--color-border)'
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-text-1)]">
              تفاصيل الشكوى{c ? ` #${c.id}` : ''}
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-3)]">
              تحديث الحالة يُسجَّل داخلياً
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="rounded-[7px] p-1.5 transition hover:bg-[#F4F5F7]"
          ><IconX size={16} style={{ color: 'var(--color-text-3)' }} /></button>
        </header>

        {query.isLoading || !c ? (
          <div className="flex-1 px-5 py-4 space-y-3">
            <div className="animate-pulse rounded-[7px] h-20" style={{ background: '#F4F5F7' }} />
            <div className="animate-pulse rounded-[7px] h-32" style={{ background: '#F4F5F7' }} />
            <div className="animate-pulse rounded-[7px] h-20" style={{ background: '#F4F5F7' }} />
          </div>
        ) : (
          <>
            {/* Customer + branch + time */}
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="text-[14px] font-medium text-[var(--color-text-1)]">{c.name || 'عميل'}</div>
              <div className="num mt-0.5 text-[12px] text-[var(--color-text-3)]" dir="ltr">{c.phone || '—'}</div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--color-text-3)]">
                {c.branch ? (
                  <span className="inline-flex items-center gap-1"><IconBuildingStore size={13} />{c.branch}</span>
                ) : null}
                <span className="inline-flex items-center gap-1"><IconClock size={13} /><TimeAgo at={c.sent_at} /></span>
              </div>
            </div>

            {/* Feedback text */}
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="text-[11.5px] font-medium uppercase tracking-[0.4px] mb-1" style={{ color: 'var(--color-text-3)' }}>
                نص الشكوى
              </div>
              <div className="text-[13.5px] leading-[1.7]" style={{ color: 'var(--color-text-1)' }}>
                {c.feedback?.trim() || <span className="text-[var(--color-text-3)] italic">لا يوجد نص شكوى مسجل</span>}
              </div>
            </div>

            {/* Status update */}
            <div className="px-5 py-4 flex-1 overflow-y-auto">
              <div className="text-[11.5px] font-medium uppercase tracking-[0.4px] mb-2" style={{ color: 'var(--color-text-3)' }}>
                تحديث الحالة
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {STATUS_OPTIONS.map(opt => {
                  const active = (c.complaint_status || 'new') === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setStatus(opt.key)}
                      disabled={update.isPending}
                      className="rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-50"
                      style={{
                        background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                        color: active ? 'white' : 'var(--color-text-1)',
                        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`
                      }}
                    >{opt.label}</button>
                  );
                })}
              </div>

              <label className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">
                ملاحظة داخلية
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ملاحظة تُحفظ مع الشكوى…"
                disabled={update.isPending}
                className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white p-3 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
                maxLength={1000}
              />

              {err ? (
                <div className="mt-2 rounded-[7px] border border-[var(--color-bad)]/30 bg-[var(--color-bad-light)] px-3 py-2 text-[12.5px]" style={{ color: 'var(--color-bad)' }}>
                  {err}
                </div>
              ) : null}
            </div>

            {/* Footer actions */}
            <div
              className="px-5 py-3 flex items-center justify-between gap-2"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              {waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
                  style={{ borderColor: 'var(--color-good)', color: 'var(--color-good)', background: 'var(--color-good-light)' }}
                >
                  <IconBrandWhatsapp size={15} />
                  واتساب
                </a>
              ) : <span />}
              <button
                type="button"
                onClick={onClose}
                className="rounded-[7px] border px-3.5 py-1.5 text-[13px] font-medium"
                style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
              >إغلاق</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
