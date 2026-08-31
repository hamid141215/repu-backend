'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  IconSearch, IconHelp, IconPlus, IconBell, IconX,
  IconSend, IconBuildingStore, IconFileUpload, IconUserPlus,
  IconBrandWhatsapp, IconMail, IconExternalLink,
  IconAlertTriangle, IconStarFilled, IconWifi
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { relativeTimeAr } from '@/lib/format';
import { isOwner } from '@/lib/auth';
import type { ActivityResponse, ActivityItem } from '@/types/api';

interface Props {
  hasAlerts?: boolean;
}

export function Topbar({ hasAlerts = false }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [bellOpen, setBellOpen]     = useState(false);
  const [helpOpen, setHelpOpen]     = useState(false);
  const owner = isOwner();

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between"
      style={{
        height: 56,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 28px'
      }}
    >
      <div className="flex items-center gap-3.5">
        <div className="relative">
          <input
            placeholder="بحث عن شكوى، عميل، فرع…"
            disabled
            aria-label="بحث (قريباً)"
            title="البحث الموحّد قريباً"
            className="rounded-[7px] py-1.5 ps-3 pe-8 text-[13px] outline-none"
            style={{ width: 280, background: '#F4F5F7', border: '1px solid transparent', fontFamily: 'inherit' }}
          />
          <IconSearch size={15} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-3)' }} />
          <span className="kbd absolute start-2 top-1/2 -translate-y-1/2">⌘K</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="مركز المساعدة" title="مركز المساعدة"
          onClick={() => setHelpOpen(true)}
          className="rounded-[7px] p-2 transition hover:bg-[#F4F5F7]" style={{ color: 'var(--color-text-2)' }}>
          <IconHelp size={16} />
        </button>

        <button type="button" aria-label="النشاط الأخير" title="النشاط الأخير"
          onClick={() => setBellOpen(true)}
          className="relative rounded-[7px] p-2 transition hover:bg-[#F4F5F7]" style={{ color: 'var(--color-text-2)' }}>
          <IconBell size={16} />
          {hasAlerts ? (
            <span className="absolute" style={{
              top: 4, left: 6, width: 7, height: 7,
              background: 'var(--color-bad)', borderRadius: '50%',
              border: '2px solid var(--color-surface)'
            }} />
          ) : null}
        </button>

        <CreateMenu open={createOpen} onClose={() => setCreateOpen(false)} owner={owner}>
          <button type="button" onClick={() => setCreateOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white"
            style={{ background: 'var(--color-primary)' }}>
            <IconPlus size={14} />إنشاء
          </button>
        </CreateMenu>
      </div>

      {bellOpen ? <ActivityPanel onClose={() => setBellOpen(false)} /> : null}
      {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}
    </header>
  );
}

