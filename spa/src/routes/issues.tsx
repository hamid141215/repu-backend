import { Link, useParams, useSearchParams } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { useActionAssignees, useCreateIssueAction, useIssue, useIssueActions, useIssues, useUpdateIssueAction } from '@/lib/queries';
import { getSessionToken, getSessionUser } from '@/lib/auth';
import type { Issue, OperationalAction, OperationalActionStatus, UpdateOperationalActionInput } from '@/types/issues';

const dimensions: Record<string, string> = {
  SERVICE: 'الخدمة', PRODUCT_QUALITY: 'جودة المنتج', STAFF: 'الموظفون', SPEED: 'سرعة الخدمة',
  COMMUNICATION: 'التواصل', AVAILABILITY: 'التوفر', FACILITY: 'المرافق', AMBIENCE: 'الأجواء',
  PRICE: 'السعر', DIGITAL_EXPERIENCE: 'التجربة الرقمية', OTHER: 'أخرى'
};
const statuses = { OPEN: 'مفتوحة', WATCHING: 'تحت المراقبة', RESOLVED: 'محلولة', DISMISSED: 'مستبعدة' };
const severities = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'عالية', CRITICAL: 'حرجة' };
const classifications = { HYPOTHESIS_NOT_CONFIRMED: 'فرضية تحتاج تحقق', VALIDATED: 'تحليل تم التحقق منه', REJECTED: 'فرضية مرفوضة' };
const actionStatuses: Record<OperationalActionStatus, string> = {
  OPEN: 'مفتوح', IN_PROGRESS: 'قيد التنفيذ', DONE: 'مكتمل', CANCELLED: 'ملغي'
};
const number = (value: number) => value === 0 ? '0' : value.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
const percent = (value: number) => `${number(value * 100)}٪`;
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('ar-SA', { calendar: 'gregory' });
}

function IssueHeader({ issue }: { issue: Issue }) {
  return <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-lg font-semibold">{dimensions[issue.dimension] ?? issue.dimension}</h2>
      <p className="mt-1 text-sm text-[var(--color-text-2)] break-words">
        {issue.scopeType === 'CLIENT' ? 'المؤسسة' : `الفرع: ${issue.branchName ?? '—'}`}
      </p>
    </div>
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="rounded-md bg-[var(--color-primary-light)] px-2 py-1">{statuses[issue.status]}</span>
      <span className="rounded-md bg-[var(--color-warn-light)] px-2 py-1">الشدة {severities[issue.severity]}</span>
      <span className="rounded-md bg-[var(--color-bg)] px-2 py-1">الأولوية {number(issue.priority)}</span>
    </div>
  </div>;
}

function SignalSummary({ issue }: { issue: Issue }) {
  return <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
    <span>{number(issue.negativeCount)} إشارات سلبية من {number(issue.totalCount)}</span>
    <span>نسبة الإشارات السلبية {percent(issue.negativeRate)}</span>
  </div>;
}

