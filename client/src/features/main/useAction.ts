import { useCallback, useEffect, useRef, useState } from 'react';

/** Кнопка с асинхронным действием: busy → msg/error, который гаснет сам. */
export function useAction(fn: () => Promise<unknown>, resetMs = 4000) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setMsg(typeof r === 'string' ? r : null);
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 40) : 'ошибка');
    } finally {
      setBusy(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setMsg(null); setError(null); }, resetMs);
    }
  }, [busy, fn, resetMs]);
  return { busy, msg, error, run };
}
