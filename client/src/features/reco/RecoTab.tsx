import { stripEmoji } from '@/components/Icon';
import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { safeHref } from '@/lib/safe';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';

interface Offer { vacancy_id: string; name?: string; employer?: string; url?: string }
const ST: Record<string, [string, string]> = {
  sent: ['Отправлено', s.ok], already: ['Уже откликались', s.warn], limit: ['Лимит', s.bad], test_required: ['Нужен опрос', s.warn], error: ['Ошибка', s.bad],
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function RecoTab() {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [res, setRes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: string; bad: boolean }>({ t: '', bad: false });
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const stop = useRef(false);
  const cur = idx ?? accounts[0]?.idx ?? null;

  const load = async () => {
    if (cur === null || loading) return;
    setLoading(true); setRes({}); setMsg({ t: 'Загружаю…', bad: false });
    try {
      const d = await get<{ ok?: boolean; offers?: Offer[]; error?: string }>(`/api/account/${cur}/hh_recommendations`);
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      setOffers(d.offers ?? []);
      setMsg({ t: `Найдено рекомендаций: ${d.offers?.length ?? 0}`, bad: false });
    } catch (e) { setOffers([]); setMsg({ t: e instanceof Error ? e.message : String(e), bad: true }); }
    finally { setLoading(false); }
  };

  const applyAll = async () => {
    if (cur === null || applying || !offers.length) return;
    if (!confirm(`Откликнуться на ${offers.length} вакансий? Вакансии с опросом будут пропущены.`)) return;
    setApplying(true); stop.current = false;
    const counts: Record<string, number> = {};
    for (const o of offers) {
      if (stop.current) break;
      setRes((r) => ({ ...r, [o.vacancy_id]: 'pending' }));
      let st = 'error';
      try { const d = await post<{ status?: string }>('/api/apply/check', { account_idx: cur, vacancy_id: o.vacancy_id, letter: '' }); st = d.status && d.status in ST ? d.status : 'error'; } catch { /* error */ }
      counts[st] = (counts[st] ?? 0) + 1;
      setRes((r) => ({ ...r, [o.vacancy_id]: st }));
      if (st === 'limit') break;
      await sleep(500);
    }
    setMsg({ t: Object.entries(counts).map(([k, v]) => `${ST[k]?.[0] ?? k}: ${v}`).join(' · '), bad: false });
    setApplying(false);
  };

  return (
    <div className={s.page}>
      <h2 className={s.title}>Рекомендации HH</h2>
      <p className={s.dim} style={{ margin: 0 }}>Вакансии, которые HH подобрал под резюме аккаунта. Можно откликнуться на все одной кнопкой (с опросом — пропускаются).</p>
      <div className={s.filters}>
        <select className={s.select} value={cur ?? ''} onChange={(e) => { setIdx(Number(e.target.value)); setOffers([]); }}>
          {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name || a.short)}</option>)}
        </select>
        <button className={s.btn} disabled={loading} onClick={() => void load()}><Icon name="refresh-cw" size={13} />Загрузить</button>
        <button className={s.btn} disabled={applying || !offers.length} onClick={() => void applyAll()}><Icon name="rocket" size={13} />Откликнуться на все</button>
        {applying && <button className={s.btn} onClick={() => { stop.current = true; }}><Icon name="square" size={12} />Стоп</button>}
        <span className={msg.bad ? s.bad : s.dim}>{msg.t}</span>
      </div>
      {offers.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Вакансия</th><th>Работодатель</th><th>Ссылка</th><th>Статус</th></tr></thead>
            <tbody>{offers.map((o) => {
              const r = res[o.vacancy_id];
              const [l, c] = r === 'pending' ? ['…', s.dim] : r ? ST[r] ?? [r, s.dim] : ['—', s.dim];
              return <tr key={o.vacancy_id}><td>{o.name}</td><td>{o.employer}</td>
                <td><a href={safeHref(o.url)} target="_blank" rel="noopener noreferrer">hh.ru/vacancy/{o.vacancy_id}</a></td><td className={c}>{l}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
