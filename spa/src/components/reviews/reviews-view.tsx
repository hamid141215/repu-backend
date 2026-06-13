'use client';

import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { IconSearch, IconSend } from '@tabler/icons-react';
import { Link } from 'react-router';
import { ReviewCard } from './review-card';
import { ReplyDrawer } from './reply-drawer';
import { RatingOverview } from './rating-overview';
import { EmptyState } from '@/components/empty-state';
import { useReviews, type ReviewsQueryParams } from '@/lib/queries';
import type { ReviewsResponse, ReviewRow, DashboardSummary } from '@/types/api';

type TabKey = 'all' | '5' | 'low' | 'nfc' | 'internal';

interface Counts {
  all:      number;
  fiveStar: number;
  low:      number;
  nfc:      number;
  internal: number;
}

const TABS: Array<{ key: TabKey; label: string; countKey: keyof Counts }> = [
  { key: 'all',      label: 'الكل',         countKey: 'all'      },
  { key: '5',        label: '5 نجوم',       countKey: 'fiveStar' },
  { key: 'low',      label: 'منخفضة',       countKey: 'low'      },
  { key: 'nfc',      label: 'من NFC',       countKey: 'nfc'      },
  { key: 'internal', label: 'من الحملات',  countKey: 'internal' }
];

function tabToFilters(tab: TabKey): Pick<ReviewsQueryParams, 'min_rating' | 'max_rating' | 'source'> {
  switch (tab) {
    case '5':         return { min_rating: 5, max_rating: 5 };
    case 'low':       return { max_rating: 2 };
    case 'nfc':       return { source: 'nfc' };
    case 'internal':  return { source: 'dashboard' };
    default:          return {};
  }
}

interface Props {
  initialReviews: ReviewsResponse;
  summary: DashboardSummary | null;
}

export function ReviewsView({ initialReviews, summary }: Props) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const tab    = (sp.get('tab') as TabKey | null) ?? 'all';
  const q      = sp.get('q') ?? '';
  const page   = Math.max(1, Number(sp.get('page')) || 1);
  const [searchInput, setSearchInput] = useState(q);
  const [replyTarget, setReplyTarget] = useState<ReviewRow | null>(null);

  const filters: ReviewsQueryParams = useMemo(() => ({
    page, pageSize: 24, ...tabToFilters(tab), q: q || undefined
  }), [page, tab, q]);

  // Server-rendered initial data only applies when no filters are active.
  const isInitialFilter = tab === 'all' && page === 1 && !q;
  const reviewsQuery = useReviews(filters, isInitialFilter ? initialReviews : undefined);

  const updateUrl = useCallback((next: Partial<{ tab: TabKey; q: string; page: number }>) => {
    const params = new URLSearchParams(sp.toString());
    if (next.tab !== undefined)  next.tab === 'all' ? params.delete('tab') : params.set('tab', next.tab);
    if (next.q   !== undefined)  next.q   === ''    ? params.delete('q')   : params.set('q', next.q);
    if (next.page !== undefined) (next.page <= 1)   ? params.delete('page'): params.set('page', String(next.page));
    // Any tab/search change resets to page 1
    if (next.tab !== undefined || next.q !== undefined) params.delete('page');
    navigate(`/reviews?${params.toString()}`);
  }, [navigate, sp]);

  const counts: Counts = useMemo(() => computeCounts(summary), [summary]);

  const data = reviewsQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const isLoading = reviewsQuery.isFetching && !data;
  const isError = reviewsQuery.isError;

  const average = summary?.average_rating ?? 0;
  const ratingCount = summary?.rating_count ?? 0;
  const breakdown = summary?.rating_breakdown ?? [];

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">التقييمات</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            {ratingCount > 0
              ? `${ratingCount} تقييم من جميع الفروع · متوسط ${average.toFixed(1)} من 5`
              : 'لم تُسجَّل أي تقييمات بعد'}
          </p>
        </div>
        <Link
          to="/campaigns"
          className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white"
          style={{ background: 'var(--color-primary)' }}
        ><IconSend size={14} />إرسال طلب تقييم</Link>
      </div>

      {summary ? <RatingOverview average={average} count={ratingCount} breakdown={breakdown} /> : null}

      {/* Tabs */}
      <div
        className="mb-5 flex gap-1"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => updateUrl({ tab: t.key })}
              className="px-3.5 py-2 text-[13px] font-medium transition"
              style={{
                marginBottom: -1,
                borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
                cursor: 'pointer'
              }}
            >{t.label} ({counts[t.countKey]})</button>
          );
        })}
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => { e.preventDefault(); updateUrl({ q: searchInput.trim() }); }}
        className="mb-4 relative"
        style={{ maxWidth: 360 }}
      >
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="بحث في الاسم أو نص التقييم أو الفرع…"
          className="w-full rounded-[7px] py-2 ps-3 pe-9 text-[13px] outline-none focus:border-[var(--color-primary)]"
          style={{ background: '#F4F5F7', border: '1px solid transparent' }}
        />
        <IconSearch size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-3)' }} />
      </form>

      {/* List */}
      {isError ? (
        <ErrorBlock onRetry={() => reviewsQuery.refetch()} />
      ) : isLoading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState message={q ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد تقييمات مطابقة'} />
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {items.map(r => (
              <ReviewCard key={r.id} review={r} onReply={setReplyTarget} />
            ))}
          </div>
          <Pagination
            page={page}
            hasMore={hasMore}
            total={total}
            onChange={(p) => updateUrl({ page: p })}
          />
        </>
      )}

      <ReplyDrawer review={replyTarget} onClose={() => setReplyTarget(null)} />
    </div>
  );
}

