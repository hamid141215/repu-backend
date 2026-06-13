import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ReportsView } from '@/components/reports/reports-view';
import { PageSpinner } from '@/components/page-spinner';
import type { DashboardSummary } from '@/types/api';

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 60_000
  });
  if (isLoading) return <PageSpinner />;
  return <ReportsView summary={data ?? null} />;
}
