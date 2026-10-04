'use client';

import { useState } from 'react';
import {
  IconWifi, IconLink, IconQrcode, IconCheck, IconCopy, IconDownload, IconExternalLink
} from '@tabler/icons-react';
import { useBranches } from '@/lib/queries';
import type { BranchesResponse } from '@/types/api';

interface Props {
  initialBranches: BranchesResponse;
}

export function CampaignsView({ initialBranches }: Props) {
  const { data } = useBranches(initialBranches);
  const branches = (data?.items ?? []).filter(branch => branch.is_active && branch.nfc_id && branch.review_url);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const branch = branches.find(item => item.id === selectedId) ?? branches[0];

  async function copyLink() {
    if (!branch?.review_url) return;
    try {
      await navigator.clipboard.writeText(branch.review_url);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="p-4 sm:p-7" style={{ maxWidth: 900 }}>
      <h1 className="m-0 text-[22px] font-semibold text-[var(--color-text-1)]">روابط التقييم</h1>
      <p className="mt-1 mb-6 text-[13.5px] text-[var(--color-text-2)]">شارك رابط تقييم الفرع مع عملائك أو نزّل رمز QR الخاص به.</p>
      <Card padding={24}>
        {branches.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-text-2)]">لا توجد فروع نشطة لها معرّف NFC. أضف فرعًا أو فعّله من صفحة الفروع.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="الفرع">
              <select id="review-branch" value={branch.id} onChange={event => { setSelectedId(Number(event.target.value)); setCopied(false); setCopyError(false); }} className="w-full rounded-[7px] border bg-white px-3 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-border-strong)' }}>
                {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="رابط التقييم">
              <input id="review-link" readOnly value={branch.review_url ?? ''} dir="ltr" onFocus={event => event.target.select()} className="w-full rounded-[7px] border bg-white px-3 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-border-strong)' }} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-[7px] px-3 py-2 text-[13px] text-white" style={{ background: 'var(--color-primary)' }}>{copied ? <IconCheck size={16} /> : <IconCopy size={16} />}{copied ? 'تم النسخ' : 'نسخ الرابط'}</button>
              <a href={branch.review_url ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-2 text-[13px] text-[var(--color-text-1)]"><IconExternalLink size={16} />فتح الرابط</a>
              <a href={`/api/qr/${encodeURIComponent(branch.nfc_id!)}`} download className="inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-2 text-[13px] text-[var(--color-text-1)]"><IconDownload size={16} />تنزيل QR</a>
            </div>
            {copyError ? <p role="alert" className="m-0 text-[12px] text-[var(--color-bad)]">تعذر النسخ تلقائيًا. يمكنك تحديد الرابط ونسخه يدويًا.</p> : null}
          </div>
        )}
      </Card>
      <Card padding={20}>
        <ChannelRow icon={<IconWifi size={17} />} title="بطاقة NFC" subtitle="الوسيلة الأساسية داخل الفرع" bg="var(--color-primary)" fg="white" badge={{ label: 'متاح', style: { background: 'var(--color-good-light)', color: '#047857' } }} highlighted />
        <ChannelRow icon={<IconLink size={17} />} title="رابط مباشر" subtitle="يمكن مشاركته في أي قناة" bg="#F1F3F5" fg="var(--color-text-2)" badge={{ label: 'متاح', style: { background: '#F1F3F5', color: 'var(--color-text-2)' } }} />
        <ChannelRow icon={<IconQrcode size={17} />} title="QR Code" subtitle="تنزيل رمز الفرع من الرابط أعلاه" bg="#F1F3F5" fg="var(--color-text-2)" badge={{ label: 'متاح', style: { background: '#F1F3F5', color: 'var(--color-text-2)' } }} />
      </Card>
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
