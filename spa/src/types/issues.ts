export interface IssueEnrichment {
  classification: 'HYPOTHESIS_NOT_CONFIRMED' | 'VALIDATED' | 'REJECTED';
  confidence: number | null;
  likelyCause: string | null;
  recommendedAction: string | null;
  successMetric: string | null;
  whyText?: string | null;
  enrichedAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  dimension: string;
  scopeType: 'CLIENT' | 'BRANCH';
  branchName: string | null;
  windowStart: string;
  windowEnd: string;
  positiveCount: number;
  negativeCount: number;
  totalCount: number;
  negativeRate: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  priority: number;
  status: 'OPEN' | 'WATCHING' | 'RESOLVED' | 'DISMISSED';
  detectedAt: string;
  updatedAt: string;
  evidenceCount: number;
  enrichment: IssueEnrichment | null;
}

export interface IssuesResponse {
  success: true;
  items: Issue[];
  pagination: { page: number; pageSize: number; total: number; hasMore: boolean };
}

export interface IssueDetailResponse {
  success: true;
  issue: Issue;
  evidence: {
    evaluationId: string;
    branchName: string | null;
    dimension: string;
    sentiment: string;
    confidence: number;
    createdAt: string;
  }[];
}

export interface IssuesQueryParams {
  page?: number;
  pageSize?: number;
  status?: string;
  severity?: string;
  dimension?: string;
  scope_type?: string;
  branch?: string;
  q?: string;
}
