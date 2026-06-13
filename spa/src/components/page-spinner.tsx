export function PageSpinner({ label = 'جاري التحميل…' }: { label?: string }) {
  return (
    <div className="flex h-[60vh] items-center justify-center" style={{ color: 'var(--color-text-3)', fontSize: 13 }}>
      {label}
    </div>
  );
}
