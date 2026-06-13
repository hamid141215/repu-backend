import { IconUsers } from '@tabler/icons-react';

export default function TeamPage() {
  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)]">الفريق والصلاحيات</h1>
        <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">إدارة المستخدمين وأذونات الوصول</p>
      </div>
      <div
        className="rounded-[10px] flex flex-col items-center justify-center text-center py-16"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
          <IconUsers size={22} />
        </div>
        <div className="mt-3 text-[15px] font-semibold text-[var(--color-text-1)]">قريباً</div>
        <div className="mt-1 text-[12.5px] text-[var(--color-text-3)] max-w-md">إدارة الفريق والصلاحيات ستكون متاحة في تحديث قادم.</div>
      </div>
    </div>
  );
}
