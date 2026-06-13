'use client';

import { Link } from 'react-router';
import {
  IconMoodSmile, IconMessage2Exclamation, IconChartHistogram, IconStar,
  IconBuildingStore, IconAlertTriangle, IconMailFast, IconDownload, IconArrowLeft
} from '@tabler/icons-react';
import { safeNumber } from '@/lib/format';
import type { DashboardSummary } from '@/types/api';

interface Props {
  summary: DashboardSummary | null;
}

interface ReportDef {
  key: string;
  title: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  action:
    | { kind: 'link'; href: string; cta: string }
    | { kind: 'download'; cta: string }
    | { kind: 'soon' };
}

export function ReportsView({ summary }: Props) {
  const reports: ReportDef[] = [
    {
      key: 'satisfaction',
      title: 'تقرير رضا العملاء',
      description: 'متابعة مؤشر الرضا وتوزيع التقييمات عبر جميع الفروع',
      badge: 'شهري',
      icon: <IconMoodSmile size={22} />,
      iconBg: 'var(--color-primary-light)',
      iconColor: 'var(--color-primary)',
      action: { kind: 'link', href: '/analytics?range=30d', cta: 'عرض' }
    },
    {
      key: 'complaint-reasons',
      title: 'تحليل أسباب الشكاوى',
      description: 'تصنيف الشكاوى حسب الحالة والفرع والتوقيت',
      badge: 'أسبوعي',
      icon: <IconMessage2Exclamation size={22} />,
      iconBg: 'var(--color-warn-light)',
      iconColor: 'var(--color-warn)',
      action: { kind: 'link', href: '/analytics?range=30d', cta: 'عرض' }
    },
    {
      key: 'nps',
      title: 'مؤشر الولاء',
      description: 'قياس مدى توصية العملاء بخدماتك بمرور الوقت',
      badge: 'ربع سنوي',
      icon: <IconChartHistogram size={22} />,
      iconBg: 'var(--color-purple-light)',
      iconColor: 'var(--color-purple)',
      action: { kind: 'link', href: '/analytics?range=90d', cta: 'عرض' }
    },
    {
      key: 'evaluations-excel',
      title: 'تقرير التقييمات الكامل',
      description: 'جدول Excel يضم جميع التقييمات والشكاوى مع توقيتاتها',
      badge: 'تحميل',
      icon: <IconStar size={22} />,
      iconBg: '#FFFBEB',
      iconColor: '#F59E0B',
      action: { kind: 'download', cta: 'تحميل Excel' }
    },
    {
      key: 'branches',
      title: 'أداء الفروع',
      description: 'مقارنة شاملة بين جميع الفروع على كل المؤشرات',
      badge: 'شهري',
      icon: <IconBuildingStore size={22} />,
      iconBg: 'var(--color-good-light)',
      iconColor: 'var(--color-good)',
      action: { kind: 'link', href: '/branches', cta: 'عرض' }
    },
    {
      key: 'alerts',
      title: 'تنبيهات الأداء الحرج',
      description: 'إشعارات فورية عند انخفاض أي مؤشر',
      badge: 'قريباً',
      icon: <IconAlertTriangle size={22} />,
      iconBg: 'var(--color-bad-light)',
      iconColor: 'var(--color-bad)',
      action: { kind: 'soon' }
    }
  ];

  const totalEvals = safeNumber(summary?.total_evaluations);

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">التقارير</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            تقارير دورية قابلة للتصدير والمشاركة
            {totalEvals > 0 ? ` · ${totalEvals.toLocaleString('en-US')} تقييم متاح` : ''}
          </p>
        </div>
      </div>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {reports.map(r => <ReportCard key={r.key} report={r} />)}
      </div>

      {/* Scheduled reports banner */}
      <div
        className="mt-6 rounded-[10px] flex items-start gap-3.5 p-5"
        style={{
          background: 'linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-surface) 100%)',
          border: '1px solid var(--color-primary-light)'
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center text-white"
          style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-primary)' }}
        >
          <IconMailFast size={20} />
        </div>
        <div className="flex-1">
          <h3 className="text-[14.5px] font-semibold m-0 text-[var(--color-text-1)]">جدولة التقارير التلقائية</h3>
          <p className="mt-1 text-[12.5px] m-0" style={{ color: 'var(--color-text-2)' }}>
            احصل على تقاريرك دورياً عبر البريد الإلكتروني بصيغة Excel
          </p>
        </div>
        <button
          type="button"
          disabled
          title="قريباً"
          className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white opacity-60"
          style={{ background: 'var(--color-primary)' }}
        >قريباً</button>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: ReportDef }) {
  const action = report.action;

  return (
    <div
      className="rounded-[10px]"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 20 }}
    >
      <div
        className="mb-3.5 flex items-center justify-center"
        style={{ width: 40, height: 40, borderRadius: 10, background: report.iconBg, color: report.iconColor }}
      >{report.icon}</div>
      <h3 className="text-[15px] font-semibold m-0 mb-1 text-[var(--color-text-1)]">{report.title}</h3>
      <p className="text-[12.5px] leading-[1.6] m-0" style={{ color: 'var(--color-text-2)' }}>
        {report.description}
      </p>
      <div
        className="mt-3.5 pt-3.5 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
          style={{
            background: action.kind === 'soon' ? '#F1F3F5' : 'var(--color-primary-light)',
            color: action.kind === 'soon' ? 'var(--color-text-3)' : 'var(--color-primary)'
          }}
        >{report.badge}</span>

        {action.kind === 'link' ? (
          <Link
            to={action.href}
            className="text-[12.5px] font-medium flex items-center gap-1"
            style={{ color: 'var(--color-primary)' }}
          >{action.cta} <IconArrowLeft size={13} /></Link>
        ) : action.kind === 'download' ? (
          <a
            href={`/api/export-excel?apiKey=${encodeURIComponent(typeof window !== 'undefined' ? (window.localStorage.getItem('repu_key') || '') : '')}`}
            download
            className="text-[12.5px] font-medium flex items-center gap-1"
            style={{ color: 'var(--color-primary)' }}
          ><IconDownload size={13} />{action.cta}</a>
        ) : (
          <span className="text-[12.5px] text-[var(--color-text-3)]">قريباً</span>
        )}
      </div>
    </div>
  );
}
