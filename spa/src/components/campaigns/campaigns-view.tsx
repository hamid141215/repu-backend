'use client';

import { useState } from 'react';
import {
  IconBrandWhatsapp, IconWifi, IconLink, IconQrcode, IconCheck,
  IconClock, IconAlertTriangle, IconStar
} from '@tabler/icons-react';
import { useBranches, useSendCampaign, useActivity } from '@/lib/queries';
import { TimeAgo } from '@/components/time-ago';
import { EmptyState } from '@/components/empty-state';
import type { BranchesResponse, ActivityResponse, ActivityItem } from '@/types/api';

interface Props {
  initialBranches: BranchesResponse;
  initialActivity: ActivityResponse;
}

export function CampaignsView({ initialBranches, initialActivity }: Props) {
  const { data: branchesData } = useBranches(initialBranches);
  const { data: activityData } = useActivity(initialActivity, 8);
  const send = useSendCampaign();

  const branches = (branchesData?.items ?? []).filter(b => b.is_active);
  const recentSends = (activityData?.items ?? []).filter(it => it.status === 'sent');

  const [form, setForm] = useState({
    name: '',
    phone: '',
    branch: branches[0]?.name ?? ''
  });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);

    const name = form.name.trim();
    const phone = form.phone.replace(/\s+/g, '').trim();

    if (!name) { setErr('اسم العميل مطلوب'); return; }
    if (!phone) { setErr('رقم الجوال مطلوب'); return; }
    // Accept +966xxxxxxxxx or 05xxxxxxxx etc.
    if (!/^[+0-9]{8,16}$/.test(phone)) { setErr('رقم الجوال غير صالح'); return; }

    try {
      await send.mutateAsync({ name, phone, branch: form.branch || null });
      setOk(`تم إرسال طلب التقييم إلى ${name} بنجاح`);
      setForm(f => ({ ...f, name: '', phone: '' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر إرسال الطلب');
    }
  }

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">إرسال طلب تقييم</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">أرسل طلب تقييم فردي لعميل عبر واتساب</p>
        </div>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* LEFT: form */}
        <Card padding={24}>
          <h3 className="text-[15px] font-semibold m-0 mb-1 text-[var(--color-text-1)]">إرسال فردي</h3>
          <p className="text-[12.5px] m-0 mb-5" style={{ color: 'var(--color-text-3)' }}>
            أرسل طلب تقييم لعميل واحد عبر واتساب
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
            <Field label="اسم العميل" required>
              <input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="مثال: أحمد المالكي"
                disabled={send.isPending}
                className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ borderColor: 'var(--color-border-strong)' }}
                maxLength={80}
              />
            </Field>

            <Field label="رقم الجوال" required hint="بصيغة دولية مع رمز الدولة، مثل +9665XXXXXXXX">
              <input
                value={form.phone}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+966 5X XXX XXXX"
                disabled={send.isPending}
                dir="ltr"
                className="num w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ borderColor: 'var(--color-border-strong)', textAlign: 'right' }}
                maxLength={20}
              />
            </Field>

            <Field label="الفرع">
              {branches.length === 0 ? (
                <div className="rounded-[7px] border px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-3)' }}>
                  لا توجد فروع نشطة — أضف فرعاً من قسم الفروع أولاً
                </div>
              ) : (
                <select
                  value={form.branch}
                  onChange={(e) => setForm(f => ({ ...f, branch: e.target.value }))}
                  disabled={send.isPending}
                  className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                  style={{ borderColor: 'var(--color-border-strong)' }}
                >
                  <option value="">— بدون تحديد فرع —</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              )}
            </Field>

            {err ? (
              <div className="rounded-[7px] border px-3 py-2 text-[12.5px]" style={{ background: 'var(--color-bad-light)', borderColor: 'var(--color-bad)', color: 'var(--color-bad)' }}>
                {err}
              </div>
            ) : null}

            {ok ? (
              <div className="rounded-[7px] border px-3 py-2 text-[12.5px]" style={{ background: 'var(--color-good-light)', borderColor: 'var(--color-good)', color: '#047857' }}>
                {ok}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={send.isPending || !form.name.trim() || !form.phone.trim()}
              className="rounded-[7px] flex items-center justify-center gap-2 px-3.5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50 mt-1"
              style={{ background: 'var(--color-primary)' }}
            >
              <IconBrandWhatsapp size={16} />
              {send.isPending ? 'جاري الإرسال…' : 'إرسال عبر واتساب'}
            </button>
          </form>
        </Card>

        {/* RIGHT: channels + recent sends */}
        <div className="flex flex-col gap-3.5">
          <Card padding={20}>
            <h3 className="text-[15px] font-semibold m-0 mb-3.5 text-[var(--color-text-1)]">قنوات التوصيل</h3>
            <div className="flex flex-col gap-2.5">
              <ChannelRow
                icon={<IconWifi size={17} />}
                title="بطاقة NFC"
                subtitle="الوسيلة الأساسية داخل الفرع"
                bg="var(--color-primary)"
                fg="white"
                badge={{ label: 'مُفعّل', style: { background: 'var(--color-good-light)', color: '#047857' } }}
                highlighted
              />
              <ChannelRow
                icon={<IconBrandWhatsapp size={17} />}
                title="واتساب"
                subtitle="إرسال مباشر للعميل عند الطلب"
                bg="#DCFCE7"
                fg="#15803D"
                badge={{ label: 'مُفعّل', style: { background: 'var(--color-good-light)', color: '#047857' } }}
              />
              <ChannelRow
                icon={<IconLink size={17} />}
                title="رابط مباشر"
                subtitle="يمكن مشاركته في أي قناة"
                bg="#F1F3F5"
                fg="var(--color-text-2)"
                badge={{ label: 'متاح', style: { background: '#F1F3F5', color: 'var(--color-text-2)' } }}
              />
              <ChannelRow
                icon={<IconQrcode size={17} />}
                title="QR Code"
                subtitle="عند الحاجة كخيار إضافي"
                bg="#F1F3F5"
                fg="var(--color-text-2)"
                badge={{ label: 'قريباً', style: { background: '#F1F3F5', color: 'var(--color-text-3)' } }}
              />
            </div>
          </Card>

          <Card padding={20}>
            <h3 className="text-[15px] font-semibold m-0 mb-3 text-[var(--color-text-1)]">آخر الإرسالات</h3>
            {recentSends.length === 0 ? (
              <EmptyState message="لا توجد إرسالات حديثة" />
            ) : (
              <div className="flex flex-col">
                {recentSends.slice(0, 6).map((it, idx) => (
                  <RecentSendRow key={it.id} item={it} last={idx === recentSends.length - 1 || idx === 5} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ children, padding = 20 }: { children: React.ReactNode; padding?: number }) {
  return (
    <div className="rounded-[10px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding }}>
      {children}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block mb-1.5 text-[12.5px] font-medium" style={{ color: 'var(--color-text-2)' }}>
        {label}{required ? <span className="text-[var(--color-bad)]"> *</span> : null}
      </label>
      {children}
      {hint ? <div className="mt-1 text-[11.5px] text-[var(--color-text-3)]">{hint}</div> : null}
    </div>
  );
}

interface ChannelProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  badge: { label: string; style: React.CSSProperties };
  highlighted?: boolean;
}

function ChannelRow({ icon, title, subtitle, bg, fg, badge, highlighted }: ChannelProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-[8px] px-2.5 py-2.5"
      style={highlighted
        ? { background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-light)' }
        : { border: '1px solid var(--color-border)' }}
    >
      <div
        className="flex shrink-0 items-center justify-center"
        style={{ width: 32, height: 32, borderRadius: 8, background: bg, color: fg }}
      >{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--color-text-1)]">{title}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--color-text-3)' }}>{subtitle}</div>
      </div>
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
        style={badge.style}
      >{badge.label}</span>
    </div>
  );
}

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: 'var(--color-primary-light)', fg: 'var(--color-primary)' },
  { bg: '#FCE7F3', fg: '#BE185D' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: '#D1FAE5', fg: '#047857' },
  { bg: '#FEF3C7', fg: '#92400E' }
];

