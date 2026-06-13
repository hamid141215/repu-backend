import { IconSearch, IconHelp, IconPlus, IconBell } from '@tabler/icons-react';

interface Props {
  hasAlerts?: boolean;
}

export function Topbar({ hasAlerts = false }: Props) {
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
            aria-label="بحث"
            className="rounded-[7px] py-1.5 ps-3 pe-8 text-[13px] outline-none"
            style={{
              width: 280,
              background: '#F4F5F7',
              border: '1px solid transparent',
              fontFamily: 'inherit'
            }}
          />
          <IconSearch
            size={15}
            className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--color-text-3)' }}
          />
          <span className="kbd absolute start-2 top-1/2 -translate-y-1/2">⌘K</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="مركز المساعدة"
          title="مركز المساعدة"
          className="rounded-[7px] p-2 transition hover:bg-[#F4F5F7]"
          style={{ color: 'var(--color-text-2)' }}
        >
          <IconHelp size={16} />
        </button>

        <button
          type="button"
          aria-label="الإشعارات"
          title={hasAlerts ? 'لديك شكاوى متأخرة تحتاج اهتمامك' : 'الإشعارات'}
          className="relative rounded-[7px] p-2 transition hover:bg-[#F4F5F7]"
          style={{ color: 'var(--color-text-2)' }}
        >
          <IconBell size={16} />
          {hasAlerts ? (
            <span
              className="absolute"
              style={{
                top: 4, left: 6,
                width: 7, height: 7,
                background: 'var(--color-bad)',
                borderRadius: '50%',
                border: '2px solid var(--color-surface)'
              }}
            />
          ) : null}
        </button>

        <button
          type="button"
          disabled
          className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--color-primary)' }}
        >
          <IconPlus size={14} />إنشاء
        </button>
      </div>
    </header>
  );
}
