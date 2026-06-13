'use client';

import { useEffect, useState } from 'react';
import { relativeTimeAr } from '@/lib/format';

/**
 * Renders a relative-time string ("منذ 5 دقائق") that's safe across SSR.
 *
 * The server computes the value at request time, and the client recomputes
 * a moment later on hydration. The two strings usually differ by a second
 * — React would flag that as a hydration mismatch. `suppressHydrationWarning`
 * tells React the difference is intentional and not a bug.
 *
 * The component also refreshes once per minute on the client so visible
 * "منذ X دقائق" stays current without a full re-fetch.
 */
interface Props {
  at: string | number | Date;
  className?: string;
  style?: React.CSSProperties;
  dir?: 'ltr' | 'rtl' | 'auto';
}

export function TimeAgo({ at, className, style, dir }: Props) {
  const [text, setText] = useState(() => relativeTimeAr(at));

  useEffect(() => {
    setText(relativeTimeAr(at));
    const id = setInterval(() => setText(relativeTimeAr(at)), 60_000);
    return () => clearInterval(id);
  }, [at]);

  return (
    <span className={className} style={style} dir={dir} suppressHydrationWarning>
      {text}
    </span>
  );
}
