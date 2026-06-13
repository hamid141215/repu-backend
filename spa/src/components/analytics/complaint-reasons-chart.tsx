'use client';

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { ChartFrame } from './chart-frame';
import type { ComplaintReasonSegment } from '@/types/api';

interface Props {
  data: ComplaintReasonSegment[];
  total: number;
  loading: boolean;
  error: boolean;
}

const PALETTE = ['#EF4444', '#F59E0B', '#0052FF', '#8B5CF6', '#10B981', '#06B6D4', '#EC4899'];

const STATUS_LABEL: Record<string, string> = {
  new:         'جديدة',
  contacted:   'تم التواصل',
  in_progress: 'قيد المعالجة',
  resolved:    'حُلّت',
  closed:      'مُغلقة',
  unknown:     'غير محدد'
};

export function ComplaintReasonsChart({ data, total, loading, error }: Props) {
  if (loading) return <ChartFrame variant="loading" />;
  if (error)   return <ChartFrame variant="error" />;
  if (data.length === 0 || total === 0) return <ChartFrame variant="empty" message="لا توجد شكاوى في هذه الفترة" />;

  const series = data.map((s, i) => ({
    name: STATUS_LABEL[s.category] || s.category,
    value: s.count,
    color: PALETTE[i % PALETTE.length]
  }));

  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie
          data={series}
          dataKey="value"
          nameKey="name"
          innerRadius={64}
          outerRadius={96}
          paddingAngle={2}
          stroke="white"
          strokeWidth={2}
        >
          {series.map((s, i) => (
            <Cell key={i} fill={s.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ borderRadius: 7, border: '1px solid #E6E8EB', fontSize: 12 }}
          formatter={(value, name) => {
            const v = Number(value) || 0;
            return [`${v} (${Math.round(v/total*100)}٪)`, String(name)];
          }}
        />
        <Legend
          verticalAlign="bottom"
          align="center"
          wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
