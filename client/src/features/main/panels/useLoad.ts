import { useCallback, useEffect, useState } from 'react';
import { get } from '@/lib/api';

interface Ok { ok?: boolean; error?: string }
export function useLoad<T extends Ok>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const d = await get<T>(path);
      if (!d.ok) throw new Error(d.error || 'Недоступно');
      setData(d);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
