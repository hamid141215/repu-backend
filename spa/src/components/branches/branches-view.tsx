'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { IconAlertTriangle, IconPlus, IconSearch, IconFileUpload, IconQrcode } from '@tabler/icons-react';
import { BranchCard } from './branch-card';
import { BranchFormModal } from './branch-form-modal';
import { CsvImportModal } from './csv-import-modal';
import { EmptyState } from '@/components/empty-state';
import { useBranches } from '@/lib/queries';
import { getApiKey } from '@/lib/auth';
import type { BranchesResponse, BranchRow } from '@/types/api';

interface Props {
  initialBranches: BranchesResponse;
}

export function BranchesView({ initialBranches }: Props) {
  const { data, isFetching, isError, refetch } = useBranches(initialBranches);
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BranchRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(() => sp.get('import') === '1');

  // Auto-open import modal when navigated with ?import=1 (from "إنشاء" menu)
  useEffect(() => {
    if (sp.get('import') === '1') {
      const next = new URLSearchParams(sp);
      next.delete('import');
      setSp(next, { replace: true });
    }
  }, [sp, setSp]);

  const items = data?.items ?? [];
  const filtered = search.trim()
    ? items.filter(b => {
        const q = search.trim().toLowerCase();
        return (b.name || '').toLowerCase().includes(q)
            || (b.city || '').toLowerCase().includes(q)
            || (b.area || '').toLowerCase().includes(q);
      })
    : items;

  const activeCount = items.filter(b => b.is_active).length;
  const ratingVolume = items.reduce((sum, branch) => sum + Number(branch.rating_count || 0), 0);
  const companyAverage = ratingVolume > 0
    ? items.reduce((sum, branch) => sum + normalizedRating(branch) * Number(branch.rating_count || 0), 0) / ratingVolume
    : 0;
  const attentionBranches = [...items]
    .filter(branch => normalizedRating(branch) > 0 && normalizedRating(branch) < companyAverage)
    .sort((a, b) => normalizedRating(a) - normalizedRating(b));

  return (
    <div className="p-7 page-shell" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">ذكاء الفروع</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            {items.length === 0
              ? 'لم يتم إضافة أي فرع بعد'
              : `${activeCount} ${activeCount === 1 ? 'فرع نشط' : 'فروع نشطة'} · مقارنة بالمؤشرات الحالية للمنشأة`}
          </p>
        </div>
      </div>

      {items.length > 0 ? (
        <section className="mb-5">
          <div className="mb-3">
            <h2 className="m-0 text-[16px] font-semibold">المؤشرات التي تحتاج انتباهًا</h2>
            <p className="m-0 mt-1 text-[12.5px] text-[var(--color-text-3)]">مقارنة مباشرة بمتوسط التقييم الحالي للمنشأة، دون مؤشر صحة إضافي</p>
          </div>
          <div className="grid gap-3 branch-summary-grid">
            <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4">
              <div className="text-[12px] text-[var(--color-text-3)]">متوسط المنشأة</div>
              <div className="num mt-1 text-[25px] font-semibold">{companyAverage ? companyAverage.toFixed(1) : '—'}<span className="text-[13px] font-normal text-[var(--color-text-3)]">/5</span></div>
            </div>
            <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4">
              <div className="text-[12px] text-[var(--color-text-3)]">فروع دون المتوسط الحالي</div>
              <div className="num mt-1 text-[25px] font-semibold">{attentionBranches.length}</div>
            </div>
            <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4">
              <div className="text-[12px] text-[var(--color-text-3)]">الشكاوى المسجلة عبر الفروع</div>
              <div className="num mt-1 text-[25px] font-semibold">{items.reduce((sum, branch) => sum + Number(branch.complaint_count || 0), 0)}</div>
            </div>
          </div>
          {attentionBranches.length > 0 ? (
            <div className="mt-3 overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-white">
              {attentionBranches.slice(0, 4).map((branch, index) => (
                <div key={branch.id} className="flex items-center gap-3 px-4 py-3" style={index ? { borderTop: '1px solid var(--color-border)' } : undefined}>
                  <IconAlertTriangle size={15} className="shrink-0 text-[var(--color-warn)]" />
                  <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{branch.name}</div>
                  <div className="text-[12px] text-[var(--color-text-3)]">{branch.complaint_count} شكوى</div>
                  <div className="num text-[13px] font-semibold">{normalizedRating(branch).toFixed(1)}/5</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3 page-header">
          <div>
            <h2 className="m-0 text-[16px] font-semibold">مقارنة الفروع</h2>
            <p className="m-0 mt-1 text-[12.5px] text-[var(--color-text-3)]">التقييمات وحجم الإشارات والشكاوى الحالية لكل فرع</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 secondary-actions">
          <a
            href={`/api/branches/qr-zip?apiKey=${encodeURIComponent(getApiKey() || '')}`}
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
            title="تنزيل QR لكل الفروع في ملف ZIP"
          ><IconQrcode size={14} />تنزيل كل QR</a>
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
          ><IconFileUpload size={14} />استيراد CSV</button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white"
            style={{ background: 'var(--color-primary)' }}
          ><IconPlus size={14} />إضافة فرع</button>
        </div>
      </div>

      {/* Search */}
      {items.length > 0 ? (
        <div className="mb-4 relative" style={{ maxWidth: 320 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في اسم الفرع أو المدينة…"
            className="w-full rounded-[7px] py-2 ps-3 pe-9 text-[13px] outline-none focus:border-[var(--color-primary)]"
            style={{ background: '#F4F5F7', border: '1px solid transparent' }}
          />
          <IconSearch size={15} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-3)' }} />
        </div>
      ) : null}

      {/* Grid / states */}
      {isError ? (
        <div className="rounded-[10px] p-5 flex items-center justify-between" style={{ background: 'var(--color-bad-light)', border: '1px solid var(--color-bad)' }}>
          <div className="text-[13px]" style={{ color: 'var(--color-bad)' }}>
            تعذر تحميل الفروع. تأكد من اتصال الخادم وحاول مرة أخرى.
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium text-white"
            style={{ background: 'var(--color-bad)' }}
          >إعادة المحاولة</button>
        </div>
      ) : isFetching && items.length === 0 ? (
        <div className="grid gap-3.5 branch-cards-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-[10px]"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', height: 168 }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[10px] p-12" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <EmptyState message={
            items.length === 0
              ? 'لم تتم إضافة أي فرع بعد. اضغط "إضافة فرع" لإنشاء أول فرع.'
              : 'لا توجد فروع مطابقة للبحث'
          } />
        </div>
      ) : (
        <div className="grid gap-3.5 branch-cards-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          {filtered.map(b => (
            <BranchCard
              key={b.id}
              branch={b}
              onEdit={() => setEditing(b)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {creating ? (
        <BranchFormModal
          mode="create"
          branch={null}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {editing ? (
        <BranchFormModal
          mode="edit"
          branch={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <CsvImportModal onClose={() => setImporting(false)} /> : null}
      </section>
    </div>
  );
}

function normalizedRating(branch: BranchRow) {
  const rating = Number(branch.average_rating || 0);
  const count = Number(branch.rating_count || 0);
  return rating > 5 && count > 0 ? rating / count : rating;
}
