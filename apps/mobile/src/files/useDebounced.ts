import { useEffect, useState } from 'react';

/** `value`, but only once it has stayed the same for `ms`: a search field is read as the typing pauses. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
