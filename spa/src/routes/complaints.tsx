import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ComplaintsView } from '@/components/complaints/complaints-view';
import { PageSpinner } from '@/components/page-spinner';
import type { ComplaintsResponse, DashboardSummary } from '@/types/api';

export default function ComplaintsPage() {
  const [sp] = useSearchParams();
  const status   = sp.get('status')   || 'all';
  const priority = sp.get('priority') || '';
  const branch   = sp.get('branch')   || '';
  const q        = sp.get('q')        || '';
  const page     = Math.max(1, Number(sp.get('page')) || 1);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '20');
  if (status && status !== 'all') params.set('status', status);
  if (priority) params.set('priority', priority);
  if (branch)   params.set('branch', branch);
  if (q)        params.set('q', q);

  const complaintsQ = useQuery({
    queryKey: ['complaints', status, priority, branch, q, page],
    queryFn: () => apiClient<ComplaintsResponse>(`/api/complaints?${params.toString()}`)
  });
  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 60_000
  });

  if (complaintsQ.isLoading) return <PageSpinner />;

  return <ComplaintsView initialComplaints={complaintsQ.data ?? { items: [], total: 0, page: 1, pageSize: 20, hasMore: false }}
                          summary={summaryQ.data ?? null} />;
}