function IssueActionsPanel({ issueId, recommendedAction, successMetric }: {
  issueId: string; recommendedAction?: string | null; successMetric?: string | null;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [message, setMessage] = useState('');
  const actions = useIssueActions(issueId);
  const assignees = useActionAssignees(showForm || Boolean(editingActionId));
  const createAction = useCreateIssueAction(issueId);
  const updateAction = useUpdateIssueAction(issueId);
  const user = getSessionUser();
  const canManage = Boolean(getSessionToken() && user && ['owner', 'manager'].includes(user.role));
  const isActionsEmpty = Boolean(actions.data && actions.data.items.length === 0);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    createAction.mutate({ title, description, assigneeUserId: assigneeUserId || null, dueDate: dueDate || null }, {
      onSuccess: () => {
        setTitle(''); setDescription(''); setAssigneeUserId(''); setDueDate(''); setShowForm(false);
        setMessage('تم إنشاء الإجراء.');
      },
      onError: () => setMessage('تعذر إنشاء الإجراء. تحقق من البيانات وحاول مجددًا.')
    });
  }

  function transition(action: OperationalAction, status: OperationalActionStatus) {
    setMessage('');
    updateAction.mutate({ actionId: action.id, input: { status } }, {
      onError: () => setMessage('تعذر تحديث حالة الإجراء. أعد تحميل القضية وحاول مجددًا.')
    });
  }

  function saveAction(action: OperationalAction, input: UpdateOperationalActionInput) {
    setMessage('');
    updateAction.mutate({ actionId: action.id, input }, {
      onSuccess: () => {
        setEditingActionId(null);
        setMessage('تم تحديث الإجراء.');
      },
      onError: () => setMessage('تعذر حفظ تعديلات الإجراء. تحقق من البيانات وحاول مجددًا.')
    });
  }

  return <section className="issue-panel mt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">الإجراءات التشغيلية</h2>
      {canManage && !isActionsEmpty && <button type="button" className="section-link" onClick={() => { setMessage(''); setShowForm(value => !value); }}>
        {showForm ? 'إلغاء' : 'إنشاء إجراء'}
      </button>}
    </div>
    {actions.isPending ? <p className="mt-3 text-sm">جارٍ تحميل الإجراءات…</p>
      : actions.isError ? <p role="alert" className="mt-3 text-sm">تعذر تحميل الإجراءات التشغيلية.</p>
        : actions.data?.items.length ? <div className="mt-3 space-y-3">
          {actions.data.items.map(action => <ActionCard key={action.id} action={action} canManage={canManage}
            busy={updateAction.isPending} editing={editingActionId === action.id}
            editDisabled={Boolean(editingActionId && editingActionId !== action.id)}
            assignees={assignees.data?.items ?? []} assigneesLoading={assignees.isLoading}
            assigneesError={assignees.isError}
            onEdit={() => { updateAction.reset(); setMessage(''); setShowForm(false); setEditingActionId(action.id); }}
            onCancelEdit={() => { setEditingActionId(null); setMessage(''); }}
            onSave={input => saveAction(action, input)}
            onTransition={status => transition(action, status)} />)}
        </div> : <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm text-[var(--color-text-2)]">لم يُنشأ إجراء تشغيلي لهذه القضية بعد.</p>
          {canManage && <button type="button" className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white"
            onClick={() => { setMessage(''); setShowForm(value => !value); }}>
            {showForm ? 'إلغاء' : 'إنشاء إجراء'}
          </button>}
        </div>}
    {showForm && canManage && <form className="mt-4 space-y-3 rounded-md border border-[var(--color-border)] p-4" onSubmit={submit}>
      <label className="block text-sm">عنوان الإجراء *
        <input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
      </label>
      {recommendedAction && <div className="rounded-md bg-[var(--color-bg)] p-3 text-sm">
        <p className="font-medium">الإجراء المقترح من التحليل</p>
        <p className="mt-1 whitespace-pre-wrap break-words">{recommendedAction}</p>
        <button type="button" className="section-link mt-2" onClick={() => setDescription(recommendedAction.slice(0, 5000))}>استخدام هذا الاقتراح</button>
      </div>}
      <label className="block text-sm">الوصف
        <textarea maxLength={5000} rows={3} value={description} onChange={event => setDescription(event.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
      </label>
      <label className="block text-sm">المسؤول
        <select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2">
          <option value="">بدون مسؤول</option>
          {(assignees.data?.items ?? []).map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}
        </select>
      </label>
      {assignees.isError && <p className="text-xs text-[var(--color-bad)]">تعذر تحميل قائمة المسؤولين؛ يمكنك إنشاء الإجراء بدون مسؤول.</p>}
      <label className="block text-sm">تاريخ الاستحقاق
        <input type="date" dir="ltr" value={dueDate} onChange={event => setDueDate(event.target.value)}
          className="mt-1 block rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
      </label>
      {successMetric && <p className="rounded-md bg-[var(--color-bg)] p-3 text-sm"><span className="font-medium">مؤشر النجاح المقترح: </span>{successMetric}</p>}
      <button type="submit" disabled={createAction.isPending || !title.trim()}
        className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {createAction.isPending ? 'جارٍ الإنشاء…' : 'إنشاء الإجراء'}
      </button>
    </form>}
    {message && <p role="status" className="mt-3 text-sm text-[var(--color-text-2)]">{message}</p>}
  </section>;
}

function ActionCard({ action, canManage, busy, editing, editDisabled, assignees, assigneesLoading, assigneesError,
  onEdit, onCancelEdit, onSave, onTransition }: {
  action: OperationalAction; canManage: boolean; busy: boolean; editing: boolean; editDisabled: boolean;
  assignees: { id: string; displayName: string }[]; assigneesLoading: boolean; assigneesError: boolean;
  onEdit: () => void; onCancelEdit: () => void; onSave: (input: UpdateOperationalActionInput) => void;
  onTransition: (status: OperationalActionStatus) => void;
}) {
  const next = nextActionStatuses[action.status];
  return <article className="rounded-md border border-[var(--color-border)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="min-w-0 break-words font-semibold">{action.title}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 rounded-md bg-[var(--color-primary-light)] px-2 py-1 text-xs">{actionStatuses[action.status]}</span>
        {canManage && <button type="button" disabled={busy || editDisabled} onClick={onEdit}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] disabled:opacity-50">
          تعديل
        </button>}
      </div>
    </div>
    {action.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--color-text-2)]">{action.description}</p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--color-text-2)]">
      <span>المسؤول: {action.assignee?.displayName ?? 'بدون مسؤول'}</span>
      <span>الاستحقاق: {action.dueDate ? date(action.dueDate) : 'غير محدد'}</span>
      {action.isOverdue && <span className="rounded bg-[var(--color-bad-light)] px-2 py-0.5 text-[var(--color-bad)]">متأخر</span>}
      {action.status === 'DONE' && action.completedAt && <span>اكتمل: {date(action.completedAt)}</span>}
    </div>
    {canManage && next.length > 0 && <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      تحديث الحالة
      <select value={action.status} disabled={busy} onChange={event => onTransition(event.target.value as OperationalActionStatus)}
        className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1">
        <option value={action.status}>{actionStatuses[action.status]}</option>
        {next.map(status => <option key={status} value={status}>{actionStatuses[status]}</option>)}
      </select>
    </label>}
    {editing && canManage && <ActionEditForm action={action} assignees={assignees}
      assigneesLoading={assigneesLoading} assigneesError={assigneesError} busy={busy}
      onCancel={onCancelEdit} onSave={onSave} />}
  </article>;
}

