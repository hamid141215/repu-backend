'use client';

import { Link } from 'react-router';
import { IconAlertTriangle, IconArrowLeft, IconBuildingStore, IconDownload, IconMoodSmile, IconStar } from '@tabler/icons-react';
import { OverviewChart } from '@/components/overview-chart';
import { TimeAgo } from '@/components/time-ago';
import { safeNumber } from '@/lib/format';
import type { BranchPerformance, DashboardSummary } from '@/types/api';

interface Props { summary: DashboardSummary | null; }

export function ReportsView({ summary }: Props) {
  const branches = summary?.branch_performance ?? [];
  const urgent = (summary?.urgent_complaints ?? []).slice(0, 5);
  const workflow = summary?.complaint_workflow_summary;
  const resolved = safeNumber(workflow?.resolved_count) + safeNumber(workflow?.closed_count);

  return (
    <div className="p-7 page-shell" style={{ maxWidth: 1400 }}>
      <header className="mb-6 flex items-start justify-between gap-3 page-header">
        <div>
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px]">الملخص التنفيذي</h1>
          <p className="m-0 mt-1 text-[13.5px] text-[var(--color-text-2)]">قراءة موجزة للبيانات التشغيلية المتاحة حاليًا</p>
        </div>
        <a href={`/api/export-excel?apiKey=${encodeURIComponent(typeof window !== 'undefined' ? (window.localStorage.getItem('repu_key') || '') : '')}`}
          download className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
          style={{ borderColor: 'var(--color-border-strong)', background: 'white', color: 'var(--color-primary)' }}>
          <IconDownload size={14} />تصدير Excel
        </a>
      </header>

      <Section title="ملخص الفترة" subtitle="آخر 30 يوم وفق بيانات الملخص الحالية">
        <div className="grid gap-3 context-metrics-grid">
          <Metric label="إجمالي الإشارات" value={safeNumber(summary?.total_evaluations).toLocaleString('en-US')} />
          <Metric label="متوسط التقييم" value={`${safeNumber(summary?.average_rating).toFixed(1)}/5`} />
          <Metric label="مؤشر الرضا" value={`${safeNumber(summary?.satisfaction_rate).toFixed(0)}٪`} />
          <Metric label="شكاوى أغلقت أو حُلّت" value={resolved.toLocaleString('en-US')} />
        </div>
      </Section>

      <Section title="أبرز المؤشرات">
        <div className="grid gap-3 report-highlights-grid">
          <Highlight icon={<IconStar size={18} />} title="التقييمات المنخفضة" value={safeNumber(summary?.low_rating_count)} note={`${safeNumber(summary?.low_rating_rate).toFixed(0)}٪ من التقييمات`} tone="warn" />
          <Highlight icon={<IconAlertTriangle size={18} />} title="الشكاوى المتأخرة" value={safeNumber(workflow?.overdue_count)} note="وفق سير عمل الشكاوى الحالي" tone="bad" />
          <Highlight icon={<IconMoodSmile size={18} />} title="التقييمات الإيجابية" value={safeNumber(summary?.positive_count)} note="ضمن الفترة المتاحة" tone="good" />
        </div>
      </Section>

      <Section title="أداء الفروع" subtitle="مقارنة مباشرة بالمقاييس الحالية" action={<Link to="/branches" className="section-link">ذكاء الفروع <IconArrowLeft size={13} /></Link>}>
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-white">
          {branches.length ? branches.slice(0, 8).map((branch, index) => <BranchLine key={`${branch.branch}-${index}`} branch={branch} first={index === 0} />) : <div className="p-6 text-center text-[13px] text-[var(--color-text-3)]">لا توجد بيانات فروع متاحة</div>}
        </div>
      </Section>

      <Section title="إشارات تحتاج انتباهًا" subtitle="الشكاوى العاجلة المسجلة حاليًا" action={<Link to="/signals?type=complaints" className="section-link">كل الإشارات <IconArrowLeft size={13} /></Link>}>
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-border)] bg-white">
          {urgent.length ? urgent.map((item, index) => (
            <div key={item.id} className="flex items-start gap-3 px-4 py-3" style={index ? { borderTop: '1px solid var(--color-border)' } : undefined}>
              <IconAlertTriangle size={15} className="mt-1 shrink-0 text-[var(--color-bad)]" />
              <div className="min-w-0 flex-1"><div className="line-clamp-2 text-[13px]">{item.feedback?.trim() || 'لا يوجد نص شكوى مسجل'}</div><div className="mt-1 flex gap-2 text-[11.5px] text-[var(--color-text-3)]">{item.branch ? <span>{item.branch}</span> : null}<TimeAgo at={item.sent_at} /></div></div>
            </div>
          )) : <div className="p-6 text-center text-[13px] text-[var(--color-text-3)]">لا توجد إشارات عاجلة حاليًا</div>}
        </div>
      </Section>

      <Section title="الاتجاهات" subtitle="الحركة الفعلية المسجلة للتقييمات والشكاوى">
        <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-5"><OverviewChart monthly={summary?.monthly_counts ?? []} daily={summary?.daily_counts_last_30_days ?? []} /></div>
      </Section>

      <Section title="التصدير" subtitle="استخدم ملف Excel الحالي للتحليل والمشاركة">
        <a href={`/api/export-excel?apiKey=${encodeURIComponent(typeof window !== 'undefined' ? (window.localStorage.getItem('repu_key') || '') : '')}`}
          download className="inline-flex items-center gap-1.5 rounded-[7px] bg-[var(--color-primary)] px-3.5 py-2 text-[13px] font-medium text-white"><IconDownload size={14} />تحميل Excel</a>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="mb-6"><div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="m-0 text-[16px] font-semibold">{title}</h2>{subtitle ? <p className="m-0 mt-1 text-[12.5px] text-[var(--color-text-3)]">{subtitle}</p> : null}</div>{action}</div>{children}</section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4"><div className="text-[12px] text-[var(--color-text-3)]">{label}</div><div className="num mt-1 text-[24px] font-semibold">{value}</div></div>;
}

