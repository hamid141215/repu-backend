/* ============================================================================
 * Shapes returned by the RepuSystem backend (https://repu.mawjatalsamt.com).
 * Only fields the v1 UI actually reads are typed — leaving the rest unknown
 * keeps us honest about what we depend on.
 * ========================================================================= */

export interface ClientInfo {
  name: string;
  nfc_id: string | null;
  total?: number;
  positive_count?: number;
  complaint_count?: number;
  satisfaction_rate?: number;
  google_link?: string | null;
  complaint_action?: 'contact' | 'discount' | 'contact_discount';
  discount_code?: string | null;
  complaint_message?: string | null;
  whatsapp_number?: string | null;
  whatsapp_contact?: string | null;
}

export interface MonthlyPoint { month: string; total: number; }
export interface DailyPoint {
  date: string;
  total: number;
  positive_count: number;
  complaint_count: number;
}

export interface BranchPerformance {
  branch: string;
  total_evaluations: number;
  rating_count: number;
  average_rating: number;
  complaint_count: number;
  positive_count: number;
  low_rating_count: number;
  low_rating_rate: number;
}

export interface ComplaintRow {
  id: number;
  name: string | null;
  phone: string | null;
  branch: string | null;
  status: string;
  answer: string | null;
  source: string | null;
  feedback: string | null;
  sent_at: string;
  complaint_status: string | null;
  complaint_updated_at: string | null;
  complaint_resolved_at: string | null;
  complaint_note: string | null;
  is_overdue?: boolean;
}

export interface WorkflowSummary {
  new_count: number;
  in_progress_count: number;
  contacted_count: number;
  resolved_count: number;
  closed_count: number;
  overdue_count: number;
}

export interface ActivityItem {
  id: number;
  name: string | null;
  branch: string | null;
  rating: number | null;
  status: string;
  answer: string | null;
  source: string | null;
  sent_at: string;
}

export interface DashboardSummary {
  total_evaluations: number;
  positive_count: number;
  complaint_count: number;
  satisfaction_rate: number;
  monthly_counts: MonthlyPoint[];
  daily_counts_last_30_days: DailyPoint[];
  source_breakdown: Array<{ source: string; total: number }>;
  average_rating: number;
  rating_count: number;
  rating_breakdown: Array<{ rating: number; count: number }>;
  low_rating_count: number;
  low_rating_rate: number;
  branch_performance: BranchPerformance[];
  best_branches: BranchPerformance[];
  weak_branches: BranchPerformance[];
  complaint_workflow_summary: WorkflowSummary;
  recent_activity: ActivityItem[];
  urgent_complaints: ComplaintRow[];
}

export interface ActivityResponse { items: ActivityItem[]; }

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ReviewRow {
  id: number;
  name: string | null;
  phone: string | null;
  branch: string | null;
  rating: number;
  feedback: string | null;
  source: string | null;
  status: string;
  answer: string | null;
  sent_at: string;
  reply_text: string | null;
  replied_at: string | null;
}

export type ReviewsResponse = PaginatedResponse<ReviewRow>;

/* ── Complaints (Phase 5 list endpoint shape) ────────────────────────── */
export interface ComplaintListItem extends ComplaintRow {
  rating?: number | null;
  reply_text?: string | null;
  replied_at?: string | null;
  priority: 'urgent' | 'medium' | 'low' | 'closed';
  age_hours: number;
}
export type ComplaintsResponse = PaginatedResponse<ComplaintListItem>;

/* ── Branches (client-scoped endpoints) ──────────────────────────────── */
export interface BranchRow {
  id: number;
  client_id: number;
  name: string;
  city: string | null;
  area: string | null;
  nfc_id: string | null;
  google_link: string | null;
  is_active: boolean;
  created_at: string;
  total_evaluations: number;
  rating_count: number;
  average_rating: number;
  complaint_count: number;
  positive_count: number;
  last_activity_at: string | null;
}
export interface BranchesResponse { items: BranchRow[]; }
export interface BranchDetail extends BranchRow {
  stats?: {
    total_evaluations: number;
    rating_count: number;
    average_rating: number;
    complaint_count: number;
    positive_count: number;
    last_activity_at: string | null;
  };
}

/* ── Analytics ───────────────────────────────────────────────────────── */
export type AnalyticsRange = '30d' | '90d' | '6m' | '1y';

export interface NpsPoint {
  bucket: string;
  total: number;
  positive_count: number;
  complaint_count: number;
  avg_rating: number;
  satisfaction_rate: number;
}
export interface NpsResponse { range: AnalyticsRange; bucket: 'day' | 'week'; points: NpsPoint[]; }

export interface BranchComparisonRow {
  branch: string;
  total_evaluations: number;
  rating_count: number;
  average_rating: number;
  positive_count: number;
  complaint_count: number;
}
export interface BranchComparisonResponse { range: AnalyticsRange; branches: BranchComparisonRow[]; }

export interface ComplaintReasonSegment { category: string; count: number; }
export interface ComplaintReasonsResponse { range: AnalyticsRange; total: number; segments: ComplaintReasonSegment[]; }