function ActionEditForm({ action, assignees, assigneesLoading, assigneesError, busy, onCancel, onSave }: {
  action: OperationalAction; assignees: { id: string; displayName: string }[];
  assigneesLoading: boolean; assigneesError: boolean; busy: boolean;
  onCancel: () => void; onSave: (input: UpdateOperationalActionInput) => void;
}) {
  const [title, setTitle] = useState(action.title);
  const [description, setDescription] = useState(action.description ?? '');
  const [assigneeUserId, setAssigneeUserId] = useState(action.assignee?.id ?? '');
  const [dueDate, setDueDate] = useState(action.dueDate?.slice(0, 10) ?? '');
  const currentAssigneeUnavailable = action.assignee && !assignees.some(person => person.id === action.assignee?.id);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: UpdateOperationalActionInput = {};
    if (title !== action.title) input.title = title;
    if (description !== (action.description ?? '')) input.description = description;
    if (assigneeUserId !== (action.assignee?.id ?? '')) input.assigneeUserId = assigneeUserId || null;
    if (dueDate !== (action.dueDate?.slice(0, 10) ?? '')) input.dueDate = dueDate || null;
    if (Object.keys(input).length > 0) onSave(input);
  }

  return <form className="mt-4 grid min-w-0 grid-cols-1 gap-3 rounded-md border border-[var(--color-border)] p-3 sm:p-4"
    onSubmit={submit}>
    <label className="block min-w-0 text-sm">عنوان الإجراء *
      <input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)}
        className="mt-1 w-full min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
    </label>
    <label className="block min-w-0 text-sm">الوصف
      <textarea maxLength={5000} rows={3} value={description} onChange={event => setDescription(event.target.value)}
        className="mt-1 w-full min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
    </label>
    <label className="block min-w-0 text-sm">المسؤول
      <select value={assigneeUserId} onChange={event => setAssigneeUserId(event.target.value)}
        className="mt-1 w-full min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3 py-2">
        <option value="">بدون مسؤول</option>
        {currentAssigneeUnavailable && action.assignee &&
          <option value={action.assignee.id}>{action.assignee.displayName} (المسؤول الحالي)</option>}
        {assignees.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}
      </select>
    </label>
    {assigneesLoading && <p className="m-0 text-xs text-[var(--color-text-3)]">جارٍ تحميل المسؤولين…</p>}
    {assigneesError && <p className="m-0 text-xs text-[var(--color-bad)]">تعذر تحميل قائمة المسؤولين؛ يمكنك إبقاء المسؤول الحالي أو فك الإسناد.</p>}
    <label className="block min-w-0 text-sm">تاريخ الاستحقاق
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input type="date" dir="ltr" value={dueDate} onChange={event => setDueDate(event.target.value)}
          className="block min-w-0 max-w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2" />
        {dueDate && <button type="button" onClick={() => setDueDate('')}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-2 text-xs">مسح التاريخ</button>}
      </div>
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={busy || !title.trim() || ![
        title !== action.title,
        description !== (action.description ?? ''),
        assigneeUserId !== (action.assignee?.id ?? ''),
        dueDate !== (action.dueDate?.slice(0, 10) ?? '')
      ].some(Boolean)}
        className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? 'جارٍ الحفظ…' : 'حفظ التعديلات'}
      </button>
      <button type="button" disabled={busy} onClick={onCancel}
        className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50">إلغاء</button>
    </div>
  </form>;
}

