'use client';

import { Link } from 'react-router';
import { useLocation } from 'react-router';
import {
  IconLayoutDashboard, IconStar, IconMessage2Exclamation, IconBuildingStore,
  IconChartHistogram, IconFileText, IconWifi, IconSend, IconDeviceMobile,
  IconSettings, IconDots, IconSelector, IconUsers
} from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { clearApiKey, clearSession } from '@/lib/auth';
import { serverLogout } from '@/lib/api-client';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: 'reviews' | 'complaints';
}

const NAV_MAIN: NavItem[] = [
  { href: '/',           label: 'الرئيسية',  icon: IconLayoutDashboard },
  { href: '/reviews',    label: 'التقييمات', icon: IconStar,                badge: 'reviews' },
  { href: '/complaints', label: 'الشكاوى',   icon: IconMessage2Exclamation, badge: 'complaints' },
  { href: '/branches',   label: 'الفروع',    icon: IconBuildingStore },
  { href: '/analytics',  label: 'التحليلات', icon: IconChartHistogram },
  { href: '/reports',    label: 'التقارير',  icon: IconFileText }
];

const NAV_TOOLS: NavItem[] = [
  { href: '/nfc',              label: 'بطاقات NFC',    icon: IconWifi },
  { href: '/campaigns',        label: 'طلبات التقييم', icon: IconSend },
  { href: '/customer-preview', label: 'صفحة العميل',   icon: IconDeviceMobile }
];

const NAV_SETTINGS: NavItem[] = [
  { href: '/team',     label: 'الفريق والصلاحيات', icon: IconUsers },
  { href: '/settings', label: 'إعدادات الحساب',    icon: IconSettings }
];

interface Props {
  clientName: string;
  reviewsCount: number;
  complaintsCount: number;
}

export function Sidebar({ clientName, reviewsCount, complaintsCount }: Props) {
  const pathname = useLocation().pathname || '/';
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  function badgeFor(kind: NavItem['badge']) {
    if (kind === 'reviews' && reviewsCount > 0) {
      return (
        <span
          className="num me-auto inline-flex items-center rounded-[4px] px-1.5 text-[11px]"
          style={{ background: '#F1F3F5', color: 'var(--color-text-3)' }}
        >{reviewsCount > 999 ? '999+' : reviewsCount}</span>
      );
    }
    if (kind === 'complaints' && complaintsCount > 0) {
      return (
        <span
          className="num me-auto inline-flex items-center rounded-[4px] px-1.5 text-[11px]"
          style={{ background: 'var(--color-bad-light)', color: 'var(--color-bad)' }}
        >{complaintsCount > 999 ? '999+' : complaintsCount}</span>
      );
    }
    return null;
  }

  return (
    <aside
      className="fixed top-0 right-0 z-20 flex h-screen flex-col"
      style={{
        width: 248,
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
        padding: '16px 12px'
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-2 pb-3 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-icon.svg"
          alt="RepuSystem"
          width={26}
          height={26}
          style={{ objectFit: 'contain' }}
        />
        <div className="text-[14.5px] font-semibold tracking-[-0.2px] text-[var(--color-text-1)]">RepuSystem</div>
      </div>

      {/* Workspace switcher */}
      <div className="px-2.5 mb-2">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-[7px] px-2.5 py-1.5"
          style={{ background: '#F4F5F7' }}
        >
          <span className="flex items-center gap-2">
            <span
              className="flex items-center justify-center text-white"
              style={{
                width: 20, height: 20, borderRadius: 4,
                background: 'var(--color-text-1)',
                fontSize: 10, fontWeight: 600
              }}
            >{(clientName || 'م').slice(0, 1)}</span>
            <span className="text-[12.5px] font-medium text-[var(--color-text-1)] truncate max-w-[140px]">
              {clientName || 'منشأة'}
            </span>
          </span>
          <IconSelector size={14} className="text-[var(--color-text-3)]" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto">
        {NAV_MAIN.map(({ href, label, icon: Icon, badge }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              'mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition',
              isActive(href)
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-text-2)] hover:bg-[#F4F5F7]'
            )}
            style={isActive(href) ? { background: 'var(--color-primary-light)' } : undefined}
          >
            <Icon size={17} className="opacity-90 shrink-0" />
            <span className="truncate">{label}</span>
            {badgeFor(badge)}
          </Link>
        ))}

        <SectionLabel>أدوات</SectionLabel>
        {NAV_TOOLS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              'mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition',
              isActive(href)
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-text-2)] hover:bg-[#F4F5F7]'
            )}
            style={isActive(href) ? { background: 'var(--color-primary-light)' } : undefined}
          >
            <Icon size={17} className="opacity-90 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}

        <SectionLabel>الإعدادات</SectionLabel>
        {NAV_SETTINGS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            to={href}
            className={cn(
              'mb-px flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition',
              isActive(href)
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-text-2)] hover:bg-[#F4F5F7]'
            )}
            style={isActive(href) ? { background: 'var(--color-primary-light)' } : undefined}
          >
            <Icon size={17} className="opacity-90 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>

      {/* User card */}
      <div
        className="mt-2 pt-2.5"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 cursor-pointer hover:bg-[#F4F5F7]">
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--color-purple-light)',
              color: 'var(--color-purple)',
              fontSize: 11, fontWeight: 600
            }}
          >
            {(clientName || 'م').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-[var(--color-text-1)] truncate">{clientName || 'مستخدم'}</div>
            <div className="text-[11.5px] text-[var(--color-text-3)]">المسؤول</div>
          </div>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-2.5 pt-3.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.5px]"
      style={{ color: 'var(--color-text-4)' }}
    >
      {children}
    </div>
  );
}

function LogoutButton() {
  async function logout() {
    try { await serverLogout(); } catch { /* ignore */ }
    clearSession();
    clearApiKey();
    window.location.hash = '#/login';
    window.location.reload();
  }
  return (
    <button
      type="button"
      onClick={logout}
      aria-label="تسجيل الخروج"
      title="تسجيل الخروج"
      className="text-[var(--color-text-3)] hover:text-[var(--color-text-1)] p-1"
    >
      <IconDots size={15} />
    </button>
  );
}
