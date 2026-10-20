import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { stripEmoji } from '@/components/Icon';
import { colorVar } from '@/lib/safe';
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

export function AccountHistory({ acc }: { acc: Account }) {
  const [d, setD] = useState<Json | null>(null);
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const load = async () => { setErr(false); try { setD(await get<Json>(`/api/account/${acc.idx}/resume_views`)); } catch { setErr(true); } };
  useEffect(() => { void load(); }, [acc.idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const st: Json = d?.stats ?? {};
  const graph: { date: string; count: number }[] = st.graph_30d ?? [];
  const hist: Json[] = d?.history ?? [];
  const discards = async () => {
    try { const r = await post<Json>(`/api/account/${acc.idx}/decline_discards`); setMsg(`Отклонено: ${r.declined ?? 0}`); } catch { setMsg('Ошибка'); }
  };
  return (
    <section className={v.sec}>
      <div className={v.secHead}>
        <h3 className={v.secTitle} style={{ color: colorVar(acc.color) }}>{stripEmoji(acc.name)}</h3>
        <button className={s.btn} onClick={() => void load()}>История просмотров</button>
        <button className={s.btn} onClick={() => void discards()}>Очистить дискарды</button>
        <span className={v.status}>{msg}</span>
      </div>
      {err && <span className={s.bad}>Ошибка загрузки</span>}
      {!d && !err && <span className={s.dim}>Загружаю…</span>}
      {d && (st.total_all_time || graph.length > 0) && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div><div className={v.cardLbl}>всего просмотров</div><div style={{ fontSize: 20, fontWeight: 600 }}>{(st.total_all_time || 0).toLocaleString('ru')}</div>{st.total_new_unseen ? <div className={s.ok} style={{ fontSize: 11 }}>+{st.total_new_unseen} новых</div> : null}</div>
          {graph.length > 0 && <div><div className={v.cardLbl}>30 дней</div><Spark graph={graph} /></div>}
        </div>
      )}
      {d && !hist.length && <span className={s.dim}>Нет данных</span>}
      {hist.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Дата</th><th>Работодатель</th><th>Вакансия</th></tr></thead>
            <tbody>{hist.map((h, i) => (
              <tr key={i}><td className={s.dim}>{h.date}</td>
                <td><a href={`https://hh.ru/employer/${encodeURIComponent(h.employer_id)}`} target="_blank" rel="noopener noreferrer">{h.name}</a></td>
                <td className={s.dim}>{h.vacancy}</td></tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