const nextActionStatuses: Record<OperationalActionStatus, OperationalActionStatus[]> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['OPEN', 'DONE', 'CANCELLED'],
  DONE: ['OPEN', 'IN_PROGRESS'],
  CANCELLED: ['OPEN']
};

export default function IssuesPage() {
  const [search, setSearch] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rawPage = Number(search.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 && rawPage <= 1000000 ? rawPage : 1;
  const status = search.get('status') || 'OPEN,WATCHING';
  const params = {
    page, pageSize: 20, status, severity: search.get('severity') || '',
    dimension: search.get('dimension') || '', scope_type: search.get('scope_type') || '',
    branch: search.get('branch') || '', q: search.get('q') || ''
  };
  const query = useIssues(params);
  const items = query.data?.items ?? [];
  const priorities = items.map(item => item.priority).filter(Number.isFinite);
  const issueGridClass = items.length === 1
    ? 'mx-auto grid w-full max-w-4xl grid-cols-1 gap-4'
    : 'mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2';
  function change(key: string, value: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearch(next, { replace: key === 'q' || key === 'branch' });
  }
  return <div dir="rtl" className="page-shell p-7 min-w-0">
    <h1 className="text-2xl font-semibold">القضايا التشغيلية</h1>
    <p className="mt-2 text-sm text-[var(--color-text-2)]">المشكلات المتكررة التي اكتشفها Repu من إشارات العملاء</p>
    {query.data && !query.isError && <section aria-label="ملخص الصفحة الحالية" className="mt-6">
      <p className="mb-2 text-xs text-[var(--color-text-3)]">ملخص القضايا المعروضة في الصفحة الحالية</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['القضايا المفتوحة', number(items.filter(i => i.status === 'OPEN').length)],
          ['الشدة العالية', number(items.filter(i => i.severity === 'HIGH').length)],
          ['تحت المراقبة', number(items.filter(i => i.status === 'WATCHING').length)],
          ['متوسط الأولوية', priorities.length ? number(priorities.reduce((sum, priority) => sum + priority, 0) / priorities.length) : '—']
        ].map(([label, value]) => <div className="issue-panel" key={label}><p className="text-xs text-[var(--color-text-2)]">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}
      </div>
    </section>}
    <form className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" onSubmit={e => e.preventDefault()} aria-label="فلاتر القضايا">
      <label className="issue-filter">الحالة<select value={status} onChange={e => change('status', e.target.value)}>
        <option value="OPEN,WATCHING">مفتوحة وتحت المراقبة</option>
        <option value="OPEN,WATCHING,RESOLVED,DISMISSED">كل الحالات</option>
        {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="issue-filter">الشدة<select value={params.severity} onChange={e => change('severity', e.target.value)}>
        <option value="">كل درجات الشدة</option>{Object.entries(severities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="issue-filter">البعد<select value={params.dimension} onChange={e => change('dimension', e.target.value)}>
        <option value="">كل الأبعاد</option>{Object.entries(dimensions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="issue-filter">النطاق<select value={params.scope_type} onChange={e => change('scope_type', e.target.value)}>
        <option value="">كل النطاقات</option><option value="CLIENT">المؤسسة</option><option value="BRANCH">الفرع</option>
      </select></label>
      <label className="issue-filter">الفرع<input value={params.branch} maxLength={200} placeholder="اسم الفرع المطابق" onChange={e => change('branch', e.target.value)} /></label>
      <label className="issue-filter">البحث<input type="search" value={params.q} maxLength={200} placeholder="رمز البعد أو اسم الفرع" onChange={e => change('q', e.target.value)} /></label>
    </form>
    <div className="mt-6" aria-live="polite" aria-busy={query.isFetching}>
      {query.isPending ? <p>جارٍ تحميل القضايا…</p> : query.isError ? <div role="alert" className="issue-panel">تعذر تحميل القضايا. <button type="button" className="section-link" onClick={() => void query.refetch()}>إعادة المحاولة</button></div> : <>
        {!items.length ? <p className="issue-panel">لا توجد قضايا تشغيلية مطابقة للفلاتر الحالية.</p> : <div className={issueGridClass}>
          {items.map(issue => <article key={issue.id} className="issue-panel">
            <IssueHeader issue={issue} /><SignalSummary issue={issue} />
            <p className="mt-3 text-xs text-[var(--color-text-3)]">الفترة: {date(issue.windowStart)} – {date(issue.windowEnd)}</p>
            <p className="mt-1 text-xs text-[var(--color-text-3)]">آخر تحديث: {date(issue.updatedAt)}</p>
            <p className="mt-2 text-xs">{number(issue.evidenceCount)} إشارات سلبية مؤهلة كأدلة</p>
            {issue.enrichment && <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <p className="text-xs text-[var(--color-text-2)]">{classifications[issue.enrichment.classification]}</p>
              {issue.enrichment.likelyCause && <p className="mt-1 text-sm line-clamp-2 break-words">السبب المحتمل: {issue.enrichment.likelyCause}</p>}
            </div>}
            <Link className="section-link mt-4" to={{ pathname: `/issues/${issue.id}`, search: search.toString() }} onClick={event => {
              if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                event.preventDefault(); setSelectedId(issue.id);
              }
            }}>عرض تفاصيل القضية</Link>
          </article>)}
        </div>}
        {query.data && <nav aria-label="صفحات القضايا" className="mt-5 flex flex-wrap items-center gap-4 text-sm">
          <button className="issue-page-button" disabled={page === 1 || query.isFetching} onClick={() => change('page', String(page - 1))}>السابق</button>
          <span>الصفحة {number(page)} · {number(query.data.pagination.total)} قضية مطابقة</span>
          <button className="issue-page-button" disabled={!query.data.pagination.hasMore || query.isFetching} onClick={() => change('page', String(page + 1))}>التالي</button>
        </nav>}
      </>}
    </div>
    {selectedId && <IssueDetailPage selectedId={selectedId} onClose={() => setSelectedId(null)} />}
  </div>;
}

export function IssueDetailPage({ selectedId, onClose }: { selectedId?: string; onClose?: () => void } = {}) {
  const { issueId } = useParams();
  const [search] = useSearchParams();
  const query = useIssue(selectedId ?? issueId);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const issue = query.data?.issue;
  const content = <div dir="rtl" className="page-shell p-7 min-w-0 max-w-5xl">
    {onClose ? <button type="button" className="section-link mb-5" onClick={onClose}>إغلاق التفاصيل</button> : <Link className="section-link mb-5" to={{ pathname: '/issues', search: search.toString() }}>العودة إلى القضايا</Link>}
    <h1 id="issue-detail-title" className="text-2xl font-semibold mb-5">تفاصيل القضية التشغيلية</h1>
    {query.isPending ? <p role="status">جارٍ تحميل القضية…</p> : query.isError ? <p role="alert" className="issue-panel">تعذر عرض القضية؛ قد تكون غير متاحة. <button className="section-link" onClick={() => void query.refetch()}>إعادة المحاولة</button></p> : issue && <>
      <section className="issue-panel"><IssueHeader issue={issue} />
        <p className="mt-4 text-sm">الفترة: {date(issue.windowStart)} – {date(issue.windowEnd)}</p>
        <p className="mt-2 text-xs text-[var(--color-text-3)]">اكتُشفت: {date(issue.detectedAt)} · آخر تحديث: {date(issue.updatedAt)}</p>
      </section>
      <section className="issue-panel mt-4"><h2 className="font-semibold">ما الذي يحدث؟</h2><SignalSummary issue={issue} /></section>
      <section className="issue-panel mt-4"><h2 className="font-semibold">الأدلة</h2>
        <p className="mt-2 text-xs text-[var(--color-text-3)]">بيانات وصفية لما يصل إلى ١٠ إشارات من أصل {number(issue.evidenceCount)} إشارة مؤهلة ضمن نطاق القضية وفترتها.</p>
        <p className="mt-3 text-sm">نصوص الأدلة غير معروضة حفاظًا على الخصوصية.</p>
        {!query.data?.evidence.length && issue.evidenceCount > 0 && <p className="mt-3 text-xs text-[var(--color-text-3)]">تعذر تحميل بيانات معاينة الإشارات حاليًا.</p>}
        {query.data?.evidence.length > 0 && <div className="mt-4 space-y-3">
          {query.data.evidence.map((evidence, index) => <article key={`${evidence.evaluationId}-${index}`} className="rounded-md bg-[var(--color-bg)] p-4">
            <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-2)]">
              <span>سلبية</span><span>الثقة {percent(evidence.confidence)}</span>
              <span className="break-words">{evidence.branchName ? `الفرع: ${evidence.branchName}` : 'الفرع غير محدد'}</span>
              <span>تاريخ تسجيل الإشارة: {date(evidence.createdAt)}</span>
            </div>
          </article>)}
        </div>}
      </section>
      <IssueActionsPanel issueId={issue.id} recommendedAction={issue.enrichment?.recommendedAction}
        successMetric={issue.enrichment?.successMetric} />
      <section className="issue-panel mt-4"><h2 className="font-semibold">التحليل</h2>
        {!issue.enrichment ? <p className="mt-4 text-sm">لم يُنشأ تحليل سببي لهذه القضية بعد</p> : <>
          <p className="mt-3 rounded-md bg-[var(--color-warn-light)] p-3 text-sm">{classifications[issue.enrichment.classification]}</p>
          <dl className="mt-4 space-y-4">
            {[
              ['السبب المحتمل', issue.enrichment.likelyCause], ['لماذا؟', issue.enrichment.whyText],
              ['الإجراء المقترح', issue.enrichment.recommendedAction], ['مؤشر النجاح', issue.enrichment.successMetric]
            ].map(([label, text]) => <div key={label}><dt className="text-sm font-semibold">{label}</dt><dd className="mt-1 text-sm whitespace-pre-wrap break-words text-[var(--color-text-2)]">{text || 'غير متاح'}</dd></div>)}
          </dl>
          <p className="mt-4 text-xs text-[var(--color-text-3)]">{issue.enrichment.confidence != null && `ثقة التحليل ${percent(issue.enrichment.confidence)} · `}آخر تحديث للتحليل: {date(issue.enrichment.updatedAt)}</p>
        </>}
      </section>
    </>}
  </div>;
  return onClose ? <dialog ref={dialogRef} dir="rtl" className="issue-detail-dialog" aria-labelledby="issue-detail-title" onCancel={onClose} onClick={event => {
    if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }
  }}>{content}</dialog> : content;
}