function Highlight({ icon, title, value, note, tone }: { icon: React.ReactNode; title: string; value: number; note: string; tone: 'warn' | 'bad' | 'good' }) {
  const colors = tone === 'bad' ? ['var(--color-bad-light)', 'var(--color-bad)'] : tone === 'warn' ? ['var(--color-warn-light)', 'var(--color-warn)'] : ['var(--color-good-light)', 'var(--color-good)'];
  return <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4"><span className="flex h-9 w-9 items-center justify-center rounded-[8px]" style={{ background: colors[0], color: colors[1] }}>{icon}</span><div className="mt-3 text-[12.5px] font-medium text-[var(--color-text-2)]">{title}</div><div className="num mt-1 text-[25px] font-semibold">{value}</div><div className="mt-1 text-[11.5px] text-[var(--color-text-3)]">{note}</div></div>;
}

function BranchLine({ branch, first }: { branch: BranchPerformance; first: boolean }) {
  const count = safeNumber(branch.rating_count ?? branch.total_evaluations);
  const raw = safeNumber(branch.average_rating);
  const rating = raw > 5 && count > 0 ? raw / count : raw;
  return <div className="flex items-center gap-3 px-4 py-3" style={first ? undefined : { borderTop: '1px solid var(--color-border)' }}><IconBuildingStore size={16} className="shrink-0 text-[var(--color-text-3)]" /><div className="min-w-0 flex-1 truncate text-[13px] font-medium">{branch.branch}</div><div className="text-[12px] text-[var(--color-text-3)]">{safeNumber(branch.total_evaluations)} إشارة · {safeNumber(branch.complaint_count)} شكوى</div><div className="num w-14 text-end text-[13px] font-semibold">{rating.toFixed(1)}/5</div></div>;
}
