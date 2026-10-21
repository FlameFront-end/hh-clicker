import { useEffect, useMemo, useState } from 'react';
import { get, post } from '@/lib/api';
import { stripEmoji } from '@/components/Icon';
import { Avatar, CheckPill, Search } from '@/ui/Kit';
import type { Account } from '@/types/snapshot';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';
import { type Json } from './bits';

function Spark({ graph }: { graph: { date: string; count: number }[] }) {
  const w = 240, h = 36, pad = 2;
  const max = Math.max(...graph.map((p) => p.count), 1);
  const step = (w - pad * 2) / Math.max(graph.length - 1, 1);
  return (
    <svg className={v.spark} width={w} height={h}>
      {graph.map((p, i) => {
        const bh = (p.count / max) * (h - pad * 2);
        return <rect key={i} x={pad + i * step - 1.5} y={h - pad - bh} width={3} height={Math.max(bh, 1)} fill="var(--accent)" opacity={0.7}><title>{`${p.date}: ${p.count}`}</title></rect>;
      })}
    </svg>
  );
}

const ago = (iso: unknown): string => {
  if (!iso) return '';
  const ts = Date.parse(String(iso));
  if (!Number.isFinite(ts)) return String(iso);
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d < 31 ? `${d} дн назад` : new Date(ts).toLocaleDateString('ru');
};

interface Group { key: string; id: string; name: string; count: number; fresh: number; last: unknown; vacancy?: string }

export function AccountHistory({ acc }: { acc: Account }) {
  const [d, setD] = useState<Json | null>(null);
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [all, setAll] = useState(false);
  const load = async () => { setErr(false); try { setD(await get<Json>(`/api/account/${acc.idx}/resume_views`)); } catch { setErr(true); } };
  useEffect(() => { void load(); }, [acc.idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const st: Json = d?.stats ?? {};
  const graph: { date: string; count: number }[] = st.graph_30d ?? [];
  const hist: Json[] = d?.history ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const h of hist) {
      const id = String(h.employer_id ?? ''); const name = String(h.name ?? 'Аноним');
      const key = id || name;
      const when = h.viewed_at ?? h.date;
      const g = map.get(key) ?? { key, id, name, count: 0, fresh: 0, last: when, vacancy: h.vacancy };
      g.count += 1; if (h.viewed === false) g.fresh += 1;
      map.set(key, g);
    }
    return [...map.values()];
  }, [hist]);
  const shown = groups.filter((g) => (!onlyNew || g.fresh > 0) && (!q || g.name.toLowerCase().includes(q.toLowerCase())));
  const list = all ? shown : shown.slice(0, 60);
  const discards = async () => {
    try { const r = await post<Json>(`/api/account/${acc.idx}/decline_discards`); setMsg(`Отклонено: ${r.declined ?? 0}`); } catch { setMsg('Ошибка'); }
  };
  const total = st.total_all_time || 0;
  const fresh = st.total_new_unseen || 0;
  return (
    <section className={v.sec}>
      <div className={v.vHead}>
        <Avatar name={stripEmoji(acc.name)} size={30} />
        <div className={v.vNums}>
          <span><b className={v.histBig}>{total.toLocaleString('ru')}</b> <span className={s.dim}>просмотров всего</span></span>
          {fresh > 0 && <span className={s.ok}>+{fresh} новых</span>}
          <span className={s.dim}>{groups.length} работодателей в последних {hist.length}</span>
        </div>
        {graph.length > 0 && <div className={v.vSpark} title="Просмотры за 30 дней"><Spark graph={graph} /></div>}
        <div className={v.secActs}>
          {msg && <span className={s.dim} style={{ fontSize: 12 }}>{msg}</span>}
          <button className={s.btn} onClick={() => void load()}>Обновить</button>
          <button className={s.btn} onClick={() => void discards()} title="Отклонить все отказы работодателей в переговорах">Очистить отказы</button>
        </div>
      </div>
      {err && <span className={s.bad}>Ошибка загрузки</span>}
      {!d && !err && <span className={v.muted}>Загружаю…</span>}
      {d && !hist.length && <span className={v.muted}>Просмотров пока нет</span>}
      {hist.length > 0 && (
        <>
          <div className={v.vTools}>
            <Search value={q} onChange={setQ} placeholder="Найти работодателя" />
            <CheckPill checked={onlyNew} onChange={setOnlyNew}>Только новые</CheckPill>
          </div>
          <div className={v.vGrid}>
            {list.map((g) => {
              const inner = (
                <>
                  <span className={v.vName}>{g.name}</span>
                  <span className={v.vMeta}>
                    {g.fresh > 0 && <i className={v.vDot} title="Новый просмотр" />}
                    {g.count > 1 && <span className={v.vCount}>×{g.count}</span>}
                    <span>{ago(g.last)}</span>
                  </span>
                </>
              );
              return g.id
                ? <a key={g.key} className={v.vItem} href={`https://hh.ru/employer/${encodeURIComponent(g.id)}`} target="_blank" rel="noopener noreferrer" title={g.vacancy || g.name}>{inner}</a>
                : <div key={g.key} className={v.vItem} title={g.vacancy || g.name}>{inner}</div>;
            })}
          </div>
          {!shown.length && <span className={v.muted}>Ничего не найдено</span>}
          {!all && shown.length > list.length && <div><button className={s.btn} onClick={() => setAll(true)}>Показать все ({shown.length})</button></div>}
        </>
      )}
    </section>
  );
}
