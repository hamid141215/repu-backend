'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  IconAlertTriangle, IconBuildingStore, IconMessageCircle,
  IconSearch, IconStar, IconX
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { useComplaints, useReviews } from '@/lib/queries';
import { relativeTimeAr } from '@/lib/format';
import { EmptyState } from '@/components/empty-state';
import { ComplaintDetailDrawer } from '@/components/complaints/complaint-detail-drawer';
import { ReplyDrawer } from '@/components/reviews/reply-drawer';
import type { ComplaintListItem, DashboardSummary, ReviewRow } from '@/types/api';

type SignalType = 'all' | 'reviews' | 'complaints';
type UnifiedSignal =
  | { kind: 'review'; item: ReviewRow }
  | { kind: 'complaint'; item: ComplaintListItem };

const TYPE_TABS: Array<{ key: SignalType; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'reviews', label: 'التقييمات' },
  { key: 'complaints', label: 'الشكاوى' }
];

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'new', label: 'جديدة' },
  { value: 'in_progress,contacted', label: 'قيد المتابعة' },
  { value: 'resolved,closed', label: 'مغلقة أو محلولة' }
];

export function SignalsView() {
  const [sp, setSp] = useSearchParams();
  const type = normalizeType(sp.get('type'));
  const branch = sp.get('branch') ?? '';
  const source = sp.get('source') ?? '';
  const rating = sp.get('rating') ?? '';
  const status = sp.get('status') ?? '';
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const [search, setSearch] = useState(q);
  const [reviewTarget, setReviewTarget] = useState<ReviewRow | null>(null);
  const [complaintId, setComplaintId] = useState<number | null>(null);

  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 60_000
  });
  const reviewsQ = useReviews({
    page,
    pageSize: 24,
    branch: branch || undefined,
    source: source || undefined,
    min_rating: rating && rating !== 'low' ? Number(rating) : undefined,
    max_rating: rating === 'low' ? 2 : rating ? Number(rating) : undefined,
    q: q || undefined
  });
  const complaintsQ = useComplaints({
    page,
    pageSize: 24,
    branch: branch || undefined,
    source: source || undefined,
    min_rating: rating && rating !== 'low' ? Number(rating) : undefined,
    max_rating: rating === 'low' ? 2 : rating ? Number(rating) : undefined,
    status: status || undefined,
    q: q || undefined
  });

  const branchOptions = useMemo(
    () => (summaryQ.data?.branch_performance ?? []).map(item => item.branch).filter(Boolean),
    [summaryQ.data]
  );
  const sourceOptions = useMemo(() => {
    const sources = new Set<string>();
    for (const row of summaryQ.data?.source_breakdown ?? []) if (row.source) sources.add(row.source);
    for (const row of complaintsQ.data?.items ?? []) if (row.source) sources.add(row.source);
    return Array.from(sources);
  }, [summaryQ.data, complaintsQ.data]);

  const signals = useMemo(() => {
    const complaints = complaintsQ.data?.items ?? [];
    const reviews = reviewsQ.data?.items ?? [];
    const merged: UnifiedSignal[] = [];
    if (type !== 'reviews') merged.push(...complaints.map(item => ({ kind: 'complaint' as const, item })));
    if (type !== 'complaints' && !status) merged.push(...reviews.map(item => ({ kind: 'review' as const, item })));
    return merged.sort((a, b) => new Date(b.item.sent_at).getTime() - new Date(a.item.sent_at).getTime());
  }, [complaintsQ.data, reviewsQ.data, status, type]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSp(next, { replace: true });
  }

  function changeType(nextType: SignalType) {
    const next = new URLSearchParams(sp);
    if (nextType === 'all') next.delete('type');
    else next.set('type', nextType);
    if (nextType === 'reviews') next.delete('status');
    next.delete('page');
    setSp(next, { replace: true });
  }

  const isLoading = reviewsQ.isLoading || complaintsQ.isLoading;
  const isError = reviewsQ.isError || complaintsQ.isError;
  const hasFilters = Boolean(branch || source || rating || status || q);
  const hasMore = type === 'reviews'
    ? Boolean(reviewsQ.data?.hasMore)
    : type === 'complaints'
      ? Boolean(complaintsQ.data?.hasMore)
      : Boolean(reviewsQ.data?.hasMore || complaintsQ.data?.hasMore);

  return (
    <div className="p-7 page-shell" style={{ maxWidth: 1400 }}>
      <header className="mb-5">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)]">الإشارات</h1>
        <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
          صوت العميل من التقييمات والشكاوى في مسار موحّد
        </p>
      </header>

      <div className="mb-4 flex gap-1 border-b border-[var(--color-border)]">
        {TYPE_TABS.map(tab => (
          <button key={tab.key} type="button" onClick={() => changeType(tab.key)}
            className="px-3.5 py-2 text-[13px] font-medium"
            style={{
              marginBottom: -1,
              borderBottom: `2px solid ${type === tab.key ? 'var(--color-primary)' : 'transparent'}`,
              color: type === tab.key ? 'var(--color-primary)' : 'var(--color-text-2)'
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <form onSubmit={(event) => { event.preventDefault(); update('q', search.trim()); }} className="relative min-w-[260px] flex-1">
          <input value={search} onChange={event => setSearch(event.target.value)}
            placeholder="بحث في نص الإشارة أو الفرع…"
            className="w-full rounded-[7px] border border-transparent bg-[#F4F5F7] py-2 ps-3 pe-9 text-[13px] outline-none focus:border-[var(--color-primary)]" />
          {search ? (
            <button type="button" aria-label="مسح البحث" onClick={() => { setSearch(''); update('q', ''); }}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]"><IconX size={14} /></button>
          ) : <IconSearch size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />}
        </form>
        <FilterSelect label="كل الفروع" value={branch} onChange={value => update('branch', value)} options={branchOptions.map(value => ({ value, label: value }))} />
        <FilterSelect label="كل المصادر" value={source} onChange={value => update('source', value)} options={sourceOptions.map(value => ({ value, label: sourceLabel(value) }))} />
        {type !== 'complaints' ? (
          <FilterSelect label="كل التقييمات" value={rating} onChange={value => update('rating', value)}
            options={[{ value: 'low', label: 'منخفضة (1–2)' }, ...[5, 4, 3, 2, 1].map(value => ({ value: String(value), label: `${value} نجوم` }))]} />
        ) : null}
        {type !== 'reviews' ? (
          <FilterSelect label="كل الحالات" value={status} onChange={value => update('status', value)} options={STATUS_OPTIONS.slice(1)} />
        ) : null}
        {hasFilters ? (
          <button type="button" onClick={() => { setSearch(''); setSp(type === 'all' ? {} : { type }, { replace: true }); }}
            className="px-2 py-1 text-[12px] font-medium text-[var(--color-primary)]">مسح الفلاتر</button>
        ) : null}
      </div>

      {isError ? (
        <div className="rounded-[10px] border border-[var(--color-bad)] bg-[var(--color-bad-light)] p-6"><EmptyState message="تعذر تحميل الإشارات. حاول مرة أخرى." /></div>
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-[10px] bg-white" />)}</div>
      ) : signals.length === 0 ? (
        <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-10"><EmptyState message="لا توجد إشارات مطابقة للتصفية الحالية" /></div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          {signals.map((signal, index) => (
            <SignalRow key={`${signal.kind}-${signal.item.id}`} signal={signal} last={index === signals.length - 1}
              onReview={() => signal.kind === 'review' && setReviewTarget(signal.item)}
              onComplaint={() => signal.kind === 'complaint' && setComplaintId(signal.item.id)} />
          ))}
        </div>
      )}

      {!isLoading && !isError && (page > 1 || hasMore) ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] text-[var(--color-text-3)]">الصفحة {page}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => update('page', String(page - 1))}
              className="rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-[12.5px] disabled:opacity-40">السابق</button>
            <button type="button" disabled={!hasMore} onClick={() => update('page', String(page + 1))}
              className="rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-[12.5px] disabled:opacity-40">التالي</button>
          </div>
        </div>
      ) : null}

      <ReplyDrawer review={reviewTarget} onClose={() => setReviewTarget(null)} />
      <ComplaintDetailDrawer complaintId={complaintId} onClose={() => setComplaintId(null)} />
    </div>
  );
}

