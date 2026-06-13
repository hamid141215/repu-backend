'use client';

import { useState, useRef, useEffect } from 'react';
import { IconDotsVertical, IconAlertTriangle, IconPencil, IconTrash } from '@tabler/icons-react';
import { safeNumber } from '@/lib/format';
import { useDeleteBranch } from '@/lib/queries';
import type { BranchRow } from '@/types/api';

interface Props {
  branch: BranchRow;
  onEdit: () => void;
}

function statusOf(rating: number): { label: string; badgeStyle: React.CSSProperties; needsAttention: boolean } {
  if (rating === 0)   return { label: 'لا بيانات', badgeStyle: { background: '#F1F3F5', color: 'var(--color-text-2)' }, needsAttention: false };
  if (rating >= 4.5) return { label: 'ممتاز',     badgeStyle: { background: 'var(--color-good-light)', color: '#047857' }, needsAttention: false };
  if (rating >= 4)   return { label: 'جيد جداً',  badgeStyle: { background: 'var(--color-good-light)', color: '#047857' }, needsAttention: false };
  if (rating >= 3.5) return { label: 'متوسط',     badgeStyle: { background: 'var(--color-warn-light)', color: '#B45309' }, needsAttention: false };
  return                  { label: 'يحتاج تدخل', badgeStyle: { background: 'var(--color-bad-light)',  color: '#B91C1C' }, needsAttention: true  };
}

export function BranchCard({ branch, onEdit }: Props) {
  const rating = safeNumber(branch.average_rating);
  const ratingCount = safeNumber(branch.rating_count);
  // Guard against legacy bug where average could be a sum.
  const displayRating = rating > 5 && ratingCount > 0 ? rating / ratingCount : rating;

  const totalEvals = safeNumber(branch.total_evaluations);
  const complaints = safeNumber(branch.complaint_count);

  const status = statusOf(displayRating);
  const cardStyle: React.CSSProperties = status.needsAttention
    ? {
        background: 'linear-gradient(180deg, #FEF8F8 0%, white 60%)',
        border: '1.5px solid var(--color-bad)',
        borderRadius: 10,
        padding: 20
      }
    : {
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 20
      };

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const del = useDeleteBranch();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  async function onDelete() {
    if (!confirm(`هل أنت متأكد من حذف "${branch.name}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    setMenuOpen(false);
    try {
      await del.mutateAsync(branch.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'تعذر حذف الفرع');
    }
  }

  const addressLine = [branch.area, branch.city].filter(Boolean).join(' · ') || 'لم يُحدّد العنوان';
  const statusDot = branch.is_active ? '· يعمل الآن' : '· غير نشط';

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold m-0 text-[var(--color-text-1)]">{branch.name}</h3>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
              style={status.badgeStyle}
            >
              {status.needsAttention ? <IconAlertTriangle size={11} /> : null}
              {status.label}
            </span>
          </div>
          <div className="mt-1 text-[12.5px] text-[var(--color-text-3)]">
            {addressLine} {statusDot}
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="خيارات"
            onClick={() => setMenuOpen(v => !v)}
            className="rounded-[7px] p-1 hover:bg-[#F4F5F7]"
          ><IconDotsVertical size={16} style={{ color: 'var(--color-text-3)' }} /></button>
          {menuOpen ? (
            <div
              className="absolute end-0 mt-1 rounded-[8px] py-1 z-10"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 4px 16px rgba(10, 14, 26, 0.08)',
                minWidth: 140
              }}
            >
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onEdit(); }}
                className="w-full text-start flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[#F4F5F7]"
                style={{ color: 'var(--color-text-1)' }}
              ><IconPencil size={13} />تعديل</button>
              <button
                type="button"
                onClick={onDelete}
                disabled={del.isPending}
                className="w-full text-start flex items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[var(--color-bad-light)] disabled:opacity-60"
                style={{ color: 'var(--color-bad)' }}
              ><IconTrash size={13} />{del.isPending ? 'جاري الحذف…' : 'حذف'}</button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Metrics row */}
      <div
        className="grid gap-3 pb-3"
        style={{ gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid var(--color-border)' }}
      >
        <Metric label="التقييم" value={
          displayRating > 0
            ? <>{displayRating.toFixed(1)} <span style={{ fontSize: 13, color: 'var(--color-text-3)', fontWeight: 400 }}>/5</span></>
            : <span style={{ color: 'var(--color-text-3)', fontWeight: 400 }}>—</span>
        } emphasized={status.needsAttention} />
        <Metric label="التقييمات" value={ratingCount > 0 ? String(ratingCount) : <span style={{ color: 'var(--color-text-3)', fontWeight: 400 }}>—</span>} />
        <Metric label="الشكاوى" value={String(complaints)} emphasized={complaints > 5} />
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-[12.5px]">
        <div style={{ color: 'var(--color-text-3)' }}>
          {totalEvals} تقييم{complaints > 0 ? ` · ${complaints} ${complaints === 1 ? 'شكوى نشطة' : 'شكاوى نشطة'}` : ''}
        </div>
        {branch.nfc_id ? (
          <span className="num text-[11.5px] text-[var(--color-text-3)]" dir="ltr">NFC: {branch.nfc_id}</span>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, emphasized }: { label: string; value: React.ReactNode; emphasized?: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium" style={{ color: 'var(--color-text-3)' }}>{label}</div>
      <div
        className="num mt-0.5"
        style={{
          fontSize: 19, fontWeight: 600,
          color: emphasized ? 'var(--color-bad)' : 'var(--color-text-1)'
        }}
      >{value}</div>
    </div>
  );
}
