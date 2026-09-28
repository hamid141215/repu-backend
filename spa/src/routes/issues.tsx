import { Link, useParams, useSearchParams } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { useIssue, useIssues } from '@/lib/queries';
import type { Issue } from '@/types/issues';

const dimensions: Record<string, string> = {
  SERVICE: 'الخدمة', PRODUCT_QUALITY: 'جودة المنتج', STAFF: 'الموظفون', SPEED: 'سرعة الخدمة',
  COMMUNICATION: 'التواصل', AVAILABILITY: 'التوفر', FACILITY: 'المرافق', AMBIENCE: 'الأجواء',
  PRICE: 'السعر', DIGITAL_EXPERIENCE: 'التجربة الرقمية', OTHER: 'أخرى'
};
const statuses = { OPEN: 'مفتوحة', WATCHING: 'تحت المراقبة', RESOLVED: 'محلولة', DISMISSED: 'مستبعدة' };
const severities = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'عالية', CRITICAL: 'حرجة' };
const classifications = { HYPOTHESIS_NOT_CONFIRMED: 'فرضية تحتاج تحقق', VALIDATED: 'تحليل تم التحقق منه', REJECTED: 'فرضية مرفوضة' };
const number = (value: number) => value.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
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
          ['متوسط الأولوية', items.length ? number(items.reduce((sum, i) => sum + i.priority, 0) / items.length) : '—']
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
        {!items.length ? <p className="issue-panel">لا توجد قضايا تشغيلية مطابقة للفلاتر الحالية.</p> : <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
