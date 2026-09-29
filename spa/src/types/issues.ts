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

export type OperationalActionStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface ActionPerson {
  id: string;
  displayName: string;
}

export interface OperationalAction {
  id: string;
  issueId: string;
  title: string;
  description: string | null;
  status: OperationalActionStatus;
  dueDate: string | null;
  assignee: ActionPerson | null;
  createdBy: ActionPerson | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  isOverdue: boolean;
  outcomes?: ActionOutcome[];
}

export type ActionOutcomeStatus = 'PENDING' | 'INSUFFICIENT_DATA' | 'IMPROVED' | 'UNCHANGED' | 'WORSENED';

export interface ActionOutcomeWindow {
  start: string;
  end: string;
}

export interface ActionOutcomeMetrics {
  negativeCount: number | null;
  totalCount: number | null;
  negativeRate: number | null;
}

export interface ActionOutcome {
  id: string;
  actionId: string;
  completedAt: string;
  baselineWindow: ActionOutcomeWindow;
  postWindow: ActionOutcomeWindow;
  status: ActionOutcomeStatus;
  baseline: ActionOutcomeMetrics;
  post: ActionOutcomeMetrics;
  deltaNegativeRate: number | null;
  measuredAt: string | null;
}

export interface ActionOutcomesResponse {
  success: true;
  items: ActionOutcome[];
}

export interface OperationalActionsResponse {
  success: true;
  items: OperationalAction[];
}

export interface OperationalActionResponse {
  success: true;
  action: OperationalAction;
}

export interface ActionAssigneesResponse {
  success: true;
  items: ActionPerson[];
}

export interface CreateOperationalActionInput {
  title: string;
  description?: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
}

export type UpdateOperationalActionInput = Partial<CreateOperationalActionInput> & {
  status?: OperationalActionStatus;
};

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
