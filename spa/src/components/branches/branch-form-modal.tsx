'use client';

import { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { useCreateBranch, useUpdateBranch, type BranchInput } from '@/lib/queries';
import type { BranchRow } from '@/types/api';

interface Props {
  mode: 'create' | 'edit';
  branch: BranchRow | null;
  onClose: () => void;
}

export function BranchFormModal({ mode, branch, onClose }: Props) {
  const [form, setForm] = useState<BranchInput>({
    name: branch?.name ?? '',
    city: branch?.city ?? '',
    area: branch?.area ?? '',
    google_link: branch?.google_link ?? '',
    nfc_id: branch?.nfc_id ?? '',
    is_active: branch?.is_active ?? true
  });
  const [err, setErr] = useState<string | null>(null);

  const create = useCreateBranch();
  const update = useUpdateBranch();
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  function update_<K extends keyof BranchInput>(key: K, value: BranchInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = (form.name || '').trim();
    if (!name) { setErr('اسم الفرع مطلوب'); return; }
    if (name.length > 120) { setErr('اسم الفرع طويل جداً'); return; }
    setErr(null);

    const payload: BranchInput = {
      name,
      city: form.city?.trim() || null,
      area: form.area?.trim() || null,
      google_link: form.google_link?.trim() || null,
      nfc_id: form.nfc_id?.trim() || undefined,
      is_active: form.is_active
    };

    try {
      if (mode === 'create') {
        await create.mutateAsync(payload);
      } else if (branch) {
        await update.mutateAsync({ id: branch.id, ...payload });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'تعذر حفظ الفرع');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 cursor-default"
        style={{ background: 'rgba(10, 14, 26, 0.4)' }}
      />
      <div
        className="relative rounded-[12px] w-full"
        style={{
          maxWidth: 480,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 12px 32px rgba(10, 14, 26, 0.12)'
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-text-1)]">
              {mode === 'create' ? 'إضافة فرع جديد' : 'تعديل بيانات الفرع'}
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-3)]">
              {mode === 'create'
                ? 'سيُولَّد معرّف NFC تلقائياً إذا تركته فارغاً'
                : 'حدّث بيانات الفرع — لا يؤثر على التقييمات السابقة'}
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={() => !pending && onClose()}
            disabled={pending}
            className="rounded-[7px] p-1.5 transition hover:bg-[#F4F5F7] disabled:opacity-60"
          ><IconX size={16} style={{ color: 'var(--color-text-3)' }} /></button>
        </header>

        <form onSubmit={onSubmit} className="p-5 space-y-3.5">
          <Field label="اسم الفرع" required>
            <input
              value={form.name}
              onChange={(e) => update_('name', e.target.value)}
              placeholder="مثال: فرع الرياض — العليا"
              disabled={pending}
              className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
              style={{ borderColor: 'var(--color-border-strong)' }}
              maxLength={120}
              autoFocus
            />
          </Field>

          <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="المدينة">
              <input
                value={form.city ?? ''}
                onChange={(e) => update_('city', e.target.value)}
                placeholder="الرياض"
                disabled={pending}
                className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ borderColor: 'var(--color-border-strong)' }}
                maxLength={60}
              />
            </Field>
            <Field label="الحي / المنطقة">
              <input
                value={form.area ?? ''}
                onChange={(e) => update_('area', e.target.value)}
                placeholder="العليا"
                disabled={pending}
                className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ borderColor: 'var(--color-border-strong)' }}
                maxLength={60}
              />
            </Field>
          </div>

          <Field label="رابط Google Maps" hint="اختياري — يُستخدم لتوجيه التقييمات الإيجابية">
            <input
              value={form.google_link ?? ''}
              onChange={(e) => update_('google_link', e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              disabled={pending}
              dir="ltr"
              className="w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
              style={{ borderColor: 'var(--color-border-strong)' }}
            />
          </Field>

          {mode === 'edit' ? (
            <Field label="معرّف NFC" hint="يتم إنشاؤه تلقائياً عند إنشاء الفرع">
              <input
                value={form.nfc_id ?? ''}
                onChange={(e) => update_('nfc_id', e.target.value)}
                disabled={pending}
                dir="ltr"
                className="num w-full rounded-[7px] border bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"
                style={{ borderColor: 'var(--color-border-strong)' }}
              />
            </Field>
          ) : null}

          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-1)] cursor-pointer">
            <input
              type="checkbox"
              checked={!!form.is_active}
              onChange={(e) => update_('is_active', e.target.checked)}
              disabled={pending}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            الفرع نشط
          </label>

          {err ? (
            <div className="rounded-[7px] border px-3 py-2 text-[12.5px]" style={{ background: 'var(--color-bad-light)', borderColor: 'var(--color-bad)', color: 'var(--color-bad)' }}>
              {err}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => !pending && onClose()}
              disabled={pending}
              className="rounded-[7px] border px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)', background: 'var(--color-surface)' }}
            >إلغاء</button>
            <button
              type="submit"
              disabled={pending || !form.name?.trim()}
              className="rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >{pending ? 'جاري الحفظ…' : mode === 'create' ? 'إضافة الفرع' : 'حفظ التغييرات'}</button>
          </div>
        </form>
      </div>
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
