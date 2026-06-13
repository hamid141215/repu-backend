import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useNpsTrend, useBranchComparison, useComplaintReasons } from '@/lib/queries';
import { AnalyticsView } from '@/components/analytics/analytics-view';
import { PageSpinner } from '@/components/page-spinner';
import type {
  AnalyticsRange, DashboardSummary
} from '@/types/api';

export default function AnalyticsPage() {
  const [sp] = useSearchParams();
  const rangeParam = sp.get('range') ?? '30d';
  const range: AnalyticsRange = ['30d', '90d', '6m', '1y'].includes(rangeParam) ? rangeParam as AnalyticsRange : '30d';

  const summaryQ    = useQuery({ queryKey: ['dashboard-summary'], queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'), staleTime: 60_000 });
  const npsQ        = useNpsTrend(range);
  const comparisonQ = useBranchComparison(range);
  const reasonsQ    = useComplaintReasons(range);

  if (summaryQ.isLoading || npsQ.isLoading || comparisonQ.isLoading || reasonsQ.isLoading) {
    return <PageSpinner />;
  }

  return (
    <AnalyticsView
      initialRange={range}
      summary={summaryQ.data ?? null}
      initialNps={npsQ.data ?? null}
      initialComparison={comparisonQ.data ?? null}
      initialReasons={reasonsQ.data ?? null}
    />
  );
}
