'use client';

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { IconSearch, IconDownload, IconDotsVertical, IconQrcode, IconPlus } from '@tabler/icons-react';
import { NfcCard } from './nfc-card';
import { EmptyState } from '@/components/empty-state';
import { useBranches } from '@/lib/queries';
import { safeNumber } from '@/lib/format';
import { TimeAgo } from '@/components/time-ago';
import type { BranchesResponse, BranchRow } from '@/types/api';

interface Props {
  initialBranches: BranchesResponse;
}

export function NfcView({ initialBranches }: Props) {
  const { data, isFetching, isError } = useBranches(initialBranches);
  const branches = data?.items ?? [];
  const [search, setSearch] = useState('');

  // KPIs derived from real data — fields we don't have show "—".
  const kpis = useMemo(() => {
    const withNfc = branches.filter(b => b.nfc_id);
    const active = withNfc.filter(b => b.is_active);
    return {
      total: withNfc.length,
      active: active.length,
      todayTouches: null as number | null,   // not in API
      conversion: null as number | null      // not in API
    };
  }, [branches]);

  const withNfc = branches.filter(b => b.nfc_id);
  const filtered = search.trim()
    ? withNfc.filter(b => {
        const q = search.trim().toLowerCase();
        return (b.name || '').toLowerCase().includes(q)
            || (b.city || '').toLowerCase().includes(q)
            || (b.nfc_id || '').toLowerCase().includes(q);
      })
    : withNfc;

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">بطاقات NFC</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">إدارة البطاقات الذكية الموزعة في الفروع</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="قريباً"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          ><IconQrcode size={14} />إنشاء QR</button>
          <Link
            to="/branches"
            className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white"
            style={{ background: 'var(--color-primary)' }}
          ><IconPlus size={14} />بطاقة جديدة</Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi label="إجمالي البطاقات" value={kpis.total.toString()} />
        <Kpi label="نشطة" value={kpis.active.toString()} valueColor="var(--color-good)" />
        <Kpi label="لمسات اليوم" value={<span className="text-[var(--color-text-3)] text-[15px]">—</span>} hint="لا توجد بيانات متاحة حالياً" />
        <Kpi label="معدل التحويل" value={<span className="text-[var(--color-text-3)] text-[15px]">—</span>} hint="لا توجد بيانات متاحة حالياً" />
      </div>

      {/* Card visuals */}
      {isError ? (
        <div className="rounded-[10px] p-5" style={{ background: 'var(--color-bad-light)', border: '1px solid var(--color-bad)', color: 'var(--color-bad)', fontSize: 13 }}>
          تعذر تحميل الفروع. تأكد من اتصال الخادم وحاول مرة أخرى.
        </div>
      ) : isFetching && branches.length === 0 ? (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-[12px]" style={{ height: 168, background: '#0F172A', opacity: 0.15 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[10px] p-10" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <EmptyState message={
            withNfc.length === 0
              ? 'لا توجد بطاقات NFC مرتبطة بفروعك بعد. أضف فرعاً أولاً من قسم الفروع.'
              : 'لا توجد نتائج مطابقة للبحث'
          } />
        </div>
      ) : (
        <>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {filtered.slice(0, 9).map(b => (
              <NfcCard key={b.id} branch={b} />
            ))}
          </div>

          {/* All cards table */}
          <div className="mt-6 rounded-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <h3 className="text-[15px] font-semibold m-0 text-[var(--color-text-1)]">جميع البطاقات</h3>
              <div className="relative" style={{ width: 220 }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث…"
                  className="w-full rounded-[7px] py-1.5 ps-3 pe-9 text-[13px] outline-none focus:border-[var(--color-primary)]"
                  style={{ background: '#F4F5F7', border: '1px solid transparent' }}
                />
                <IconSearch size={14} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-3)' }} />
              </div>
            </div>

            <table className="w-full text-start" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#FAFBFC', borderBottom: '1px solid var(--color-border)' }}>
                  <Th>الاسم</Th>
                  <Th>المدينة</Th>
                  <Th>المعرّف</Th>
                  <Th>اللمسات</Th>
                  <Th>التحويل</Th>
                  <Th>آخر نشاط</Th>
                  <Th>الحالة</Th>
                  <Th right />
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, idx) => <NfcRow key={b.id} branch={b} last={idx === filtered.length - 1} />)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, valueColor, hint }: { label: string; value: React.ReactNode; valueColor?: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '18px 20px' }}>
      <div className="text-[12.5px] font-medium text-[var(--color-text-2)]">{label}</div>
      <div className="num mt-1 text-[28px] font-semibold tracking-[-0.5px]" style={{ color: valueColor ?? 'var(--color-text-1)' }}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-[var(--color-text-3)]">{hint}</div> : null}
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

function NfcRow({ branch, last }: { branch: BranchRow; last: boolean }) {
  return (
    <tr style={{ borderBottom: last ? 'none' : '1px solid var(--color-border)' }}>
      <td className="px-4 py-3 text-[13px] font-medium text-[var(--color-text-1)]">{branch.name}</td>
      <td className="px-4 py-3 text-[12.5px]" style={{ color: 'var(--color-text-2)' }}>{branch.city || '—'}</td>
      <td className="px-4 py-3 num text-[12px]" style={{ color: 'var(--color-text-3)' }} dir="ltr">{branch.nfc_id}</td>
      <td className="px-4 py-3 num text-[13px]" style={{ color: 'var(--color-text-2)' }}>
        {safeNumber(branch.total_evaluations) || <span className="text-[var(--color-text-3)]">—</span>}
      </td>
      <td className="px-4 py-3 num text-[13px]" style={{ color: 'var(--color-text-3)' }}>—</td>
      <td className="px-4 py-3 num text-[12px]" style={{ color: 'var(--color-text-3)' }}>
        {branch.last_activity_at ? <TimeAgo at={branch.last_activity_at} /> : '—'}
      </td>
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
          style={branch.is_active
            ? { background: 'var(--color-good-light)', color: '#047857' }
            : { background: '#F1F3F5', color: 'var(--color-text-3)' }}
        >{branch.is_active ? 'نشطة' : 'خاملة'}</span>
      </td>
      <td className="px-4 py-3 text-start">
        <IconDotsVertical size={15} style={{ color: 'var(--color-text-3)' }} />
      </td>
    </tr>
  );
}

export { IconDownload };
