export function EmptyState({ message = 'لا توجد بيانات متاحة حالياً' }: { message?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-8"
      style={{ color: 'var(--color-text-3)', fontSize: 13 }}
    >
      <span>{message}</span>
    </div>
  );
}
