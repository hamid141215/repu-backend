import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  IconMoodSmile, IconClock, IconCircleCheck, IconStar,
  IconBuildingStore, IconArrowLeft, IconMinus,
  IconCalendar, IconChevronDown, IconDownload
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { useClientInfo } from '@/lib/queries';
import { getApiKey } from '@/lib/auth';
import { safeNumber } from '@/lib/format';
import { TimeAgo } from '@/components/time-ago';
import { OverviewChart } from '@/components/overview-chart';
import { ActivityFeed } from '@/components/activity-feed';
import { EmptyState } from '@/components/empty-state';
import { PageSpinner } from '@/components/page-spinner';
import type {
  DashboardSummary, ActivityResponse, ActivityItem,
  BranchPerformance, ComplaintRow
} from '@/types/api';

export default function OverviewPage() {
  const clientQ = useClientInfo();
  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 30_000
  });
  const activityQ = useQuery({
    queryKey: ['activity', 5],
    queryFn: () => apiClient<ActivityResponse>('/api/activity?limit=5'),
    refetchInterval: 30_000,
    staleTime: 15_000
  });

  if (clientQ.isLoading || summaryQ.isLoading) return <PageSpinner />;

  const client = clientQ.data ?? null;
  const summary = summaryQ.data ?? null;
  const activity: ActivityResponse = activityQ.data ?? { items: [] as ActivityItem[] };

  if (!summary) {
    return (
      <div className="p-7 max-w-[1400px]">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">الرئيسية</h1>
        <div className="mt-6 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <EmptyState message="تعذر تحميل البيانات. تأكد من اتصال الخادم وحاول مرة أخرى." />
        </div>
      </div>
    );
  }

  const satisfaction = safeNumber(summary.satisfaction_rate);
  const avgRating    = safeNumber(summary.average_rating);
  const workflow     = summary.complaint_workflow_summary || {
    new_count: 0, in_progress_count: 0, contacted_count: 0,
    resolved_count: 0, closed_count: 0, overdue_count: 0
  };
  const totalComplaints = safeNumber(summary.complaint_count);
  const resolvedRate = totalComplaints === 0
    ? 100
    : Math.round(((workflow.resolved_count + workflow.closed_count) / totalComplaints) * 100);

  const monthly = summary.monthly_counts ?? [];
  const branches = summary.branch_performance ?? [];
  const urgent = (summary.urgent_complaints ?? []).slice(0, 3);

  const greetingName = client?.name?.split(' ')?.[0] || '';
  const apiKey = getApiKey() || '';

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">
            {greetingName ? `مرحباً، ${greetingName} 👋` : 'الرئيسية'}
          </h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            هذه نظرة سريعة على أداء منشأتك خلال آخر 30 يوم
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="نطاق زمني — قريباً"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium opacity-80"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          >
            <IconCalendar size={14} />
            آخر 30 يوم
            <IconChevronDown size={12} />
          </button>
          <a
            href={`/api/export-excel?apiKey=${encodeURIComponent(apiKey)}`}
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-2)', background: 'var(--color-surface)' }}
          ><IconDownload size={14} />تصدير</a>
        </div>
      </div>

      <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiCard label="مؤشر الرضا"
          value={<>{satisfaction.toFixed(0)}<span className="text-[18px] text-[var(--color-text-3)] font-medium">٪</span></>}
          icon={<IconMoodSmile size={18} className="text-[var(--color-text-3)]" />} />
        <KpiCard label="معدل الاستجابة"
          value={<span className="text-[var(--color-text-3)] text-[15px]">—</span>}
          icon={<IconClock size={18} className="text-[var(--color-text-3)]" />}
          hint="لا توجد بيانات متاحة حالياً" />
        <KpiCard label="الشكاوى التي حُلّت"
          value={<>{resolvedRate}<span className="text-[18px] text-[var(--color-text-3)] font-medium">٪</span></>}
          icon={<IconCircleCheck size={18} className="text-[var(--color-text-3)]" />} />
        <KpiCard label="متوسط التقييم"
          value={<>{avgRating.toFixed(1)}<span className="text-[18px] text-[var(--color-text-3)] font-medium">/5</span></>}
          icon={<IconStar size={18} className="text-[var(--color-text-3)]" />} />
      </div>

      <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
        <Card>
          <SectionH title="تطور الشكاوى والتقييمات"
            subtitle="مقارنة شهرية للأداء عبر جميع الفروع"
            right={
              <div className="flex gap-1">
                <Chip active>شهري</Chip>
                <Chip>أسبوعي</Chip>
                <Chip>يومي</Chip>
              </div>
            } />
          <OverviewChart monthly={monthly} daily={summary.daily_counts_last_30_days ?? []} />
        </Card>
        <Card>
          <SectionH title="النشاط اللحظي"
            right={
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-3)] font-normal">
                <span className="pulse" /> مباشر
              </span>
            } />
          <ActivityFeed initial={activity?.items ?? []} />
        </Card>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <SectionH title="أداء الفروع"
            right={<Link to="/branches" className="text-[12.5px] font-medium" style={{ color: 'var(--color-primary)' }}>عرض الكل <IconArrowLeft size={13} className="inline -mb-0.5" /></Link>} />
          {branches.length === 0 ? <EmptyState /> : (
            <div className="flex flex-col">
              {branches.slice(0, 4).map((b, i) => (
                <BranchRow key={`${b.branch}-${i}`} branch={b} first={i === 0} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionH title="شكاوى تحتاج اهتمامك"
            right={<Link to="/complaints" className="text-[12.5px] font-medium" style={{ color: 'var(--color-primary)' }}>عرض الكل <IconArrowLeft size={13} className="inline -mb-0.5" /></Link>} />
          {urgent.length === 0 ? <EmptyState message="لا توجد شكاوى عاجلة" /> : (
            <div className="flex flex-col">
              {urgent.map((c, i) => <UrgentRow key={c.id} c={c} last={i === urgent.length - 1} />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 20 }}>{children}</div>
  );
}

function SectionH({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <div className="text-[15px] font-semibold text-[var(--color-text-1)]">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[12px] font-normal text-[var(--color-text-3)]">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

function Chip({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium leading-[1.6]"
      style={{ background: active ? 'var(--color-primary-light)' : '#F4F5F7', color: active ? 'var(--color-primary)' : 'var(--color-text-3)', cursor: 'default' }}>{children}</span>
  );
}

function KpiCard({ label, value, icon, hint }: { label: string; value: React.ReactNode; icon: React.ReactNode; hint?: string }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '18px 20px' }}>
      <div className="mb-1 flex items-start justify-between">
        <div className="text-[12.5px] font-medium text-[var(--color-text-2)]">{label}</div>
        {icon}
      </div>
      <div className="num text-[28px] font-semibold tracking-[-0.5px] text-[var(--color-text-1)]">{value}</div>
      {hint ? (
        <div className="mt-1 text-[12px] text-[var(--color-text-3)]">{hint}</div>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-text-3)' }}>
          <IconMinus size={13} /><span>آخر 30 يوم</span>
        </div>
      )}
    </div>
  );
}

function BranchRow({ branch, first }: { branch: BranchPerformance; first: boolean }) {
  const rating = safeNumber(branch.average_rating);
  const evalsTotal = safeNumber(branch.rating_count ?? branch.total_evaluations);
  const displayRating = rating > 5 && evalsTotal > 0 ? rating / evalsTotal : rating;
  const [label, badgeClass, iconBg, iconColor] = statusOf(displayRating);
  return (
    <div className="flex items-center gap-3 py-2" style={first ? undefined : { borderTop: '1px solid var(--color-border)' }}>
      <div className="flex shrink-0 items-center justify-center"
        style={{ width: 36, height: 36, borderRadius: 8, background: iconBg, color: iconColor }}>
        <IconBuildingStore size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--color-text-1)] truncate">{branch.branch}</div>
        <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]">
          {safeNumber(branch.total_evaluations)} تقييم · {safeNumber(branch.complaint_count)} شكوى
        </div>
      </div>
      <div className="text-start">
        <div className="num text-[14px] font-semibold">{displayRating.toFixed(1)}</div>
        <span className="mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]" style={badgeClass}>{label}</span>
      </div>
    </div>
  );
}

