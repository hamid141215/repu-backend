'use client';

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { ChartFrame } from './chart-frame';
import type { BranchComparisonRow } from '@/types/api';

interface Props {
  data: BranchComparisonRow[];
  loading: boolean;
  error: boolean;
}

function colorFor(rating: number): string {
  if (rating >= 4.5) return '#10B981'; // good
  if (rating >= 4)   return '#10B981';
  if (rating >= 3.5) return '#F59E0B'; // warn
  return '#EF4444';                     // bad
}

export function BranchComparisonChart({ data, loading, error }: Props) {
  if (loading) return <ChartFrame variant="loading" />;
  if (error)   return <ChartFrame variant="error" />;
  if (data.length === 0) return <ChartFrame variant="empty" />;

  const top = data
    .filter(b => b.rating_count > 0)
    .slice(0, 8)
    .map(b => ({
      name: b.branch || 'غير محدد',
      rating: Number((b.average_rating ?? 0).toFixed(2)),
      complaints: b.complaint_count
    }));

  if (top.length === 0) return <ChartFrame variant="empty" />;

  return (
    <ResponsiveContainer>
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#F1F3F5" horizontal={false} />
        <XAxis type="number" domain={[0, 5]} tickLine={false} axisLine={false} tick={{ fill: '#4A5163', fontSize: 11 }} />
        <YAxis dataKey="name" type="category" width={100} tickLine={false} axisLine={false} tick={{ fill: '#0A0E1A', fontSize: 12 }} />
        <Tooltip
          contentStyle={{ borderRadius: 7, border: '1px solid #E6E8EB', fontSize: 12 }}
          labelStyle={{ color: '#0A0E1A', fontWeight: 600 }}
          formatter={(value) => [`${value} / 5`, 'متوسط التقييم']}
        />
        <Bar dataKey="rating" radius={[0, 4, 4, 0]} barSize={18}>
          {top.map((b, i) => (
            <Cell key={i} fill={colorFor(b.rating)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