function pickPalette(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function RecentSendRow({ item, last }: { item: ActivityItem; last: boolean }) {
  const palette = pickPalette(item.name || String(item.id));
  // status mapping
  let badgeIcon: React.ReactNode = <IconClock size={11} />;
  let badgeLabel = 'في الانتظار';
  let badgeStyle: React.CSSProperties = { background: 'var(--color-warn-light)', color: '#B45309' };

  if (item.status === 'replied' && item.answer === '1') {
    badgeIcon = <IconCheck size={11} />;
    badgeLabel = 'تم التقييم';
    badgeStyle = { background: 'var(--color-good-light)', color: '#047857' };
  } else if (item.status === 'complaint' || item.answer === '2') {
    badgeIcon = <IconAlertTriangle size={11} />;
    badgeLabel = 'شكوى';
    badgeStyle = { background: 'var(--color-bad-light)', color: '#B91C1C' };
  } else if (item.rating != null && item.rating >= 4) {
    badgeIcon = <IconStar size={11} />;
    badgeLabel = 'مفتوحة';
    badgeStyle = { background: 'var(--color-primary-light)', color: 'var(--color-primary)' };
  }

  return (
    <div
      className="flex items-center gap-2.5 py-2"
      style={last ? undefined : { borderBottom: '1px solid var(--color-border)' }}
    >
      <div
        className="flex shrink-0 items-center justify-center"
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: palette.bg, color: palette.fg,
          fontSize: 12, fontWeight: 600
        }}
      >{(item.name || '؟').slice(0, 2)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text-1)] truncate">{item.name || 'عميل'}</div>
        <TimeAgo at={item.sent_at} className="text-[11.5px]" style={{ color: 'var(--color-text-3)', display: 'block' }} />
      </div>
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[1.4]"
        style={badgeStyle}
      >{badgeIcon}{badgeLabel}</span>
    </div>
  );
}
