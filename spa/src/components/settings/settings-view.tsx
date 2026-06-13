'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  IconBuilding, IconBrandGoogle, IconBrandWhatsapp,
  IconBellRinging, IconCreditCard, IconKey
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useClientInfo, useUpdateComplaintSettings, type ComplaintSettingsInput } from '@/lib/queries';
import { EmptyState } from '@/components/empty-state';
import type { ClientInfo } from '@/types/api';

type SectionKey = 'organization' | 'google' | 'whatsapp' | 'notifications' | 'billing' | 'api';

const SECTIONS: Array<{ key: SectionKey; label: string; icon: React.ReactNode }> = [
  { key: 'organization',  label: 'المؤسسة والشكاوى',  icon: <IconBuilding size={16} /> },
  { key: 'google',        label: 'تكامل Google',     icon: <IconBrandGoogle size={16} /> },
  { key: 'whatsapp',      label: 'تكامل واتساب',     icon: <IconBrandWhatsapp size={16} /> },
  { key: 'notifications', label: 'الإشعارات',        icon: <IconBellRinging size={16} /> },
  { key: 'billing',       label: 'الفوترة',          icon: <IconCreditCard size={16} /> },
  { key: 'api',           label: 'API ومفاتيح',      icon: <IconKey size={16} /> }
];

interface Props {
  initialClient: ClientInfo | null;
  initialSection: string;
}

