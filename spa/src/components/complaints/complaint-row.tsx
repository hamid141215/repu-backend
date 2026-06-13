'use client';

import { IconDotsVertical } from '@tabler/icons-react';
import { TimeAgo } from '@/components/time-ago';
import type { ComplaintListItem } from '@/types/api';

interface Props {
  complaint: ComplaintListItem;
  last: boolean;
  onOpen: () => void;
}

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: 'var(--color-primary-light)', fg: 'var(--color-primary)' },
  { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: '#D1FAE5', fg: '#047857' },
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#EDE9FE', fg: '#6D28D9' }
];

function pickPalette(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string | null): string {
  if (!name) return '؟';
  return name.trim().slice(0, 2) || '؟';
}

function maskPhone(p: string | null): string {
  if (!p) return '';
  const cleaned = p.replace(/\s+/g, '');
  if (cleaned.length < 7) return cleaned;
  // +966 5X ••• XXXX
  return `${cleaned.slice(0, 6)} ••• ${cleaned.slice(-4)}`;
}

function previewText(s: string | null): string {
  if (!s) return 'لا يوجد نص شكوى مسجل';
  const t = s.trim();
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

const PRIO_LABEL: Record<string, string> = {
  urgent: 'عاجلة',
  medium: 'متوسطة',
  low:    'منخفضة',
  closed: 'مُغلقة'
};
const PRIO_COLOR: Record<string, string> = {
  urgent: 'var(--color-bad)',
  medium: 'var(--color-warn)',
  low:    'var(--color-text-3)',
  closed: 'var(--color-text-4)'
};

const STATUS_LABEL: Record<string, string> = {
  new:         'جديدة',
  contacted:   'تم التواصل',
  in_progress: 'قيد المعالجة',
  resolved:    'حُلّت',
  closed:      'مُغلقة'
};
const STATUS_STYLE: Record<string, React.CSSProperties> = {
  new:         { background: 'var(--color-bad-light)',     color: '#B91C1C' },
  contacted:   { background: '#DBEAFE',                    color: '#1E40AF' },
  in_progress: { background: 'var(--color-primary-light)', color: 'var(--color-primary)' },
  resolved:    { background: 'var(--color-good-light)',    color: '#047857' },
  closed:      { background: '#F1F3F5',                    color: 'var(--color-text-2)' }
};

export function ComplaintRow({ complaint, last, onOpen }: Props) {
  const palette = pickPalette(complaint.name || complaint.phone || String(complaint.id));
  const statusKey = complaint.complaint_status || 'new';
  const statusLabel = STATUS_LABEL[statusKey] || statusKey;
  const statusStyle = STATUS_STYLE[statusKey] || STATUS_STYLE.new;

  const prioKey = complaint.priority || (complaint.is_overdue ? 'urgent' : 'medium');
  const prioLabel = PRIO_LABEL[prioKey] || PRIO_LABEL.medium;
  const prioColor = PRIO_COLOR[prioKey] || PRIO_COLOR.medium;

  return (
    <tr
      className="hover:bg-[#FAFBFC] cursor-pointer"
      onClick={onOpen}
      style={{ borderBottom: last ? 'none' : '1px solid var(--color-border)' }}
    >
      <td className="px-4 py-3">
        <div className="text-[13px] font-medium text-[var(--color-text-1)]">
          #{complaint.id}
        </div>
        <div className="mt-0.5 text-[12px] truncate" style={{ maxWidth: 260, color: 'var(--color-text-3)' }}>
          {previewText(complaint.feedback)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: palette.bg, color: palette.fg,
              fontSize: 11.5, fontWeight: 600
            }}
          >{initials(complaint.name)}</div>
          <div className="min-w-0">
            <div className="text-[13px] text-[var(--color-text-1)] truncate" style={{ maxWidth: 140 }}>
              {complaint.name || 'عميل'}
            </div>
            <div className="num text-[11.5px] text-[var(--color-text-3)]" dir="ltr">{maskPhone(complaint.phone)}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {complaint.branch ? (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
            style={{ background: '#F1F3F5', color: 'var(--color-text-2)' }}
          >{complaint.branch}</span>
        ) : (
          <span className="text-[12px] text-[var(--color-text-3)]">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block"
            style={{ width: 7, height: 7, borderRadius: '50%', background: prioColor }}
          />
          <span className="text-[12.5px]" style={{ color: 'var(--color-text-2)' }}>{prioLabel}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
          style={statusStyle}
        >{statusLabel}</span>
      </td>
      <td className="px-4 py-3 num text-[12px] text-[var(--color-text-3)]">
        <TimeAgo at={complaint.sent_at} />
      </td>
      <td className="px-4 py-3 text-start">
        <IconDotsVertical size={15} style={{ color: 'var(--color-text-3)' }} />
      </td>
    </tr>
  );
}
