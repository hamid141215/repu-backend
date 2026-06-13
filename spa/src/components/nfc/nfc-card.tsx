'use client';

import { IconWifi, IconWifiOff, IconDownload } from '@tabler/icons-react';
import { safeNumber } from '@/lib/format';
import type { BranchRow } from '@/types/api';

interface Props {
  branch: BranchRow;
}

export function NfcCard({ branch }: Props) {
  const active = branch.is_active;
  const evals = safeNumber(branch.total_evaluations);
  const address = [branch.area, branch.city].filter(Boolean).join(' — ') || 'لم يُحدّد العنوان';

  return (
    <div className="nfc-card-dark" style={{ opacity: active ? 1 : 0.65 }}>
      {/* Top row: brand + icon */}
      <div className="relative z-10 mb-6 flex items-start justify-between">
        <div>
          <div
            className="text-[11px]"
            style={{ color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 1 }}
          >RepuSystem</div>
          <div
            className="mt-0.5 truncate"
            style={{ fontSize: 17, fontWeight: 600, color: 'white', maxWidth: 200 }}
          >{branch.name}</div>
        </div>
        {active ? (
          <IconWifi size={22} style={{ color: '#3B82F6' }} />
        ) : (
          <IconWifiOff size={22} style={{ color: 'rgba(255,255,255,0.4)' }} />
        )}
      </div>

      {/* Branch line + nfc id */}
      <div className="relative z-10">
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)' }}>الفرع</div>
        <div className="mt-0.5" style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.92)' }}>
          {address}
        </div>
        <div
          className="num mt-2"
          style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}
          dir="ltr"
        >NFC: {branch.nfc_id}</div>
      </div>

      {/* Footer */}
      <div
        className="relative z-10 mt-4 pt-3 flex items-center justify-between"
        style={{ fontSize: 11.5, borderTop: '1px solid rgba(255,255,255,0.1)' }}
      >
        <span style={{ color: 'rgba(255,255,255,0.55)' }}>
          {evals > 0 ? `${evals} تقييم منذ الإطلاق` : 'لا تقييمات بعد'}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: active ? '#10B981' : 'rgba(255,255,255,0.4)' }}>
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: active ? '#10B981' : 'rgba(255,255,255,0.4)'
            }}
          />{active ? 'نشطة' : 'خاملة'}
        </span>
      </div>

      {/* Download QR action */}
      {branch.nfc_id ? (
        <div className="relative z-10 mt-3 flex justify-end">
          <a
            href={`/api/qr/${encodeURIComponent(branch.nfc_id)}`}
            download
            className="inline-flex items-center gap-1 text-[11.5px] font-medium rounded-[6px] px-2 py-1"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
            title="تحميل رمز QR للبطاقة"
          ><IconDownload size={12} /> QR</a>
        </div>
      ) : null}
    </div>
  );
}
