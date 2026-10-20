import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';

/** Загрузка JSON при монтировании + ручное обновление. */
export function useFetch<T>(path: string, query?: Record<string, string | number>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = path + JSON.stringify(query ?? {});
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await get<T>(path, query));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
