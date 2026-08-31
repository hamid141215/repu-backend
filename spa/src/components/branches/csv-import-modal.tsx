'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconX, IconUpload, IconAlertTriangle, IconCheck, IconDownload } from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';

interface PreviewBranch {
  row: number;
  name: string;
  city: string | null;
  area: string | null;
  google_link: string | null;
  nfc_id?: string;
}
interface ImportError { row: number; column?: string; message: string; }

interface ImportResponse {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  errors: ImportError[];
  preview?: PreviewBranch[];
  imported_count: number;
  imported_branches?: unknown[];
  message?: string;
}

const TEMPLATE_CSV =
  'branch_name,city,area,google_link\n' +
  'فرع الرياض - العليا,الرياض,العليا,https://g.page/r/example1\n' +
  'فرع جدة - الحمراء,جدة,الحمراء,https://g.page/r/example2\n' +
  'فرع الخبر - الظهران,الخبر,الظهران,\n';

interface Props {
  onClose: () => void;
}

export function CsvImportModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [dryResult, setDryResult] = useState<ImportResponse | null>(null);
  const [finalResult, setFinalResult] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dryRunMut = useMutation({
    mutationFn: async () =>
      apiClient<ImportResponse>('/api/branches/import', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText, dry_run: true })
      }),
    onSuccess: (data) => { setDryResult(data); setFinalResult(null); }
  });

  const importMut = useMutation({
    mutationFn: async (skipInvalid: boolean) =>
      apiClient<ImportResponse>('/api/branches/import', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText, skip_invalid: skipInvalid })
      }),
    onSuccess: (data) => {
      setFinalResult(data);
      qc.invalidateQueries({ queryKey: ['branches'] });
    }
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
      setDryResult(null);
      setFinalResult(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  function downloadTemplate() {
    const blob = new Blob([`﻿${TEMPLATE_CSV}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'repusystem-branches-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const dryErr = dryRunMut.error instanceof Error ? dryRunMut.error.message : null;
  const importErr = importMut.error instanceof Error ? importMut.error.message : null;
  const hasErrors = dryResult && dryResult.errors.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0" style={{ background: 'rgba(10,14,26,0.4)' }} />

      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-[10px]" style={{ background: 'var(--color-surface)' }}>
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--color-text-1)] m-0">استيراد فروع من CSV</h2>
            <p className="mt-1 text-[12.5px] text-[var(--color-text-3)]">
              لرفع 190 فرع دفعة واحدة. الـ NFC IDs تُولّد تلقائياً.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-[7px] p-1.5 hover:bg-[#F4F5F7]">
            <IconX size={16} style={{ color: 'var(--color-text-3)' }} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {finalResult ? (
            <ResultPanel result={finalResult} onClose={onClose} />
          ) : (
            <>
              {/* Step 1: upload */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[13px] font-semibold text-[var(--color-text-1)]">١. الملف</h3>
                  <button type="button" onClick={downloadTemplate} className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--color-primary)' }}>
                    <IconDownload size={13} />تحميل قالب جاهز
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-[7px] border px-3 py-2 text-[13px] font-medium"
                    style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}>
                    <IconUpload size={14} />اختر ملف CSV
                  </button>
                  <div className="flex-1 text-[12px] text-[var(--color-text-3)] flex items-center">
                    {csvText ? `تم اختيار ملف بحجم ${(csvText.length / 1024).toFixed(1)} ك.ب` : 'أو الصق المحتوى يدوياً أدناه'}
                  </div>
                </div>
                <textarea
                  value={csvText}
                  onChange={(e) => { setCsvText(e.target.value); setDryResult(null); setFinalResult(null); }}
                  placeholder={'branch_name,city,area,google_link\n...'}
                  className="mt-2 w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white p-3 text-[12.5px] outline-none focus:border-[var(--color-primary)] font-mono"
                  style={{ minHeight: 140, resize: 'vertical' }}
                  dir="ltr"
                />
              </section>

              {/* Step 2: dry-run */}
              <section>
                <h3 className="text-[13px] font-semibold text-[var(--color-text-1)] mb-2">٢. فحص الملف</h3>
                <button type="button" onClick={() => dryRunMut.mutate()}
                  disabled={!csvText.trim() || dryRunMut.isPending}
                  className="rounded-[7px] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--color-primary)' }}>
                  {dryRunMut.isPending ? 'جاري الفحص…' : 'فحص (لن يُحفظ شيء)'}
                </button>
                {dryErr ? <div className="mt-2 rounded-[7px] px-3 py-2 text-[12.5px]" style={{ background: 'var(--color-bad-light)', color: 'var(--color-bad)' }}>{dryErr}</div> : null}
              </section>

              {/* Step 3: results */}
              {dryResult ? (
                <section>
                  <h3 className="text-[13px] font-semibold text-[var(--color-text-1)] mb-2">٣. النتيجة</h3>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <Stat label="إجمالي الأسطر" value={dryResult.total_rows} />
                    <Stat label="صالحة" value={dryResult.valid_rows} color="good" />
                    <Stat label="بها أخطاء" value={dryResult.invalid_rows} color={dryResult.invalid_rows > 0 ? 'bad' : undefined} />
                  </div>
                  {dryResult.errors.length > 0 ? (
                    <div className="rounded-[7px] p-3 max-h-48 overflow-y-auto" style={{ background: 'var(--color-bad-light)', border: '1px solid rgba(239,68,68,0.3)' }}>
                      <div className="flex items-center gap-1.5 mb-2 text-[12.5px] font-medium" style={{ color: 'var(--color-bad)' }}>
                        <IconAlertTriangle size={14} />أخطاء وُجدت ({dryResult.errors.length})
                      </div>
                      <ul className="space-y-1 text-[12px]" style={{ color: '#7F1D1D' }}>
                        {dryResult.errors.slice(0, 30).map((err, i) => (
                          <li key={i}>السطر {err.row}{err.column ? ` · ${err.column}` : ''}: {err.message}</li>
                        ))}
                        {dryResult.errors.length > 30 ? <li className="opacity-70">… و {dryResult.errors.length - 30} خطأ آخر</li> : null}
                      </ul>
                    </div>
                  ) : (
                    <div className="rounded-[7px] p-3 flex items-center gap-2 text-[12.5px]" style={{ background: 'var(--color-good-light)', color: '#047857' }}>
                      <IconCheck size={14} />الملف خالٍ من الأخطاء. جاهز للاستيراد.
                    </div>
                  )}
                  {dryResult.preview && dryResult.preview.length > 0 ? (
                    <details className="mt-3">
                      <summary className="text-[12.5px] cursor-pointer text-[var(--color-text-2)]">معاينة أول {dryResult.preview.length} فرع</summary>
                      <div className="mt-2 rounded-[7px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                        <table className="w-full text-[12px]">
                          <thead style={{ background: '#F4F5F7' }}>
                            <tr>
                              <th className="text-right px-2 py-1.5 font-medium text-[var(--color-text-3)]">الاسم</th>
                              <th className="text-right px-2 py-1.5 font-medium text-[var(--color-text-3)]">المدينة</th>
                              <th className="text-right px-2 py-1.5 font-medium text-[var(--color-text-3)]">المنطقة</th>
                              <th className="text-right px-2 py-1.5 font-medium text-[var(--color-text-3)]">NFC ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dryResult.preview.map((p, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                                <td className="px-2 py-1.5">{p.name}</td>
                                <td className="px-2 py-1.5 text-[var(--color-text-3)]">{p.city || '—'}</td>
                                <td className="px-2 py-1.5 text-[var(--color-text-3)]">{p.area || '—'}</td>
                                <td className="px-2 py-1.5 font-mono" dir="ltr">{p.nfc_id || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                </section>
              ) : null}

              {/* Step 4: import */}
              {dryResult && dryResult.valid_rows > 0 ? (
                <section className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  {hasErrors ? (
                    <button type="button" onClick={() => importMut.mutate(true)} disabled={importMut.isPending}
                      className="rounded-[7px] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                      style={{ background: 'var(--color-warn)' }}>
                      استيراد {dryResult.valid_rows} الصالحة فقط
                    </button>
                  ) : (
                    <button type="button" onClick={() => importMut.mutate(false)} disabled={importMut.isPending}
                      className="rounded-[7px] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                      style={{ background: 'var(--color-good)' }}>
                      {importMut.isPending ? 'جاري الاستيراد…' : `استيراد ${dryResult.valid_rows} فرع`}
                    </button>
                  )}
                  <button type="button" onClick={onClose} className="rounded-[7px] border px-3.5 py-2 text-[13px] font-medium"
                    style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)' }}>إلغاء</button>
                  {importErr ? <div className="text-[12px]" style={{ color: 'var(--color-bad)' }}>{importErr}</div> : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: 'good' | 'bad' }) {
  const bg = color === 'good' ? 'var(--color-good-light)' : color === 'bad' ? 'var(--color-bad-light)' : '#F4F5F7';
  const fg = color === 'good' ? '#047857' : color === 'bad' ? '#B91C1C' : 'var(--color-text-1)';
  return (
    <div className="rounded-[7px] p-2.5" style={{ background: bg }}>
      <div className="text-[11px] text-[var(--color-text-3)]">{label}</div>
      <div className="num text-[18px] font-semibold mt-0.5" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function ResultPanel({ result, onClose }: { result: ImportResponse; onClose: () => void }) {
  return (
    <section className="space-y-3">
      <div className="rounded-[7px] p-4 text-center" style={{ background: 'var(--color-good-light)' }}>
        <IconCheck size={32} className="mx-auto" style={{ color: 'var(--color-good)' }} />
        <div className="mt-2 text-[15px] font-semibold" style={{ color: '#047857' }}>
          تم استيراد {result.imported_count} فرع بنجاح
        </div>
        {result.invalid_rows > 0 ? (
          <div className="mt-1 text-[12.5px]" style={{ color: 'var(--color-text-2)' }}>
            تم تجاوز {result.invalid_rows} سطر بها أخطاء
          </div>
        ) : null}
      </div>
      <button type="button" onClick={onClose} className="w-full rounded-[7px] py-2.5 text-[13px] font-medium text-white"
        style={{ background: 'var(--color-primary)' }}>تم</button>
    </section>
  );
}
