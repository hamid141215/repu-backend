/**
 * TanStack Query hooks for client components.
 * All hooks here go through apiClient → /api/proxy/* — never directly to
 * the backend (the browser can't read the httpOnly cookie).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './api-client';
import type {
  ActivityResponse, ReviewsResponse, ReviewRow,
  ComplaintsResponse, ComplaintListItem,
  BranchesResponse, BranchRow,
  NpsResponse, BranchComparisonResponse, ComplaintReasonsResponse, AnalyticsRange,
  ClientInfo
} from '@/types/api';

function buildQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/* ─── Activity ─────────────────────────────────────────────────────────── */
export function useActivity(initial?: ActivityResponse, limit = 5) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: () => apiClient<ActivityResponse>(`/api/activity?limit=${limit}`),
    initialData: initial,
    refetchInterval: 30_000,
    staleTime: 15_000
  });
}

/* ─── Reviews ──────────────────────────────────────────────────────────── */
export interface ReviewsQueryParams {
  page?: number; pageSize?: number;
  min_rating?: number; max_rating?: number;
  source?: string; branch?: string;
  has_reply?: 'true' | 'false';
  q?: string;
}

export function useReviews(params: ReviewsQueryParams, initial?: ReviewsResponse) {
  const qs = buildQueryString(params as Record<string, unknown>);
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: () => apiClient<ReviewsResponse>(`/api/reviews${qs}`),
    initialData: initial,
    staleTime: 60_000
  });
}

export function useReplyReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) =>
      apiClient<{ success: true; review: ReviewRow }>(`/api/reviews/${id}/reply`, {
        method: 'POST', body: JSON.stringify({ text })
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews'] })
  });
}

/* ─── Complaints ──────────────────────────────────────────────────────── */
export interface ComplaintsQueryParams {
  page?: number; pageSize?: number;
  status?: string; priority?: string; branch?: string;
  from?: string; to?: string; q?: string;
}

export function useComplaints(params: ComplaintsQueryParams, initial?: ComplaintsResponse) {
  const qs = buildQueryString(params as Record<string, unknown>);
  return useQuery({
    queryKey: ['complaints', params],
    queryFn: () => apiClient<ComplaintsResponse>(`/api/complaints${qs}`),
    initialData: initial,
    staleTime: 30_000
  });
}

export function useComplaint(id: number | null) {
  return useQuery({
    queryKey: ['complaints', 'detail', id],
    queryFn: () => apiClient<ComplaintListItem>(`/api/complaints/${id}`),
    enabled: id != null,
    staleTime: 30_000
  });
}

export function useUpdateComplaintStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, complaint_status, complaint_note }: { id: number; complaint_status: string; complaint_note?: string | null }) =>
      apiClient<{ success: true; complaint: ComplaintListItem }>(`/api/client/complaints/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ complaint_status, complaint_note: complaint_note ?? null })
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['complaints'] });
      qc.invalidateQueries({ queryKey: ['complaints', 'detail', vars.id] });
    }
  });
}

/* ─── Branches ─────────────────────────────────────────────────────────── */
export function useBranches(initial?: BranchesResponse) {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => apiClient<BranchesResponse>('/api/branches'),
    initialData: initial,
    staleTime: 5 * 60_000
  });
}

export interface BranchInput {
  name: string;
  city?: string | null;
  area?: string | null;
  google_link?: string | null;
  nfc_id?: string | null;
  is_active?: boolean;
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BranchInput) =>
      apiClient<{ success: true; branch: BranchRow }>('/api/branches', {
        method: 'POST', body: JSON.stringify(input)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] })
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: BranchInput & { id: number }) =>
      apiClient<{ success: true; branch: BranchRow }>(`/api/branches/${id}`, {
        method: 'PATCH', body: JSON.stringify(input)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] })
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      apiClient<{ success: true }>(`/api/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] })
  });
}

/* ─── Analytics ────────────────────────────────────────────────────────── */
export function useNpsTrend(range: AnalyticsRange, initial?: NpsResponse) {
  return useQuery({
    queryKey: ['analytics', 'nps', range],
    queryFn: () => apiClient<NpsResponse>(`/api/analytics/nps?range=${range}`),
    initialData: initial,
    staleTime: 5 * 60_000
  });
}

export function useBranchComparison(range: AnalyticsRange, initial?: BranchComparisonResponse) {
  return useQuery({
    queryKey: ['analytics', 'branch-comparison', range],
    queryFn: () => apiClient<BranchComparisonResponse>(`/api/analytics/branch-comparison?range=${range}`),
    initialData: initial,
    staleTime: 5 * 60_000
  });
}

export function useComplaintReasons(range: AnalyticsRange, initial?: ComplaintReasonsResponse) {
  return useQuery({
    queryKey: ['analytics', 'complaint-reasons', range],
    queryFn: () => apiClient<ComplaintReasonsResponse>(`/api/analytics/complaint-reasons?range=${range}`),
    initialData: initial,
    staleTime: 5 * 60_000
  });
}

/* ─── Client info + settings ─────────────────────────────────────────── */
export function useClientInfo(initial?: ClientInfo) {
  return useQuery({
    queryKey: ['client-info'],
    queryFn: () => apiClient<ClientInfo>('/api/client-info'),
    initialData: initial,
    staleTime: 60_000
  });
}

export interface ComplaintSettingsInput {
  complaint_action: 'contact' | 'discount' | 'contact_discount';
  discount_code?: string | null;
  complaint_message?: string | null;
  whatsapp_contact?: string | null;
}

interface ComplaintSettingsResponse {
  success: true;
  settings: {
    id: number;
    complaint_action: 'contact' | 'discount' | 'contact_discount';
    discount_code: string | null;
    complaint_message: string | null;
    whatsapp_contact: string | null;
  };
}

export function useUpdateComplaintSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ComplaintSettingsInput) =>
      apiClient<ComplaintSettingsResponse>('/api/client/complaint-settings', {
        method: 'PATCH',
        body: JSON.stringify(input)
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-info'] })
  });
}

/* ─── Campaigns ───────────────────────────────────────────────────────── */
export interface SendCampaignInput {
  name: string;
  phone: string;
  branch?: string | null;
}

export function useSendCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendCampaignInput) =>
      apiClient<{ success: true }>('/api/send', {
        method: 'POST',
        body: JSON.stringify(input)
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity'] });
    }
  });
}
