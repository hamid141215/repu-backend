'use client';

interface Props {
  variant: 'loading' | 'error' | 'empty';
  message?: string;
}

export function ChartFrame({ variant, message }: Props) {
  if (variant === 'loading') {
    return (
      <div
        className="animate-pulse rounded-[7px] h-full"
        style={{ background: '#F4F5F7' }}
      />
    );
  }
  if (variant === 'error') {
    return (
      <div className="flex items-center justify-center h-full text-[13px]" style={{ color: 'var(--color-bad)' }}>
        تعذر تحميل الرسم البياني
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center h-full text-[13px]" style={{ color: 'var(--color-text-3)' }}>
      {message || 'لا توجد بيانات متاحة حالياً'}
    </div>
  );
}