export function SettingsView({ initialClient, initialSection }: Props) {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const section = ((sp.get('section') as SectionKey | null) ?? initialSection) as SectionKey;

  const setSection = useCallback((s: SectionKey) => {
    const params = new URLSearchParams(sp.toString());
    if (s === 'organization') params.delete('section');
    else params.set('section', s);
    navigate(`/settings?${params.toString()}`);
  }, [navigate, sp]);

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">إعدادات الحساب</h1>
        <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">إدارة الإعدادات العامة وقواعد تعامل الشكاوى</p>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '220px 1fr' }}>
        {/* Sub nav */}
        <aside>
          {SECTIONS.map(({ key, label, icon }) => {
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={cn(
                  'mb-px w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13.5px] font-medium transition',
                  active ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-2)] hover:bg-[#F4F5F7]'
                )}
                style={active ? { background: 'var(--color-primary-light)' } : undefined}
              >
                <span className="opacity-90 shrink-0">{icon}</span>
                {label}
              </button>
            );
          })}
        </aside>

        {/* Panel */}
        <div className="flex flex-col gap-3.5">
          {section === 'organization'  ? <OrganizationSection initialClient={initialClient} /> : null}
          {section === 'google'        ? <GoogleSection client={initialClient} /> : null}
          {section === 'whatsapp'      ? <WhatsappSection client={initialClient} /> : null}
          {section === 'notifications' ? <SoonSection title="الإشعارات" description="إشعارات البريد والـ webhook عند الأحداث الحرجة" /> : null}
          {section === 'billing'       ? <SoonSection title="الفوترة" description="إدارة الاشتراك والفواتير" /> : null}
          {section === 'api'           ? <ApiKeysSection client={initialClient} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ─── Organization + Complaints handling section ─────────────────────── */

function OrganizationSection({ initialClient }: { initialClient: ClientInfo | null }) {
  const { data: client } = useClientInfo(initialClient ?? undefined);

  if (!client) {
    return (
      <Card>
        <EmptyState message="تعذر تحميل بيانات المؤسسة. تأكد من اتصال الخادم وحاول مرة أخرى." />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <SectionHead
          title="معلومات المؤسسة"
          subtitle="هذه المعلومات تظهر للعميل في صفحة التقييم"
        />
        <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <ReadOnly label="اسم المؤسسة" value={client.name} />
          <ReadOnly label="معرّف NFC الأساسي" value={client.nfc_id || '—'} dir="ltr" />
        </div>
        <div className="mt-3 text-[11.5px]" style={{ color: 'var(--color-text-3)' }}>
          لتعديل اسم المؤسسة، تواصل مع الدعم — هذا الحقل مرتبط بنظام الفوترة.
        </div>
      </Card>

      <ComplaintsHandlingCard initialClient={client} />
    </>
  );
}

function ComplaintsHandlingCard({ initialClient }: { initialClient: ClientInfo }) {
  const update = useUpdateComplaintSettings();
  const [form, setForm] = useState<ComplaintSettingsInput>({
    complaint_action:   initialClient.complaint_action ?? 'contact',
    discount_code:      initialClient.discount_code ?? '',
    complaint_message:  initialClient.complaint_message ?? '',
    whatsapp_contact:   initialClient.whatsapp_contact ?? ''
  });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (ok) {
      const id = setTimeout(() => setOk(false), 3000);
      return () => clearTimeout(id);
    }
  }, [ok]);

  function set<K extends keyof ComplaintSettingsInput>(k: K, v: ComplaintSettingsInput[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(false);

    const needsDiscount = form.complaint_action !== 'contact';
    if (needsDiscount && !(form.discount_code || '').trim()) {
      setErr('كود الخصم مطلوب لخيارات الخصم');
      return;
    }

    try {
      await update.mutateAsync({
        complaint_action:  form.complaint_action,
        discount_code:     form.discount_code?.trim() || null,
        complaint_message: form.complaint_message?.trim() || null,
        whatsapp_contact:  form.whatsapp_contact?.trim() || null
      });
      setOk(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر حفظ الإعدادات');
    }
  }

  return (
    <Card>
      <SectionHead
        title="إعدادات معالجة الشكاوى"
        subtitle="تحدد ما يراه العميل عند تسجيل شكوى (تقييم ≤ 2 نجوم)"
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div>
          <Label>طريقة المعالجة</Label>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <ActionOption
              active={form.complaint_action === 'contact'}
              onClick={() => set('complaint_action', 'contact')}
              title="تواصل فقط"
              desc="رسالة تطمين بدون عرض خصم"
            />
            <ActionOption
              active={form.complaint_action === 'discount'}
              onClick={() => set('complaint_action', 'discount')}
              title="خصم فقط"
              desc="كود خصم تلقائي للعميل"
            />
            <ActionOption
              active={form.complaint_action === 'contact_discount'}
              onClick={() => set('complaint_action', 'contact_discount')}
              title="تواصل + خصم"
              desc="رسالة + كود خصم"
            />
          </div>
        </div>

        <Field label="رسالة الشكر / الاعتذار">
          <textarea
            value={form.complaint_message ?? ''}
            onChange={(e) => set('complaint_message', e.target.value)}
            placeholder="تم استلام ملاحظتك وسيتم التواصل معك قريباً."
            disabled={update.isPending}
            className="w-full rounded-[7px] border bg-white p-3 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
            maxLength={500}
          />
        </Field>

        {form.complaint_action !== 'contact' ? (
          <Field label="كود الخصم" required hint="يُعرض للعميل ضمن رسالة الاعتذار">
            <input
              value={form.discount_code ?? ''}
              onChange={(e) => set('discount_code', e.target.value)}
              placeholder="مثال: SHUKRAN20"
              disabled={update.isPending}
              dir="ltr"
              className="num w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
              style={{ borderColor: 'var(--color-border-strong)', textAlign: 'right' }}
              maxLength={40}
            />
          </Field>
        ) : null}

        <Field label="رقم واتساب للتواصل" hint="رقم يظهر للعميل ليتواصل معك مباشرة (اختياري)">
          <input
            value={form.whatsapp_contact ?? ''}
            onChange={(e) => set('whatsapp_contact', e.target.value)}
            placeholder="+966 5X XXX XXXX"
            disabled={update.isPending}
            dir="ltr"
            className="num w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
            style={{ borderColor: 'var(--color-border-strong)', textAlign: 'right' }}
            maxLength={20}
          />
        </Field>

        {err ? (
          <Alert kind="error">{err}</Alert>
        ) : null}
        {ok ? (
          <Alert kind="success">تم حفظ الإعدادات بنجاح</Alert>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={update.isPending}
            className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}
          >{update.isPending ? 'جاري الحفظ…' : 'حفظ التغييرات'}</button>
        </div>
      </form>
    </Card>
  );
}

function ActionOption({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[8px] p-3 text-start transition"
      style={{
        background: active ? 'var(--color-primary-light)' : 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        cursor: 'pointer'
      }}
    >
      <div className="text-[13px] font-medium" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-1)' }}>
        {title}
      </div>
      <div className="mt-1 text-[11.5px]" style={{ color: 'var(--color-text-3)' }}>{desc}</div>
    </button>
  );
}

/* ─── Google integration section ─────────────────────────────────────── */
function GoogleSection({ client }: { client: ClientInfo | null }) {
  return (
    <Card>
      <SectionHead title="تكامل Google" subtitle="رابط جوجل ماي بزنس يُستخدم لتوجيه التقييمات الإيجابية" />
      {client?.google_link ? (
        <ReadOnly label="رابط جوجل ماي بزنس" value={client.google_link} dir="ltr" />
      ) : (
        <EmptyState message="لم يُربط حساب Google بعد" />
      )}
      <div className="mt-3 text-[12px]" style={{ color: 'var(--color-text-3)' }}>
        لإضافة أو تعديل رابط جوجل لكل فرع، اذهب إلى <span style={{ color: 'var(--color-primary)' }}>الفروع</span> ثم عدّل الفرع المطلوب.
      </div>
    </Card>
  );
}

/* ─── WhatsApp integration section ───────────────────────────────────── */
function WhatsappSection({ client }: { client: ClientInfo | null }) {
  return (
    <Card>
      <SectionHead title="تكامل واتساب" subtitle="رقم الأعمال المُستخدم لإرسال طلبات التقييم" />
      <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <ReadOnly label="رقم الأعمال" value={client?.whatsapp_number || '—'} dir="ltr" />
        <ReadOnly label="رقم التواصل للعميل" value={client?.whatsapp_contact || '—'} dir="ltr" />
      </div>
      <div className="mt-3 text-[12px]" style={{ color: 'var(--color-text-3)' }}>
        لتغيير رقم الأعمال، تواصل مع الدعم. رقم التواصل يُعدّل من قسم "المؤسسة والشكاوى".
      </div>
    </Card>
  );
}

/* ─── API keys section ───────────────────────────────────────────────── */
function ApiKeysSection({ client }: { client: ClientInfo | null }) {
  return (
    <Card>
      <SectionHead title="مفتاح API" subtitle="مفتاح الوصول لـ RepuSystem API" />
      <div className="rounded-[8px] p-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
        <div className="text-[12px] mb-1" style={{ color: 'var(--color-text-3)' }}>
          المفتاح محفوظ في كوكي آمن ولا يُعرض هنا لأسباب أمنية.
        </div>
        <div className="text-[12.5px]" style={{ color: 'var(--color-text-2)' }}>
          إذا احتجت تجديد المفتاح أو الحصول على نسخة منه، تواصل مع الدعم.
        </div>
      </div>
      <div className="mt-4">
        <ReadOnly label="معرّف المؤسسة" value={client?.name || '—'} />
      </div>
    </Card>
  );
}

/* ─── Generic "soon" section ─────────────────────────────────────────── */
function SoonSection({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <SectionHead title={title} subtitle={description} />
      <div className="rounded-[8px] p-5 text-center" style={{ background: 'var(--color-bg)', border: '1px dashed var(--color-border-strong)' }}>
        <div className="text-[13px] font-medium" style={{ color: 'var(--color-text-2)' }}>قريباً</div>
        <div className="mt-1 text-[12px]" style={{ color: 'var(--color-text-3)' }}>
          هذه الميزة قيد التطوير وستتوفر في تحديث قادم.
        </div>
      </div>
    </Card>
  );
}

/* ─── Reusable building blocks ───────────────────────────────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: 24 }}>
      {children}
    </div>
  );
}

function SectionHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-[15px] font-semibold m-0 text-[var(--color-text-1)]">{title}</h3>
      <p className="text-[12.5px] m-0 mt-1" style={{ color: 'var(--color-text-3)' }}>{subtitle}</p>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      {hint ? <div className="mt-1 text-[11.5px]" style={{ color: 'var(--color-text-3)' }}>{hint}</div> : null}
    </div>
  );
}

function Label({ required, children }: { required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mb-1.5 text-[12.5px] font-medium" style={{ color: 'var(--color-text-2)' }}>
      {children}{required ? <span className="text-[var(--color-bad)]"> *</span> : null}
    </label>
  );
}

function ReadOnly({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div>
      <Label>{label}</Label>
      <div
        className="rounded-[7px] border bg-[#FAFBFC] px-3 py-2 text-[13px]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)' }}
        dir={dir}
      >{value}</div>
    </div>
  );
}

function Alert({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  const style: React.CSSProperties = kind === 'error'
    ? { background: 'var(--color-bad-light)', borderColor: 'var(--color-bad)', color: 'var(--color-bad)' }
    : { background: 'var(--color-good-light)', borderColor: 'var(--color-good)', color: '#047857' };
  return (
    <div className="rounded-[7px] border px-3 py-2 text-[12.5px]" style={style}>
      {children}
    </div>
  );
}
