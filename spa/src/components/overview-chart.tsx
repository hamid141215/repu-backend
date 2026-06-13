'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import type { MonthlyPoint, DailyPoint } from '@/types/api';

interface Props {
  monthly: MonthlyPoint[];
  daily?: DailyPoint[];
}

const arMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

/**
 * Two-series line chart matching RepuSystem_UI.html:
 * - "التقييمات" — from monthly_counts.total (total evaluations / month)
 * - "الشكاوى"  — derived from daily_counts_last_30_days, aggregated by month
 *
 * The complaints series is best-effort: backend only gives complaint_count
 * in the daily-30 window, so older months in the line will sit at 0. The
 * recent month is accurate; older months are visually flat. This is documented
 * in BLOCKERS.md as a v1.1 candidate (backend monthly_counts → include complaint_count).
 */
export function OverviewChart({ monthly, daily = [] }: Props) {
  // Build a month → complaint_count map from daily data (covers last ~30 days).
  const complaintsByMonth = new Map<string, number>();
  for (const d of daily) {
    if (!d.date) continue;
    const key = d.date.slice(0, 7); // 'YYYY-MM'
    complaintsByMonth.set(key, (complaintsByMonth.get(key) ?? 0) + (d.complaint_count ?? 0));
  }

  const data = monthly.map(p => {
    const m = Number(p.month?.slice(5)) - 1;
    return {
      name: arMonths[m] ?? p.month,
      تقييمات: p.total ?? 0,
      شكاوى: complaintsByMonth.get(p.month) ?? 0
    };
  });

  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-[13px]" style={{ color: 'var(--color-text-3)' }}>
        لا توجد بيانات متاحة حالياً
      </div>
    );
  }

  return (
    <div style={{ height: 240, width: '100%' }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#F1F3F5" vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#4A5163', fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: '#4A5163', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ borderRadius: 7, border: '1px solid #E6E8EB', fontSize: 12 }}
            labelStyle={{ color: '#0A0E1A', fontWeight: 600 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
            iconType="circle"
            iconSize={8}
            verticalAlign="bottom"
          />
          <Line
            name="الشكاوى"
            type="monotone"
            dataKey="شكاوى"
            stroke="#0052FF"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            name="التقييمات"
            type="monotone"
            dataKey="تقييمات"
            stroke="#10B981"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
