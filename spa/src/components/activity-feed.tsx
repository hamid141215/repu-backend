'use client';

import { IconAlertTriangle, IconStar, IconStarFilled, IconMessageCircle, IconMoodNeutral, IconWifi } from '@tabler/icons-react';
import { useActivity } from '@/lib/queries';
import { relativeTimeAr } from '@/lib/format';
import { EmptyState } from '@/components/empty-state';
import type { ActivityItem } from '@/types/api';

export function ActivityFeed({ initial }: { initial: ActivityItem[] }) {
  const { data } = useActivity({ items: initial }, 5);

  const items = data?.items ?? [];

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col">
      {items.map((it, idx) => {
        const { icon, bg, color } = iconFor(it);
        const label = labelFor(it);
        const subtitle = subtitleFor(it);
        return (
          <div
            key={it.id}
            className="flex gap-2.5 py-2.5"
            style={{ borderBottom: idx === items.length - 1 ? 'none' : '1px solid var(--color-border)' }}
          >
            <div
              className="flex shrink-0 items-center justify-center"
              style={{ width: 28, height: 28, borderRadius: 8, background: bg, color }}
            >
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--color-text-1)] truncate">{label}</div>
              <div className="mt-0.5 text-[12px] text-[var(--color-text-3)] truncate" suppressHydrationWarning>{subtitle}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function iconFor(it: ActivityItem) {
  if (it.status === 'complaint' || it.answer === '2') {
    return { icon: <IconAlertTriangle size={14} />, bg: 'var(--color-bad-light)', color: 'var(--color-bad)' };
  }
  if (it.rating != null && it.rating >= 4) {
    return { icon: <IconStarFilled size={14} />, bg: 'var(--color-good-light)', color: 'var(--color-good)' };
  }
  if (it.rating != null && it.rating === 3) {
    return { icon: <IconMoodNeutral size={14} />, bg: 'var(--color-warn-light)', color: 'var(--color-warn)' };
  }
  if (it.source === 'nfc') {
    return { icon: <IconWifi size={14} />, bg: 'var(--color-primary-light)', color: 'var(--color-primary)' };
  }
  if (it.status === 'replied' && it.answer === '1') {
    return { icon: <IconStar size={14} />, bg: 'var(--color-good-light)', color: 'var(--color-good)' };
  }
  return { icon: <IconMessageCircle size={14} />, bg: 'var(--color-primary-light)', color: 'var(--color-primary)' };
}

function labelFor(it: ActivityItem): string {
  if (it.status === 'complaint' || it.answer === '2') {
    return it.branch ? `شكوى جديدة — ${it.branch}` : 'شكوى جديدة';
  }
  if (it.rating != null) {
    const stars = `تقييم ${it.rating} ${it.rating === 1 ? 'نجمة' : 'نجوم'}`;
    return it.branch ? `${stars} — ${it.branch}` : stars;
  }
  if (it.source === 'nfc') {
    return it.branch ? `لمسة NFC جديدة — ${it.branch}` : 'لمسة NFC جديدة';
  }
  return it.branch ? `نشاط — ${it.branch}` : 'نشاط';
}

function subtitleFor(it: ActivityItem): string {
  const when = relativeTimeAr(it.sent_at);
  const who = it.name ? ` · ${it.name}` : '';
  return `${when}${who}`;
}
