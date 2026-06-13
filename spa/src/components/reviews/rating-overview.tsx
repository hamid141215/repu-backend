import { IconStarFilled, IconStar, IconStarHalfFilled } from '@tabler/icons-react';
import type { DashboardSummary } from '@/types/api';

interface Props {
  average: number;
  count: number;
  breakdown: DashboardSummary['rating_breakdown'];
}

const BAR_COLOR: Record<number, string> = {
  5: 'var(--color-good)',
  4: '#84CC16',
  3: 'var(--color-warn)',
  2: '#FB923C',
  1: 'var(--color-bad)'
};

export function RatingOverview({ average, count, breakdown }: Props) {
  return (
    <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: '320px 1fr' }}>
      {/* Average card */}
      <Card>
        <div className="text-center">
          <div className="num text-[64px] font-semibold leading-none text-[var(--color-text-1)]">
            {average ? average.toFixed(1) : '—'}
          </div>
          <Stars rating={average} size={18} className="my-2 justify-center" />
          <div className="text-[13px] text-[var(--color-text-3)]">من {count} تقييم</div>
        </div>
      </Card>

      {/* Breakdown card */}
      <Card>
        <div className="flex flex-col gap-2.5">
          {[5, 4, 3, 2, 1].map(rating => {
            const row = breakdown.find(b => b.rating === rating);
            const c = row?.count ?? 0;
            const pct = count > 0 ? Math.round((c / count) * 100) : 0;
            return (
              <div key={rating} className="flex items-center gap-2.5">
                <span className="text-[12px]" style={{ width: 30 }}>{rating} ★</span>
                <div
                  className="flex-1 overflow-hidden"
                  style={{ height: 6, background: '#F1F3F5', borderRadius: 3 }}
                >
                  <div style={{ height: '100%', width: `${pct}%`, background: BAR_COLOR[rating] }} />
                </div>
                <span className="num text-[12.5px] text-[var(--color-text-2)] text-start" style={{ width: 36 }}>{c}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[10px]"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        padding: 24
      }}
    >{children}</div>
  );
}

export function Stars({ rating, size = 14, className }: { rating: number; size?: number; className?: string }) {
  // Render 5 icons total. Filled for floor, half if remainder >= 0.5, empty otherwise.
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  const icons: React.ReactNode[] = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= full)            icons.push(<IconStarFilled    key={i} size={size} style={{ color: '#F59E0B' }} />);
    else if (i === full + 1 && hasHalf)
                              icons.push(<IconStarHalfFilled key={i} size={size} style={{ color: '#F59E0B' }} />);
    else                       icons.push(<IconStar          key={i} size={size} style={{ color: '#E4E7EB' }} />);
  }
  return <div className={`flex gap-[1px] ${className ?? ''}`}>{icons}</div>;
}