function SignalRow({ signal, last, onReview, onComplaint }: {
  signal: UnifiedSignal; last: boolean; onReview: () => void; onComplaint: () => void;
}) {
  const complaint = signal.kind === 'complaint';
  const item = signal.item;
  const rating = 'rating' in item ? item.rating : null;
  const feedback = item.feedback?.trim() || 'لا يوجد نص مكتوب';
  return (
    <button type="button" onClick={complaint ? onComplaint : onReview}
      className="flex w-full items-start gap-3 p-4 text-start transition hover:bg-[#FAFBFC]"
      style={last ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"
        style={{ background: complaint ? 'var(--color-bad-light)' : 'var(--color-primary-light)', color: complaint ? 'var(--color-bad)' : 'var(--color-primary)' }}>
        {complaint ? <IconAlertTriangle size={17} /> : <IconMessageCircle size={17} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11.5px] font-medium" style={{ background: complaint ? 'var(--color-bad-light)' : 'var(--color-primary-light)', color: complaint ? 'var(--color-bad)' : 'var(--color-primary)' }}>
            {complaint ? 'شكوى' : 'تقييم'}
          </span>
          <span className="text-[11.5px] text-[var(--color-text-3)]">{sourceLabel(item.source)}</span>
          {item.branch ? <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-text-3)]"><IconBuildingStore size={12} />{item.branch}</span> : null}
          <span className="text-[11.5px] text-[var(--color-text-3)]">{relativeTimeAr(item.sent_at)}</span>
        </span>
        <span className="mt-2 line-clamp-2 block text-[13.5px] leading-[1.7] text-[var(--color-text-1)]">{feedback}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2">
          {rating != null ? <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-text-2)]"><IconStar size={13} />{rating}/5</span> : null}
          {complaint ? <StatusBadge value={signal.item.complaint_status || signal.item.status} /> : null}
        </span>
      </span>
      <span className="self-center text-[12px] font-medium text-[var(--color-primary)]">عرض التفاصيل</span>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)}
      className="rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[12.5px] text-[var(--color-text-2)] outline-none">
      <option value="">{label}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function StatusBadge({ value }: { value: string | null }) {
  const labels: Record<string, string> = { new: 'جديدة', contacted: 'تم التواصل', in_progress: 'قيد المعالجة', resolved: 'حُلّت', closed: 'مغلقة', complaint: 'جديدة' };
  return <span className="rounded-full bg-[#F4F5F7] px-2 py-0.5 text-[11.5px] font-medium text-[var(--color-text-2)]">{labels[value || ''] || value || 'غير محددة'}</span>;
}

function sourceLabel(source: string | null) {
  if (source === 'nfc') return 'NFC / QR';
  if (source === 'dashboard') return 'طلبات التقييم';
  if (source === 'whatsapp') return 'WhatsApp';
  return source || 'غير محدد';
}

function normalizeType(value: string | null): SignalType {
  return value === 'reviews' || value === 'complaints' ? value : 'all';
}
