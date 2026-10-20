import { useState } from 'react';
export function useSort(field: string) {
  const [sort, setSort] = useState<{ field: string; dir: 1 | -1 }>({ field, dir: -1 });
  const onSort = (f: string) => setSort((s) => (s.field === f ? { field: f, dir: (s.dir * -1) as 1 | -1 } : { field: f, dir: -1 }));
  return { sort, onSort };
}
