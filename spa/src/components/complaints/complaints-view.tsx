'use client';

import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { IconSearch, IconFilter, IconDownload, IconFlag } from '@tabler/icons-react';
import { ComplaintRow } from './complaint-row';
import { ComplaintDetailDrawer } from './complaint-detail-drawer';
import { EmptyState } from '@/components/empty-state';
import { useComplaints, type ComplaintsQueryParams } from '@/lib/queries';
import type { ComplaintsResponse, DashboardSummary } from '@/types/api';

type StatusTab = 'all' | 'new' | 'in_progress' | 'resolved';

const TABS: Array<{ key: StatusTab; label: string }> = [
  { key: 'all',         label: 'الكل' },
  { key: 'new',         label: 'جديدة' },
  { key: 'in_progress', label: 'قيد المعالجة' },
  { key: 'resolved',    label: 'مُحلّت' }
];

interface Props {
  initialComplaints: ComplaintsResponse;
  summary: DashboardSummary | null;
}

export function ComplaintsView({ initialComplaints, summary }: Props) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const status   = (sp.get('status') as StatusTab | null) ?? 'all';
  const priority = sp.get('priority') ?? '';
  const branch   = sp.get('branch')   ?? '';
  const q        = sp.get('q')        ?? '';
  const page     = Math.max(1, Number(sp.get('page')) || 1);

  const [searchInput, setSearchInput] = useState(q);
  const [detailId, setDetailId] = useState<number | null>(null);

  const filters: ComplaintsQueryParams = useMemo(() => ({
    page, pageSize: 20,
    status: status === 'all' ? undefined : status,
    priority: priority || undefined,
    branch: branch || undefined,
    q: q || undefined
  }), [page, status, priority, branch, q]);

  const isInitial = status === 'all' && !priority && !branch && !q && page === 1;
  const query = useComplaints(filters, isInitial ? initialComplaints : undefined);

  const updateUrl = useCallback((next: Partial<{ status: StatusTab; priority: string; branch: string; q: string; page: number }>) => {
    const params = new URLSearchParams(sp.toString());
    if (next.status !== undefined)   next.status === 'all' ? params.delete('status')   : params.set('status', next.status);
    if (next.priority !== undefined) next.priority === ''  ? params.delete('priority') : params.set('priority', next.priority);
    if (next.branch !== undefined)   next.branch === ''    ? params.delete('branch')   : params.set('branch', next.branch);
    if (next.q !== undefined)        next.q === ''         ? params.delete('q')        : params.set('q', next.q);
    if (next.page !== undefined)     (next.page <= 1)      ? params.delete('page')     : params.set('page', String(next.page));
    if (next.status !== undefined || next.priority !== undefined || next.branch !== undefined || next.q !== undefined) {
      params.delete('page');
    }
    navigate(`/complaints?${params.toString()}`);
  }, [navigate, sp]);

  const counts = useMemo(() => {
    const w = summary?.complaint_workflow_summary;
    return {
      all:         (w?.new_count ?? 0) + (w?.in_progress_count ?? 0) + (w?.contacted_count ?? 0) + (w?.resolved_count ?? 0) + (w?.closed_count ?? 0),
      new:         w?.new_count ?? 0,
      in_progress: (w?.in_progress_count ?? 0) + (w?.contacted_count ?? 0),
      resolved:    (w?.resolved_count ?? 0) + (w?.closed_count ?? 0),
      urgent:      w?.overdue_count ?? 0
    };
  }, [summary]);

  // Build distinct branch list from summary.branch_performance for filter chips.
  const branchOptions = useMemo(() => {
    const arr = summary?.branch_performance ?? [];
    return arr.map(b => b.branch).filter(Boolean);
  }, [summary]);

  const data = query.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const isLoading = query.isFetching && !data;
  const isError = query.isError;

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      {/* Page header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">مركز الشكاوى</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            {counts.all > 0
              ? `${counts.all} شكوى مسجّلة${branchOptions.length ? ` عبر ${branchOptions.length} فروع` : ''}`
              : 'لم يتم تسجيل أي شكاوى بعد'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="قريباً"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          ><IconFilter size={14} />تصفية</button>
          <button
            type="button"
            disabled
            title="قريباً"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          ><IconDownload size={14} />تصدير</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {TABS.map(t => {
          const active = status === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => updateUrl({ status: t.key })}
              className="px-3.5 py-2 text-[13px] font-medium transition"
              style={{
                marginBottom: -1,
                borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
                cursor: 'pointer'
              }}
            >
              {t.label}{' '}
              {t.key === 'new' && count > 0 ? (
                <span
                  className="num inline-flex items-center rounded-full px-1.5 py-0 text-[11px] font-medium leading-[1.4] text-white"
                  style={{ background: 'var(--color-bad)' }}
                >{count}</span>
              ) : (
                <span className="num text-[11px] text-[var(--color-text-3)] mr-1">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter chips: urgent + branches */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Chip
          active={priority === 'urgent'}
          onClick={() => updateUrl({ priority: priority === 'urgent' ? '' : 'urgent' })}
        >
          <IconFlag size={12} />
          <span>عاجلة{counts.urgent > 0 ? ` (${counts.urgent})` : ''}</span>
        </Chip>
        {branchOptions.slice(0, 5).map(b => (
          <Chip
            key={b}
            active={branch === b}
            onClick={() => updateUrl({ branch: branch === b ? '' : b })}
          >{b}</Chip>
        ))}
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
          placeholder="بحث في الاسم أو نص الشكوى أو الفرع…"
          className="w-full rounded-[7px] py-2 ps-3 pe-9 text-[13px] outline-none focus:border-[var(--color-primary)]"
          style={{ background: '#F4F5F7', border: '1px solid transparent' }}
        />
        <IconSearch size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-3)' }} />
      </form>

      {/* Table */}
      <div className="rounded-[10px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {isError ? (
          <div className="p-6"><EmptyState message="تعذر تحميل الشكاوى. تأكد من اتصال الخادم وحاول مرة أخرى." /></div>
        ) : isLoading ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <div className="p-8"><EmptyState message={q ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد شكاوى ضمن هذه التصفية'} /></div>
        ) : (
          <table className="w-full text-start" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFBFC', borderBottom: '1px solid var(--color-border)' }}>
                <Th>الشكوى</Th>
                <Th>العميل</Th>
                <Th>الفرع</Th>
                <Th>الأولوية</Th>
                <Th>الحالة</Th>
                <Th>الوقت</Th>
                <Th right />
              </tr>
            </thead>
            <tbody>
              {items.map((c, idx) => (
                <ComplaintRow
                  key={c.id}
                  complaint={c}
                  last={idx === items.length - 1}
                  onOpen={() => setDetailId(c.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > 20 ? (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[12.5px] text-[var(--color-text-3)]" dir="ltr">
            {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateUrl({ page: page - 1 })}
              className="rounded-[7px] border px-3 py-1 text-[12.5px] disabled:opacity-40"
              style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text-1)' }}
            >السابق</button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => updateUrl({ page: page + 1 })}
              className="rounded-[7px] border px-3 py-1 text-[12.5px] disabled:opacity-40"
              style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-surface)', color: 'var(--color-text-1)' }}
            >التالي</button>
          </div>
        </div>
      ) : null}

      <ComplaintDetailDrawer
        complaintId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className="text-start px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.4px]"
      style={{ color: 'var(--color-text-3)', width: right ? 40 : undefined }}
    >{children}</th>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition"
      style={{
        background: active ? 'var(--color-primary-light)' : '#F4F5F7',
        color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
        border: '1px solid transparent',
        cursor: 'pointer'
      }}
    >{children}</button>
  );
}

function TableSkeleton() {
  return (
    <div className="p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[7px] mb-2"
          style={{ height: 56, background: '#F4F5F7' }}
        />
      ))}
    </div>
  );
}
