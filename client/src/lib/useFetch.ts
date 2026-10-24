import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';

/** Загрузка JSON при монтировании + ручное обновление. */
export function useFetch<T>(path: string, query?: Record<string, string | number>, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');
  const controller = useRef<AbortController | null>(null);
  const key = path + JSON.stringify(query ?? {});
  const reload = useCallback(async (poll = false) => {
    if (poll && controller.current) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(null);
    try {
      const result = await get<T>(path, query, current.signal);
      if (!current.signal.aborted) { setData(result); setUpdatedAt(new Date().toISOString()); }
    } catch (e) {
      if (!current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === current) controller.current = null;
      if (!current.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    void reload();
    const timer = pollMs > 0 ? window.setInterval(() => { if (!document.hidden) void reload(true); }, pollMs) : undefined;
    return () => { window.clearInterval(timer); controller.current?.abort(); };
  }, [reload, pollMs]);
  return { data, error, loading, reload, updatedAt };
}
