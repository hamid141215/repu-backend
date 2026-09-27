import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  IconAlertTriangle, IconArrowLeft, IconBuildingStore, IconCalendar,
  IconCircleCheck, IconDownload, IconMessageCircle, IconMoodSmile, IconStar
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { getApiKey } from '@/lib/auth';
import { relativeTimeAr, safeNumber } from '@/lib/format';
import { TimeAgo } from '@/components/time-ago';
import { OverviewChart } from '@/components/overview-chart';
import { EmptyState } from '@/components/empty-state';
import { PageSpinner } from '@/components/page-spinner';
import type { BranchPerformance, ComplaintRow, DashboardSummary } from '@/types/api';

export default function OverviewPage() {
  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 30_000
  });

  if (summaryQ.isLoading) return <PageSpinner />;
  const summary = summaryQ.data ?? null;
  if (!summary) {
    return (
      <div className="p-7 page-shell max-w-[1400px]">
        <h1 className="text-[22px] font-semibold">ملخص الذكاء التشغيلي لتجربة العميل</h1>
        <div className="mt-6 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <EmptyState message="تعذر تحميل البيانات. تأكد من اتصال الخادم وحاول مرة أخرى." />
        </div>
      </div>
    );
  }

  const workflow = summary.complaint_workflow_summary;
  const urgent = (summary.urgent_complaints ?? []).slice(0, 4);
  const branches = (summary.weak_branches ?? []).slice(0, 4);
  const totalComplaints = safeNumber(summary.complaint_count);
  const resolvedCount = safeNumber(workflow?.resolved_count) + safeNumber(workflow?.closed_count);
  const resolvedRate = totalComplaints ? Math.round((resolvedCount / totalComplaints) * 100) : 100;
  const apiKey = getApiKey() || '';

  return (
    <div className="p-7 page-shell" style={{ maxWidth: 1400 }}>
      <header className="mb-6 flex items-start justify-between gap-4 page-header">
        <div>
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)]">ملخص الذكاء التشغيلي لتجربة العميل</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--color-text-2)]">
            <span className="inline-flex items-center gap-1"><IconCalendar size={13} />آخر 30 يوم</span>
            {summaryQ.dataUpdatedAt ? <span>آخر تحديث {relativeTimeAr(summaryQ.dataUpdatedAt)}</span> : null}
          </div>
        </div>
        <a href={`/api/export-excel?apiKey=${encodeURIComponent(apiKey)}`}
          className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
          style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}>
          <IconDownload size={14} />تصدير
        </a>
      </header>

      <section className="mb-5">
        <SectionHead title="الإشارات التي تحتاج انتباهًا" subtitle="مبنية على الشكاوى العاجلة والتقييمات المنخفضة المسجلة حاليًا"
          action={<Link to="/signals" className="section-link">عرض الإشارات <IconArrowLeft size={13} /></Link>} />
        <div className="grid gap-3 overview-attention-grid">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13.5px] font-semibold">شكاوى تحتاج متابعة</span>
              <span className="num rounded-full bg-[var(--color-bad-light)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-bad)]">{urgent.length}</span>
            </div>
            {urgent.length ? urgent.map((item, index) => <AttentionRow key={item.id} item={item} last={index === urgent.length - 1} />) : <EmptyState message="لا توجد شكاوى عاجلة حاليًا" />}
          </Card>
          <Card>
            <div className="flex h-full flex-col justify-between gap-5">
              <div>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-[8px] bg-[var(--color-warn-light)] text-[var(--color-warn)]"><IconStar size={17} /></div>
                <div className="text-[13.5px] font-semibold">تقييمات منخفضة</div>
                <div className="num mt-2 text-[30px] font-semibold">{safeNumber(summary.low_rating_count)}</div>
                <div className="mt-1 text-[12px] text-[var(--color-text-3)]">{safeNumber(summary.low_rating_rate).toFixed(0)}٪ من التقييمات المسجلة</div>
              </div>
              <Link to="/signals?type=reviews&rating=2" className="section-link">مراجعة الإشارات <IconArrowLeft size={13} /></Link>
            </div>
          </Card>
        </div>
      </section>

      <section className="mb-5">
        <SectionHead title="الفروع التي تحتاج متابعة" subtitle="الفروع الأضعف كما يعيدها ملخص الأداء الحالي"
          action={<Link to="/branches" className="section-link">ذكاء الفروع <IconArrowLeft size={13} /></Link>} />
        <Card>
          {branches.length ? branches.map((branch, index) => <BranchRow key={`${branch.branch}-${index}`} branch={branch} last={index === branches.length - 1} />) : <EmptyState message="لا توجد فروع محددة للمتابعة في البيانات الحالية" />}
        </Card>
      </section>

      <section className="mb-5">
        <SectionHead title="ما تغير في المؤشرات المتاحة" subtitle="الاتجاه المسجل فعليًا للتقييمات والشكاوى خلال الفترة" />
        <Card><OverviewChart monthly={summary.monthly_counts ?? []} daily={summary.daily_counts_last_30_days ?? []} /></Card>
      </section>

      <section>
        <SectionHead title="مؤشرات السياق" subtitle="أرقام مساندة لفهم حجم ونطاق صوت العميل" />
        <div className="grid gap-3 context-metrics-grid">
          <Metric label="متوسط التقييم" value={`${safeNumber(summary.average_rating).toFixed(1)}/5`} icon={<IconStar size={16} />} />
          <Metric label="إجمالي الإشارات" value={safeNumber(summary.total_evaluations).toLocaleString('en-US')} icon={<IconMessageCircle size={16} />} />
          <Metric label="مؤشر الرضا" value={`${safeNumber(summary.satisfaction_rate).toFixed(0)}٪`} icon={<IconMoodSmile size={16} />} />
          <Metric label="الشكاوى التي أغلقت" value={`${resolvedRate}٪`} icon={<IconCircleCheck size={16} />} />
        </div>
      </section>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">{children}</div>;
}

function SectionHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div><h2 className="m-0 text-[16px] font-semibold">{title}</h2>{subtitle ? <p className="m-0 mt-1 text-[12.5px] text-[var(--color-text-3)]">{subtitle}</p> : null}</div>
      {action}
    </div>
  );
}

function AttentionRow({ item, last }: { item: ComplaintRow; last: boolean }) {
  return (
    <div className="flex gap-3 py-2.5" style={last ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <IconAlertTriangle size={15} className="mt-1 shrink-0 text-[var(--color-bad)]" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13px] leading-[1.6]">{item.feedback?.trim() || 'لا يوجد نص شكوى مسجل'}</div>
        <div className="mt-1 flex gap-2 text-[11.5px] text-[var(--color-text-3)]">{item.branch ? <span>{item.branch}</span> : null}<TimeAgo at={item.sent_at} /></div>
      </div>
    </div>
  );
}

function BranchRow({ branch, last }: { branch: BranchPerformance; last: boolean }) {
  const count = safeNumber(branch.rating_count ?? branch.total_evaluations);
  const rawRating = safeNumber(branch.average_rating);
  const rating = rawRating > 5 && count > 0 ? rawRating / count : rawRating;
  return (
    <div className="flex items-center gap-3 py-3" style={last ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-bad-light)] text-[var(--color-bad)]"><IconBuildingStore size={17} /></span>
      <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{branch.branch}</div><div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]">{safeNumber(branch.total_evaluations)} إشارة · {safeNumber(branch.complaint_count)} شكوى</div></div>
      <div className="text-end"><div className="num text-[14px] font-semibold">{rating.toFixed(1)}/5</div><div className="text-[11px] text-[var(--color-text-3)]">متوسط التقييم</div></div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-[10px] border border-[var(--color-border)] bg-white p-4"><div className="flex items-center justify-between text-[12px] text-[var(--color-text-3)]"><span>{label}</span>{icon}</div><div className="num mt-2 text-[23px] font-semibold">{value}</div></div>;
}