function computeCounts(summary: DashboardSummary | null): Counts {
  if (!summary) return { all: 0, fiveStar: 0, low: 0, nfc: 0, internal: 0 };
  const all = summary.rating_count ?? 0;
  const fiveStar = summary.rating_breakdown?.find(r => r.rating === 5)?.count ?? 0;
  const low = ['rating_breakdown' in summary ? summary.rating_breakdown : []].flat()
    .filter(r => r.rating <= 2).reduce((s, r) => s + r.count, 0);
  const sources = summary.source_breakdown ?? [];
  const nfc = sources.find(s => s.source === 'nfc')?.total ?? 0;
  // "internal" tab = source = 'dashboard'; other unknown sources count as 0.
  const internal = sources.find(s => s.source === 'dashboard')?.total ?? 0;
  return { all, fiveStar, low, nfc, internal };
}

function Pagination({ page, hasMore, total, onChange }: { page: number; hasMore: boolean; total: number; onChange: (p: number) => void }) {
  if (total <= 24) return null;
  return (
    <div className="mt-5 flex items-center justify-between">
      <div className="text-[12.5px] text-[var(--color-text-3)]" dir="ltr">
        {(page - 1) * 24 + 1}–{Math.min(page * 24, total)} of {total}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-[7px] border px-3 py-1 text-[12.5px] disabled:opacity-40"
          style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text-1)' }}
        >السابق</button>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => onChange(page + 1)}
          className="rounded-[7px] border px-3 py-1 text-[12.5px] disabled:opacity-40"
          style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text-1)' }}
        >التالي</button>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[10px] animate-pulse"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 18, height: 168 }}
        />
      ))}
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="rounded-[10px] flex items-center justify-between"
      style={{
        background: 'var(--color-bad-light)',
        border: '1px solid var(--color-bad)',
        padding: '14px 18px'
      }}
    >
      <div className="text-[13px]" style={{ color: 'var(--color-bad)' }}>
        تعذر تحميل التقييمات. تأكد من اتصال الخادم وحاول مرة أخرى.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium text-white"
        style={{ background: 'var(--color-bad)' }}
      >إعادة المحاولة</button>
    </div>
  );
}