function statusOf(rating: number): [string, React.CSSProperties, string, string] {
  if (rating >= 4.5) return ['ممتاز',     { background: 'var(--color-good-light)', color: '#047857' }, 'var(--color-good-light)', 'var(--color-good)'];
  if (rating >= 4)   return ['جيد جداً',  { background: 'var(--color-good-light)', color: '#047857' }, 'var(--color-good-light)', 'var(--color-good)'];
  if (rating >= 3.5) return ['متوسط',     { background: 'var(--color-warn-light)', color: '#B45309' }, 'var(--color-warn-light)', 'var(--color-warn)'];
  return ['يحتاج تدخل', { background: 'var(--color-bad-light)', color: '#B91C1C' }, 'var(--color-bad-light)', 'var(--color-bad)'];
}

function UrgentRow({ c, last }: { c: ComplaintRow; last: boolean }) {
  const dotColor = c.is_overdue ? 'var(--color-bad)' : 'var(--color-warn)';
  const preview = c.feedback?.trim() || 'لا يوجد نص شكوى مسجل';
  return (
    <div className="flex gap-3 py-2.5" style={last ? undefined : { borderBottom: '1px solid var(--color-border)' }}>
      <span className="prio-dot mt-1.5" style={{ background: dotColor }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="text-[13.5px] font-medium text-[var(--color-text-1)]">
            #{c.id}{c.name ? ` — ${c.name}` : ''}
          </div>
          <TimeAgo at={c.sent_at} className="text-[11.5px] text-[var(--color-text-3)]" />
        </div>
        <div className="mt-1 line-clamp-2 text-[12.5px] text-[var(--color-text-2)]">{preview}</div>
        <div className="mt-1.5 flex gap-1.5">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
            style={c.is_overdue
              ? { background: 'var(--color-bad-light)', color: '#B91C1C' }
              : { background: 'var(--color-warn-light)', color: '#B45309' }}>{c.is_overdue ? 'متأخرة' : 'تحتاج متابعة'}</span>
          {c.branch ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]" style={{ background: '#F1F3F5', color: 'var(--color-text-2)' }}>{c.branch}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
