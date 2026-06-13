import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useClientInfo } from '@/lib/queries';
import { apiClient } from '@/lib/api-client';
import type { DashboardSummary } from '@/types/api';

export function AppLayout() {
  const { data: client } = useClientInfo();
  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 60_000
  });
  return (
    <>
      <Sidebar
        clientName={client?.name ?? ''}
        reviewsCount={summary?.rating_count ?? 0}
        complaintsCount={summary?.complaint_count ?? 0}
      />
      <main style={{ marginRight: 248, minHeight: '100vh' }}>
        <Topbar />
        <Outlet />
      </main>
    </>
  );
}
