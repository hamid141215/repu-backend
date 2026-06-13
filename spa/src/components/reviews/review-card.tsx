import { IconWifi, IconBrandWhatsapp, IconCornerDownLeft } from '@tabler/icons-react';
import { Stars } from './rating-overview';
import { relativeTimeAr } from '@/lib/format';
import type { ReviewRow } from '@/types/api';

interface Props {
  review: ReviewRow;
  onReply: (review: ReviewRow) => void;
}

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: 'var(--color-primary-light)', fg: 'var(--color-primary)' },
  { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: 'var(--color-good-light)', fg: '#047857' },
  { bg: 'var(--color-warn-light)', fg: '#B45309' },
  { bg: '#EDE9FE', fg: '#6D28D9' }
];

function pickPalette(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Take first two characters of the first word (works for both Arabic and Latin).
  return trimmed.slice(0, 2);
}

export function ReviewCard({ review, onReply }: Props) {
  const isNfc = review.source === 'nfc';
  const palette = pickPalette(review.name || review.phone || String(review.id));
  const branchLine = [review.branch, relativeTimeAr(review.sent_at)].filter(Boolean).join(' · ');
  const hasReply = !!(review.reply_text && review.reply_text.trim());
  const lowRating = review.rating <= 2;

  return (
    <div
      className="rounded-[10px]"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 18 }}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: palette.bg, color: palette.fg,
              fontSize: 13, fontWeight: 600
            }}
          >{initials(review.name)}</div>
          <div>
            <div className="text-[13.5px] font-medium text-[var(--color-text-1)]">{review.name || 'عميل'}</div>
            <div className="text-[11.5px] text-[var(--color-text-3)]" suppressHydrationWarning>{branchLine || '—'}</div>
          </div>
        </div>
        {isNfc ? (
          <IconWifi size={16} style={{ color: 'var(--color-primary)' }} aria-label="من NFC" />
        ) : (
          <IconBrandWhatsapp size={16} style={{ color: 'var(--color-good)' }} aria-label="من واتساب" />
        )}
      </div>

      <Stars rating={review.rating} size={14} className="mb-2" />

      <div
        className="text-[13px] leading-[1.6]"
        style={{ color: 'var(--color-text-2)' }}
      >
        {review.feedback?.trim() || <span className="text-[var(--color-text-3)] italic">لا يوجد نص مكتوب</span>}
      </div>

      {hasReply ? (
        <div
          className="mt-2.5 flex gap-2 pt-2.5"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <IconCornerDownLeft size={14} style={{ color: 'var(--color-text-3)', flexShrink: 0, marginTop: 2 }} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-[var(--color-text-1)]">ردك:</div>
            <div className="text-[12.5px] leading-[1.5]" style={{ color: 'var(--color-text-2)' }}>
              {review.reply_text}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onReply(review)}
            className="rounded-[7px] px-3 py-1.5 text-[12px] font-medium text-white"
            style={{ background: 'var(--color-primary)' }}
          >الرد على التقييم</button>
          {lowRating ? (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium"
              style={{ background: 'var(--color-bad-light)', color: '#B91C1C' }}
            >يحتاج رد</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
