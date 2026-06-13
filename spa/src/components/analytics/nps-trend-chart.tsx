'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ChartFrame } from './chart-frame';
import type { NpsPoint } from '@/types/api';

interface Props {
  data: NpsPoint[];
  bucket: 'day' | 'week' | undefined;
  loading: boolean;
  error: boolean;
}

function formatBucket(bucket: string, kind: 'day' | 'week' | undefined): string {
  // Backend bucket: 'YYYY-MM-DD' for day, 'YYYY-WW' for week (or ISO date for week start).
  if (!bucket) return '';
  const dateStr = bucket.length === 10 ? bucket : `${bucket}-01`;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return bucket;
  if (kind === 'week') {
    return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(d);
  }
  return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(d);
}

export function NpsTrendChart({ data, bucket, loading, error }: Props) {
  if (loading) return <ChartFrame variant="loading" />;
  if (error)   return <ChartFrame variant="error" />;
  if (data.length === 0) return <ChartFrame variant="empty" />;

  const series = data.map(p => ({
    name: formatBucket(p.bucket, bucket),
    satisfaction: Math.round(p.satisfaction_rate),
    rating: Number(p.avg_rating?.toFixed(2) ?? 0)
  }));

  return (
    <ResponsiveContainer>
      <LineChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#F1F3F5" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#4A5163', fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: '#4A5163', fontSize: 11 }} domain={[0, 100]} />
        <Tooltip
          contentStyle={{ borderRadius: 7, border: '1px solid #E6E8EB', fontSize: 12 }}
          labelStyle={{ color: '#0A0E1A', fontWeight: 600 }}
          formatter={(value, name) => name === 'satisfaction' ? [`${value}٪`, 'مؤشر الرضا'] : [String(value), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} iconType="circle" iconSize={8} />
        <Line
          name="مؤشر الرضا (٪)"
          type="monotone"
          dataKey="satisfaction"
          stroke="#0052FF"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
