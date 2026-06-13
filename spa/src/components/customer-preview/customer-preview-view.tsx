'use client';

import { useState } from 'react';
import { Link } from 'react-router';
import { IconStar, IconStarFilled, IconCheck, IconPalette, IconSettings } from '@tabler/icons-react';
import type { ClientInfo, BranchesResponse, BranchRow } from '@/types/api';

interface Props {
  client: ClientInfo | null;
  branches: BranchesResponse;
}

export function CustomerPreviewView({ client, branches }: Props) {
  const allBranches = branches.items.filter(b => b.is_active);
  const [selectedBranchId, setSelectedBranchId] = useState<number | 'none'>(
    allBranches[0]?.id ?? 'none'
  );

  const selectedBranch = selectedBranchId === 'none'
    ? null
    : allBranches.find(b => b.id === selectedBranchId) ?? null;

  const brandName = client?.name || 'مؤسستك';
  const discountCode = client?.discount_code?.trim() || 'SHUKRAN20';
  const complaintMessage = client?.complaint_message?.trim() || 'تم استلام ملاحظتك وسيتم التواصل معك قريباً.';

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">صفحة العميل</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">معاينة تجربة العميل على الجوال — مما يراه فعلياً</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/settings"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
          ><IconPalette size={14} />تخصيص</Link>
          <Link
            to="/settings"
            className="flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
          ><IconSettings size={14} />إعدادات الشكاوى</Link>
        </div>
      </div>

      {/* Branch selector */}
      {allBranches.length > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[12.5px]" style={{ color: 'var(--color-text-3)' }}>معاينة لفرع:</span>
          <select
            value={String(selectedBranchId)}
            onChange={(e) => setSelectedBranchId(e.target.value === 'none' ? 'none' : Number(e.target.value))}
            className="rounded-[7px] border bg-white px-3 py-1.5 text-[13px] outline-none focus:border-[var(--color-primary)]"
            style={{ borderColor: 'var(--color-border-strong)' }}
          >
            {allBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="none">— بدون تحديد فرع —</option>
          </select>
        </div>
      ) : null}

      {/* Phones row */}
      <div
        className="rounded-[16px] p-10 flex gap-8 items-start justify-center"
        style={{
          background: 'linear-gradient(180deg, #F1F3F5 0%, var(--color-bg) 100%)',
          border: '1px solid var(--color-border)'
        }}
      >
        <PhoneFrame label="١. التقييم">
          <RatingScreen brandName={brandName} branch={selectedBranch} />
        </PhoneFrame>

        <PhoneFrame label="٢. ملاحظة خاصة (تقييم منخفض)">
          <FeedbackScreen brandName={brandName} branch={selectedBranch} message={complaintMessage} />
        </PhoneFrame>

        <PhoneFrame label="٣. شكر العميل + كود الخصم">
          <ThanksScreen
            brandName={brandName}
            discountCode={discountCode}
            showDiscount={client?.complaint_action !== 'contact'}
          />
        </PhoneFrame>
      </div>

      {/* Footer note */}
      <div
        className="mt-4 rounded-[10px] p-4 text-[12.5px]"
        style={{ background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-light)', color: 'var(--color-text-2)' }}
      >
        هذه معاينة فقط. اللون والشعار يُحفظان للعميل عند فتحه الرابط الفعلي.
        لتغيير رسالة الشكاوى أو كود الخصم، اذهب إلى <Link to="/settings" style={{ color: 'var(--color-primary)', fontWeight: 500 }}>الإعدادات</Link>.
      </div>
    </div>
  );
}

/* ─── Phone shell ─────────────────────────────────────────────────────── */

function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div
        style={{
          width: 280, height: 560, borderRadius: 36,
          padding: 10,
          background: '#0A0E1A',
          boxShadow: '0 18px 40px rgba(10, 14, 26, 0.18)',
          position: 'relative'
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            width: 110, height: 22, borderRadius: 12,
            background: '#0A0E1A', zIndex: 2
          }}
        />
        {/* Screen */}
        <div
          style={{
            position: 'relative',
            width: '100%', height: '100%', borderRadius: 28,
            background: 'white',
            overflow: 'hidden'
          }}
          dir="rtl"
        >
          {children}
        </div>
      </div>
      <div className="mt-3 text-[12.5px] font-medium" style={{ color: 'var(--color-text-2)' }}>
        {label}
      </div>
    </div>
  );
}

/* ─── Screen 1: rating ───────────────────────────────────────────────── */

