import { stripEmoji } from '@/components/Icon';
import { Select } from '@/ui/radix';
import { confirmDialog } from '@/ui/dialog';
import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { safeHref } from '@/lib/safe';
import { useApp } from '@/store/app';
import { Empty, JobCell, PageHead, Pill } from '@/ui/Kit';
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
    if (!(await confirmDialog(`Откликнуться на ${offers.length} вакансий? Вакансии с опросом будут пропущены.`))) return;
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

  const PILL: Record<string, 'ok' | 'warn' | 'bad' | 'dim'> = { sent: 'ok', already: 'warn', limit: 'bad', test_required: 'warn', error: 'bad' };
  return (
    <div className={s.page}>
      <PageHead title="Рекомендации HH" count={offers.length ? offers.length : undefined} sub="Вакансии, которые HH подобрал под резюме аккаунта. Можно откликнуться на все сразу — вакансии с опросом пропускаются.">
        <Select value={cur ?? ''} onChange={(e) => { setIdx(Number(e.target.value)); setOffers([]); }}>
          {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name || a.short)}</option>)}
        </Select>
        <button className={s.btn} disabled={loading} onClick={() => void load()}><Icon name="refresh-cw" size={13} />{offers.length ? 'Обновить' : 'Загрузить'}</button>
        <button className={`${s.btn} ${s.btnOn}`} disabled={applying || !offers.length} onClick={() => void applyAll()}><Icon name="rocket" size={13} />Откликнуться на все</button>
        {applying && <button className={s.btn} onClick={() => { stop.current = true; }}><Icon name="square" size={12} />Стоп</button>}
      </PageHead>
      {msg.t && <div className={msg.bad ? s.bad : s.dim} style={{ fontSize: 12.5 }}>{msg.t}</div>}
      {offers.length === 0 && (
        <Empty icon="lightbulb" title="Рекомендации ещё не загружены" hint={loading ? 'Загружаю…' : 'Нажмите «Загрузить», чтобы увидеть вакансии, подобранные HH под ваше резюме.'}>
          {!loading && <button className={`${s.btn} ${s.btnOn}`} style={{ marginTop: 8 }} onClick={() => void load()}><Icon name="refresh-cw" size={13} />Загрузить рекомендации</button>}
        </Empty>
      )}
      {offers.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Вакансия</th><th>Статус отклика</th></tr></thead>
            <tbody>{offers.map((o) => {
              const r = res[o.vacancy_id];
              const pill = r === 'pending' ? <Pill>Отправляю…</Pill> : r ? <Pill tone={PILL[r] ?? 'dim'}>{ST[r]?.[0] ?? r}</Pill> : <span className={s.dim}>—</span>;
              return <tr key={o.vacancy_id}><td><JobCell title={o.name} company={o.employer} href={safeHref(o.url)} fallback={`hh.ru/vacancy/${o.vacancy_id}`} /></td><td className={s.nowrap}>{pill}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
