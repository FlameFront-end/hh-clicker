import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import type { UrlPoolItem } from '@/types/snapshot';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Hint, Sect, useFlash } from './kit';

export function UrlPool() {
  const t = useT();
  const send = useApp((x) => x.sendCmd);
  const cfg = useApp((x) => x.snapshot?.config);
  const global = Number(cfg?.pages_per_url ?? 40);
  const source = cfg?.url_pool as UrlPoolItem[] | undefined;
  const [rows, setRows] = useState<{ url: string; pages: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [flash, setFlash] = useFlash();
  const sig = JSON.stringify(source ?? []);
  useEffect(() => { if (!dirty) setRows((source ?? []).map((u) => ({ url: u.url, pages: String(u.pages ?? '') }))); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (f: (r: typeof rows) => typeof rows) => { setDirty(true); setRows(f); };
  return (
    <Sect icon="link" title={t('sec_url_pool')}>
      <Hint>Добавьте URL поиска вакансий — они появятся как чекбоксы на карточке аккаунта. Поле «стр.» — глубина поиска для запроса; если пусто — глобальное значение ({global}).</Hint>
      {rows.map((r, i) => (
        <div key={i} className={m.urlRow}>
          <input className={s.input} placeholder="https://hh.ru/search/vacancy?…" value={r.url} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, url: e.target.value } : x)))} />
          <input className={s.input} style={{ width: 70, minWidth: 0 }} type="number" min={1} max={100} placeholder="стр." value={r.pages} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, pages: e.target.value } : x)))} />
          <button className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} onClick={() => edit((a) => a.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
        </div>
      ))}
      <div className={m.inline}>
        <button className={s.btn} onClick={() => edit((a) => [...a, { url: '', pages: '' }])}><Icon name="plus" size={13} />Добавить URL</button>
        <button className={s.btn} onClick={() => {
          const urls = rows.map((r) => ({ url: r.url.trim(), pages: parseInt(r.pages, 10) || global })).filter((u) => u.url);
          send({ type: 'set_url_pool', urls }); setDirty(false); setFlash(`Сохранено (${urls.length} URL)`);
        }}>{t('btn_save_pool')}</button>
        <span className={`${m.status} ${s.ok}`}>{flash}</span>
      </div>
    </Sect>
  );
}
