'use client';

import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { IconStar, IconAlertTriangle, IconBrandGoogle, IconWifi, IconDownload } from '@tabler/icons-react';
import { NpsTrendChart } from './nps-trend-chart';
import { BranchComparisonChart } from './branch-comparison-chart';
import { ComplaintReasonsChart } from './complaint-reasons-chart';
import { useNpsTrend, useBranchComparison, useComplaintReasons } from '@/lib/queries';
import { safeNumber } from '@/lib/format';
import type {
  AnalyticsRange, DashboardSummary,
  NpsResponse, BranchComparisonResponse, ComplaintReasonsResponse
} from '@/types/api';

const RANGES: Array<{ key: AnalyticsRange; label: string }> = [
  { key: '30d', label: '30 يوم' },
  { key: '90d', label: '90 يوم' },
  { key: '6m',  label: '6 أشهر' },
  { key: '1y',  label: 'سنة' }
];

interface Props {
  initialRange: AnalyticsRange;
  summary: DashboardSummary | null;
  initialNps: NpsResponse | null;
  initialComparison: BranchComparisonResponse | null;
  initialReasons: ComplaintReasonsResponse | null;
}

export function AnalyticsView({ initialRange, summary, initialNps, initialComparison, initialReasons }: Props) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const range = ((sp.get('range') as AnalyticsRange | null) ?? initialRange) as AnalyticsRange;

  const matched = range === initialRange;
  const npsQ        = useNpsTrend(range,        matched ? initialNps        ?? undefined : undefined);
  const comparisonQ = useBranchComparison(range, matched ? initialComparison ?? undefined : undefined);
  const reasonsQ    = useComplaintReasons(range, matched ? initialReasons    ?? undefined : undefined);

  const setRange = useCallback((r: AnalyticsRange) => {
    const params = new URLSearchParams(sp.toString());
    if (r === '30d') params.delete('range');
    else params.set('range', r);
    navigate(`/analytics?${params.toString()}`);
  }, [navigate, sp]);

  // KPIs (derived from DashboardSummary which represents "last 30 days" upstream).
  const totalEvals = safeNumber(summary?.total_evaluations);
  const totalComplaints = safeNumber(summary?.complaint_count);
  const nfcTouches = summary?.source_breakdown?.find(s => s.source === 'nfc')?.total ?? 0;

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">التحليلات</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">رؤى تفصيلية حول أداء جميع الفروع</p>
        </div>
        <div className="flex items-center gap-2">
          <RangeChips value={range} onChange={setRange} />
          <button
            type="button"
            disabled
            title="قريباً"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          ><IconDownload size={14} />تصدير</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Kpi
          label="إجمالي التقييمات"
          value={totalEvals.toLocaleString('en-US')}
          icon={<IconStar size={18} className="text-[var(--color-text-3)]" />}
        />
        <Kpi
          label="إجمالي الشكاوى"
          value={totalComplaints.toLocaleString('en-US')}
          icon={<IconAlertTriangle size={18} className="text-[var(--color-text-3)]" />}
        />
        <Kpi
          label="معدل الرد على جوجل"
          value={<span className="text-[var(--color-text-3)] text-[15px]">—</span>}
          icon={<IconBrandGoogle size={18} className="text-[var(--color-text-3)]" />}
          hint="لا توجد بيانات متاحة حالياً"
        />
        <Kpi
          label="لمسات NFC"
          value={nfcTouches.toLocaleString('en-US')}
          icon={<IconWifi size={18} className="text-[var(--color-text-3)]" />}
        />
      </div>

      {/* Branch comparison + Complaint reasons */}
      <div className="mb-3.5 grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <SectionH title="مقارنة أداء الفروع" right={<span className="text-[11.5px] text-[var(--color-text-3)]">متوسط التقييم</span>} />
          <div style={{ height: 280 }}>
            <BranchComparisonChart
              data={comparisonQ.data?.branches ?? []}
              loading={comparisonQ.isFetching && !comparisonQ.data}
              error={comparisonQ.isError}
            />
          </div>
        </Card>

        <Card>
          <SectionH title="توزيع أسباب الشكاوى" right={<span className="text-[11.5px] text-[var(--color-text-3)]">{rangeLabel(range)}</span>} />
          <div style={{ height: 280 }}>
            <ComplaintReasonsChart
              data={reasonsQ.data?.segments ?? []}
              total={reasonsQ.data?.total ?? 0}
              loading={reasonsQ.isFetching && !reasonsQ.data}
              error={reasonsQ.isError}
            />
          </div>
        </Card>
      </div>

      {/* NPS Trend */}
      <Card>
        <SectionH title="اتجاه مؤشر الرضا بمرور الوقت" right={<span className="text-[11.5px] text-[var(--color-text-3)]">{rangeLabel(range)}</span>} />
        <div style={{ height: 280 }}>
          <NpsTrendChart
            data={npsQ.data?.points ?? []}
            bucket={npsQ.data?.bucket}
            loading={npsQ.isFetching && !npsQ.data}
            error={npsQ.isError}
          />
        </div>
      </Card>
    </div>
  );
}

function rangeLabel(r: AnalyticsRange): string {
  switch (r) {
    case '30d': return 'آخر 30 يوم';
    case '90d': return 'آخر 90 يوم';
    case '6m':  return 'آخر 6 أشهر';
    case '1y':  return 'آخر سنة';
  }
}

function RangeChips({ value, onChange }: { value: AnalyticsRange; onChange: (v: AnalyticsRange) => void }) {
  return (
    <div className="flex gap-1">
      {RANGES.map(r => {
        const active = value === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            className="rounded-full px-3 py-1 text-[12px] font-medium transition"
            style={{
              background: active ? 'var(--color-primary-light)' : '#F4F5F7',
              color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
              cursor: 'pointer'
            }}
          >{r.label}</button>
        );
      })}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 20 }}>
      {children}
    </div>
  );
}

function SectionH({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="text-[15px] font-semibold text-[var(--color-text-1)]">{title}</div>
      {right}
    </div>
  );
}

function Kpi({ label, value, icon, hint }: { label: string; value: React.ReactNode; icon: React.ReactNode; hint?: string }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '18px 20px'
      }}
    >
      <div className="mb-1 flex items-start justify-between">
        <div className="text-[12.5px] font-medium text-[var(--color-text-2)]">{label}</div>
        {icon}
      </div>
      <div className="num text-[28px] font-semibold tracking-[-0.5px] text-[var(--color-text-1)]">{value}</div>
      {hint ? <div className="mt-1 text-[12px] text-[var(--color-text-3)]">{hint}</div> : null}
    </div>
  );
}
