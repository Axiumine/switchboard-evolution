import { useEffect, useState } from 'react';

/** The time, again every second while `active` (for "working 44s"). */
export function useSeconds(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    // Right away too: the time kept from before may be long gone.
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [active]);
  return now;
}
