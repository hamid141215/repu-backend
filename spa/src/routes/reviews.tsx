import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ReviewsView } from '@/components/reviews/reviews-view';
import { PageSpinner } from '@/components/page-spinner';
import type { ReviewsResponse, DashboardSummary } from '@/types/api';

export default function ReviewsPage() {
  const [sp] = useSearchParams();
  const tab  = sp.get('tab')  || 'all';
  const q    = sp.get('q')    || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '24');
  if (tab === '5')             { params.set('min_rating', '5'); params.set('max_rating', '5'); }
  else if (tab === 'low')      { params.set('max_rating', '2'); }
  else if (tab === 'nfc')      { params.set('source', 'nfc'); }
  else if (tab === 'internal') { params.set('source', 'dashboard'); }
  if (q) params.set('q', q);

  const reviewsQ = useQuery({
    queryKey: ['reviews', tab, q, page],
    queryFn: () => apiClient<ReviewsResponse>(`/api/reviews?${params.toString()}`)
  });
  const summaryQ = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient<DashboardSummary>('/api/dashboard-summary'),
    staleTime: 60_000
  });

  if (reviewsQ.isLoading) return <PageSpinner />;

  return <ReviewsView initialReviews={reviewsQ.data ?? { items: [], total: 0, page: 1, pageSize: 24, hasMore: false }}
                       summary={summaryQ.data ?? null} />;
}