// ─── Create menu (dropdown) ────────────────────────────────────────────────
function CreateMenu({ open, onClose, owner, children }:
  { open: boolean; onClose: () => void; owner: boolean; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapRef} className="relative">
      {children}
      {open ? (
        <div
          className="absolute mt-1 rounded-[10px] py-1.5 shadow-lg"
          style={{
            top: '100%', insetInlineEnd: 0,
            width: 240, background: 'var(--color-surface)',
            border: '1px solid var(--color-border)', zIndex: 50
          }}
        >
          <MenuItem to="/campaigns"  icon={<IconSend size={15} />}              label="إرسال طلب تقييم"    onClick={onClose} />
          <MenuItem to="/branches"   icon={<IconBuildingStore size={15} />} label="إضافة فرع جديد"     onClick={onClose} />
          <MenuItem to="/branches?import=1" icon={<IconFileUpload size={15} />} label="استيراد فروع من CSV" onClick={onClose} />
          {owner ? (
            <MenuItem to="/team"     icon={<IconUserPlus size={15} />}          label="دعوة عضو للفريق"     onClick={onClose} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ to, icon, label, onClick }:
  { to: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Link to={to} onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[#F4F5F7]"
      style={{ color: 'var(--color-text-1)' }}>
      <span style={{ color: 'var(--color-text-3)' }}>{icon}</span>
      {label}
    </Link>
  );
}

// ─── Activity / Notifications drawer ──────────────────────────────────────
function ActivityPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['activity', 15, 'topbar'],
    queryFn: () => apiClient<ActivityResponse>('/api/activity?limit=15'),
    refetchInterval: 30_000,
    staleTime: 15_000
  });
  const items = data?.items ?? [];

  // Group into actionable vs recent
  const urgent = items.filter(it => it.status === 'complaint' || it.answer === '2');
  const lowRated = items.filter(it => it.rating != null && it.rating <= 3 && !urgent.includes(it));
  const handled = new Set([...urgent, ...lowRated].map(it => it.id));
  const recent = items.filter(it => !handled.has(it.id));

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="الإشعارات">
      <button type="button" aria-label="إغلاق" onClick={onClose}
        className="flex-1 cursor-default" style={{ background: 'rgba(10,14,26,0.25)' }} />
      <div className="flex h-full flex-col shadow-2xl" style={{
        width: 420, maxWidth: '100%',
        background: 'var(--color-surface)',
        borderInlineStart: '1px solid var(--color-border)'
      }}>
        <header className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold">الإشعارات</div>
              <span className="pulse" aria-hidden="true" />
              <span className="text-[10.5px] font-medium" style={{ color: 'var(--color-good)' }}>مباشر</span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]">
              {lastUpdate ? `آخر تحديث ${relativeTimeAr(lastUpdate)}` : 'يتحدّث تلقائياً'}
            </div>
          </div>
          <button type="button" aria-label="إغلاق" onClick={onClose}
            className="rounded-[7px] p-1.5 hover:bg-[#F4F5F7]">
            <IconX size={16} style={{ color: 'var(--color-text-3)' }} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-[13px]" style={{ color: 'var(--color-text-3)' }}>جاري التحميل…</div>
          ) : isError ? (
            <div className="p-6 text-center text-[13px]" style={{ color: 'var(--color-bad)' }}>تعذر تحميل الإشعارات</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-[13px]" style={{ color: 'var(--color-text-3)' }}>لا توجد إشعارات حالياً</div>
          ) : (
            <>
              {urgent.length > 0 ? (
                <Section title="عاجل — يحتاج اهتمامك" count={urgent.length} accent="bad">
                  {urgent.map(it => <ActivityRow key={it.id} it={it} onClose={onClose} />)}
                </Section>
              ) : null}
              {lowRated.length > 0 ? (
                <Section title="تقييمات منخفضة" count={lowRated.length} accent="warn">
                  {lowRated.map(it => <ActivityRow key={it.id} it={it} onClose={onClose} />)}
                </Section>
              ) : null}
              {recent.length > 0 ? (
                <Section title="نشاط حديث" count={recent.length} accent="neutral">
                  {recent.map(it => <ActivityRow key={it.id} it={it} onClose={onClose} />)}
                </Section>
              ) : null}
            </>
          )}
        </div>
        <div className="px-5 py-3 grid grid-cols-2 gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Link to="/complaints" onClick={onClose}
            className="rounded-[7px] px-3 py-1.5 text-center text-[12.5px] font-medium"
            style={{ background: 'var(--color-bad-light)', color: 'var(--color-bad)' }}>
            الشكاوى ({urgent.length})
          </Link>
          <Link to="/reviews" onClick={onClose}
            className="rounded-[7px] px-3 py-1.5 text-center text-[12.5px] font-medium"
            style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
            كل التقييمات ←
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, accent, children }:
  { title: string; count: number; accent: 'bad' | 'warn' | 'neutral'; children: React.ReactNode }) {
  const accentColor = accent === 'bad' ? 'var(--color-bad)' : accent === 'warn' ? 'var(--color-warn)' : 'var(--color-text-3)';
  return (
    <div>
      <div className="flex items-center justify-between px-5 pt-3 pb-1.5">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: accentColor, letterSpacing: 0.4 }}>{title}</div>
        <span className="text-[11px] font-semibold rounded-full px-2 py-0.5"
          style={{ background: accent === 'bad' ? 'var(--color-bad-light)' : accent === 'warn' ? 'var(--color-warn-light)' : '#F4F5F7', color: accentColor }}>
          {count}
        </span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ActivityRow({ it, onClose }: { it: ActivityItem; onClose: () => void }) {
  const isComplaint = it.status === 'complaint' || it.answer === '2';
  const isNfc = it.source === 'nfc';
  const isGoodRating = it.rating != null && it.rating >= 4;
  const isLowRating = it.rating != null && it.rating <= 3 && !isComplaint;

  const target = isComplaint
    ? `/complaints?q=${encodeURIComponent(String(it.id))}`
    : it.rating != null
      ? `/reviews?q=${encodeURIComponent(String(it.id))}`
      : '/reviews';

  const icon = isComplaint
    ? <IconAlertTriangle size={14} />
    : isGoodRating
      ? <IconStarFilled size={14} />
      : isNfc
        ? <IconWifi size={14} />
        : <IconStarFilled size={14} />;
  const [bg, color] = isComplaint
    ? ['var(--color-bad-light)',  'var(--color-bad)']
    : isLowRating
      ? ['var(--color-warn-light)', 'var(--color-warn)']
      : isGoodRating
        ? ['var(--color-good-light)', 'var(--color-good)']
        : ['var(--color-primary-light)', 'var(--color-primary)'];

  const label = isComplaint
    ? (it.branch ? `شكوى — ${it.branch}` : 'شكوى جديدة')
    : it.rating != null
      ? `تقييم ${it.rating} نجوم${it.branch ? ` — ${it.branch}` : ''}`
      : isNfc
        ? `لمسة NFC${it.branch ? ` — ${it.branch}` : ''}`
        : it.branch ? `نشاط — ${it.branch}` : 'نشاط';

  const subtitle = `${relativeTimeAr(it.sent_at)}${it.name ? ` · ${it.name}` : ''}`;

  return (
    <li>
      <Link to={target} onClick={onClose}
        className="flex items-start gap-2.5 px-5 py-3 transition hover:bg-[#FAFBFC] group"
        style={{ borderTop: '1px solid var(--color-border)', textDecoration: 'none' }}>
        <div className="flex shrink-0 items-center justify-center"
          style={{ width: 28, height: 28, borderRadius: 8, background: bg, color }}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-1)' }}>{label}</div>
          <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)] truncate">{subtitle}</div>
        </div>
        <span className="opacity-0 group-hover:opacity-100 transition self-center text-[11.5px] font-medium"
          style={{ color: 'var(--color-primary)' }}>
          عرض ←
        </span>
      </Link>
    </li>
  );
}