function RatingScreen({ brandName, branch }: { brandName: string; branch: BranchRow | null }) {
  const branchLine = branch ? branch.name : 'الفرع الرئيسي';
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <BrandHeader brandName={brandName} subtitle={branchLine} />
      <div style={{ padding: '32px 24px', textAlign: 'center', flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-1)' }}>
          كيف كانت تجربتك معنا اليوم؟
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-3)', marginTop: 6 }}>
          قيّمنا من 1 إلى 5 نجوم
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 26 }}>
          <IconStarFilled size={32} style={{ color: '#F59E0B' }} />
          <IconStarFilled size={32} style={{ color: '#F59E0B' }} />
          <IconStarFilled size={32} style={{ color: '#F59E0B' }} />
          <IconStarFilled size={32} style={{ color: '#F59E0B' }} />
          <IconStar size={32} style={{ color: 'var(--color-text-4)' }} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-2)', marginTop: 14 }}>
          4 من 5 — جيد جداً
        </div>
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <PhoneButton>متابعة</PhoneButton>
      </div>
      <BrandFooter />
    </div>
  );
}

/* ─── Screen 2: feedback for low rating ──────────────────────────────── */

function FeedbackScreen({ brandName, branch, message }: { brandName: string; branch: BranchRow | null; message: string }) {
  const branchLine = branch ? branch.name : 'الفرع الرئيسي';
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <BrandHeader brandName={brandName} subtitle={branchLine} />
      <div style={{ padding: '24px 20px', flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--color-text-1)', marginBottom: 4 }}>
          نأسف أن التجربة لم تكن مثالية
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--color-text-3)', marginBottom: 16, lineHeight: 1.5 }}>
          {message}
        </div>

        <div style={{ fontSize: 12, color: 'var(--color-text-2)', marginBottom: 6, fontWeight: 500 }}>
          ما المشكلة؟
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <Reason active>تأخير الطلب</Reason>
          <Reason>جودة الطعام</Reason>
          <Reason>خدمة العملاء</Reason>
        </div>

        <textarea
          placeholder="تفاصيل إضافية (اختياري)…"
          readOnly
          style={{
            width: '100%', padding: 10, fontSize: 12,
            border: '1px solid var(--color-border)', borderRadius: 7,
            fontFamily: 'inherit', resize: 'none', height: 60,
            background: 'var(--color-bg)'
          }}
        />
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <PhoneButton>إرسال للإدارة</PhoneButton>
      </div>
    </div>
  );
}

function Reason({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-primary-50)' : 'white',
        borderRadius: 7,
        fontSize: 12,
        color: active ? 'var(--color-primary)' : 'var(--color-text-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }}
    >
      {active ? <IconCheck size={13} /> : null}
      {children}
    </div>
  );
}

/* ─── Screen 3: thanks + optional discount code ──────────────────────── */

function ThanksScreen({ brandName, discountCode, showDiscount }: { brandName: string; discountCode: string; showDiscount: boolean }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <BrandHeader brandName={brandName} />
      <div style={{ padding: '36px 24px', textAlign: 'center', flex: 1 }}>
        <div
          style={{
            width: 80, height: 80,
            background: 'var(--color-good-light)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px'
          }}
        >
          <IconCheck size={40} style={{ color: 'var(--color-good)' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-1)' }}>شكراً لك! 🙏</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-2)', marginTop: 8, lineHeight: 1.6 }}>
          تم استلام تقييمك. نقدّر وقتك في مساعدتنا على تقديم تجربة أفضل.
        </div>

        {showDiscount ? (
          <div
            style={{
              marginTop: 22, padding: 14,
              background: 'var(--color-good-light)',
              borderRadius: 10,
              border: '1px dashed var(--color-good)'
            }}
          >
            <div style={{ fontSize: 11.5, color: '#047857', fontWeight: 500 }}>هدية شكرنا لك</div>
            <div
              className="num"
              style={{
                fontSize: 17, fontWeight: 600,
                color: '#047857', marginTop: 4, letterSpacing: 1
              }}
              dir="ltr"
            >{discountCode}</div>
            <div style={{ fontSize: 11, color: '#047857', marginTop: 4 }}>
              قدّم الكود في زيارتك القادمة
            </div>
          </div>
        ) : null}
      </div>
      <BrandFooter />
    </div>
  );
}

/* ─── Brand header + footer ───────────────────────────────────────────── */

function BrandHeader({ brandName, subtitle }: { brandName: string; subtitle?: string }) {
  return (
    <div style={{ background: 'var(--color-primary)', padding: '40px 20px 18px', color: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            width: 24, height: 24,
            background: 'white',
            color: 'var(--color-primary)',
            borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-num)'
          }}
        >R</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{brandName}</div>
      </div>
      {subtitle ? (
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 4 }}>{subtitle}</div>
      ) : null}
    </div>
  );
}

function BrandFooter() {
  return (
    <div
      style={{
        position: 'absolute', bottom: 14, left: 0, right: 0,
        textAlign: 'center', fontSize: 10.5,
        color: 'var(--color-text-4)'
      }}
    >
      مدعوم بواسطة RepuSystem
    </div>
  );
}

function PhoneButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      style={{
        width: '100%', padding: 11,
        fontSize: 13.5, fontWeight: 500,
        background: 'var(--color-primary)',
        color: 'white',
        border: 'none', borderRadius: 7,
        cursor: 'default',
        fontFamily: 'inherit'
      }}
    >{children}</button>
  );
}