// ─── Help panel ────────────────────────────────────────────────────────────
function HelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="مركز المساعدة">
      <button type="button" aria-label="إغلاق" onClick={onClose}
        className="absolute inset-0" style={{ background: 'rgba(10,14,26,0.4)' }} />
      <div className="relative w-full max-w-md rounded-[10px]" style={{ background: 'var(--color-surface)' }}>
        <header className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-[15px] font-semibold m-0">مركز المساعدة</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="rounded-[6px] p-1.5 hover:bg-[#F4F5F7]">
            <IconX size={15} style={{ color: 'var(--color-text-3)' }} />
          </button>
        </header>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[13px] leading-[1.7]" style={{ color: 'var(--color-text-2)' }}>
            أي استفسار أو مشكلة، تواصلي معنا عبر القنوات التالية:
          </p>

          <a href="https://wa.me/966553073029" target="_blank" rel="noreferrer"
            className="flex items-center gap-3 rounded-[7px] p-3 hover:bg-[#F4F5F7] transition">
            <div className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'var(--color-good-light)', color: 'var(--color-good)' }}>
              <IconBrandWhatsapp size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-medium">واتساب الدعم</div>
              <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]" dir="ltr">+966 55 307 3029</div>
            </div>
            <IconExternalLink size={14} style={{ color: 'var(--color-text-3)' }} />
          </a>

          <a href="mailto:support@mawjatalsamt.com"
            className="flex items-center gap-3 rounded-[7px] p-3 hover:bg-[#F4F5F7] transition">
            <div className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
              <IconMail size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-medium">البريد الإلكتروني</div>
              <div className="mt-0.5 text-[11.5px] text-[var(--color-text-3)]" dir="ltr">support@mawjatalsamt.com</div>
            </div>
          </a>

          <div className="rounded-[7px] p-3 mt-2" style={{ background: '#F4F5F7' }}>
            <div className="text-[12px] font-medium text-[var(--color-text-2)] mb-1">معلومات الإصدار</div>
            <div className="text-[11.5px] text-[var(--color-text-3)]" dir="ltr">
              RepuSystem v52 · {new Date().getFullYear()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
