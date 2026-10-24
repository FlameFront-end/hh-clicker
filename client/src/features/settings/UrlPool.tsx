import { useState } from 'react';
import { Select } from '@/ui/radix';
import { Icon, stripEmoji } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { useDraft } from '@/lib/useDraft';
import { confirmDiscardChanges, useUnsavedChanges } from '@/lib/unsaved';
import { useApp, useT } from '@/store/app';
import type { UrlPoolItem } from '@/types/snapshot';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Actions, Hint, Sect, useFlash } from './kit';

interface Suggestion { term: string; url: string; vacancies?: number; ratio?: number }

function Suggest({ onAdd, has }: { onAdd: (url: string) => void; has: (url: string) => boolean }) {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const cur = idx ?? accounts[0]?.idx ?? null;
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [msg, setMsg] = useState<{ t: string; tone?: 'ok' | 'bad' | 'warn' } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (cur === null) return;
    setBusy(true); setItems(null); setMsg({ t: 'Анализирую резюме (10–30 с)…' });
    try {
      const d = await get<{ ok?: boolean; error?: string; suggestions?: Suggestion[] }>(`/api/account/${cur}/suggest_urls`);
      if (!d.ok) setMsg({ t: d.error || 'Ошибка', tone: 'bad' });
      else if (!d.suggestions?.length) setMsg({ t: 'Нет данных', tone: 'warn' });
      else { setItems(d.suggestions); setMsg({ t: `${d.suggestions.length} вариантов`, tone: 'ok' }); }
    } catch (e) { setMsg({ t: String(e), tone: 'bad' }); }
    setBusy(false);
  };
  return (
    <div className={m.box}>
      <b>Подсказки по резюме</b>
      <div className={m.inline}>
        <Select value={cur ?? ''} onChange={(e) => setIdx(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}
        </Select>
        <button className={s.btn} disabled={busy || cur === null} onClick={() => void run()}><Icon name="search" size={13} />Подобрать</button>
        {msg && <span className={`${m.status} ${msg.tone ? s[msg.tone] : s.dim}`}>{msg.t}</span>}
      </div>
      <Hint>Анализирует title, роль и скилы резюме и предлагает запросы с цифрами конкуренции.</Hint>
      {items && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Запрос</th><th style={{ textAlign: 'right' }}>Вакансий</th><th style={{ textAlign: 'right' }}>Конкуренция</th><th /></tr></thead>
            <tbody>
              {items.map((x, i) => {
                const r = Number(x.ratio || 0);
                const tone = r >= 50 ? s.bad : r >= 25 ? s.warn : r > 0 ? s.ok : s.dim;
                const added = has(x.url);
                return (
                  <tr key={i}>
                    <td>{x.term}</td>
                    <td style={{ textAlign: 'right' }}>{(x.vacancies || 0).toLocaleString('ru')}</td>
                    <td style={{ textAlign: 'right' }} className={tone}>{r > 0 ? `${r} ч/в` : '—'}</td>
                    <td><button className={`${s.btn} ${s.btnSm}`} disabled={added} onClick={() => onAdd(x.url)}>{added ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function UrlPool() {
  const t = useT();
  const connected = useApp((x) => x.connected);
  const cfg = useApp((x) => x.snapshot?.config);
  const global = Number(cfg?.pages_per_url ?? 40);
  // Mobile-профили берут одну общую глубину (не больше 20 стр.) — поле «стр.» на них не действует.
  const hasWeb = (useApp((x) => x.snapshot?.accounts) ?? []).some((a) => !['mobile', 'oauth'].includes(String(a.mode || '').toLowerCase()));
  const source = cfg?.url_pool as (UrlPoolItem | string)[] | undefined;
  const [busy, setBusy] = useState(false);
  const asRows = (items: (UrlPoolItem | string)[]) => items.map((u) => ({ url: typeof u === 'string' ? u : u.url, pages: String(typeof u === 'string' ? global : u.pages ?? global) }));
  const { base, draft: rows, setDraft: setRows, dirty, accept, reset } = useDraft(asRows(source ?? []), busy);
  useUnsavedChanges(dirty || busy);
  const [flash, setFlash] = useFlash();
  const [tone, setTone] = useState<'ok' | 'bad' | undefined>(undefined);
  const edit = (f: (r: typeof rows) => typeof rows) => { setRows(f); setFlash(''); };
  const save = async () => {
    if (busy || !connected || !dirty) return;
    setBusy(true); setTone(undefined); setFlash('Сохраняю…');
    const urls = rows.map((r) => ({ url: r.url.trim(), pages: Number(r.pages) || global })).filter((u) => u.url);
    try {
      const result = await post<{ ok?: boolean; urls: UrlPoolItem[]; error?: string }>('/api/search-pool', {
        action: 'replace', urls, base_urls: base.map((r) => ({ url: r.url, pages: Number(r.pages) || global })),
      });
      if (!result.ok) throw new Error(result.error || 'Не удалось сохранить пул');
      accept(asRows(result.urls)); setTone('ok'); setFlash(`Сохранено (${result.urls.length} URL)`);
    } catch (e) { setTone('bad'); setFlash(`Сохранение не подтверждено: ${e instanceof Error ? e.message : String(e)}. Черновик оставлен.`); }
    finally { setBusy(false); }
  };
  return (
    <Sect icon="link" title={t('sec_url_pool')}>
      {!connected && <p role="status">Нет связи с сервером. Сохранение недоступно; черновик оставлен.</p>}
      <fieldset disabled={busy || !connected} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Hint>Ссылки поиска вакансий появятся как чекбоксы на карточке аккаунта. «Стр.» — глубина поиска для ссылки; пусто — общее значение ({global}).</Hint>
      {rows.length === 0 && <div className={m.emptyRow}>Пока нет ссылок. Добавьте URL поиска с hh.ru или подберите по резюме.</div>}
      {rows.length > 0 && (
        <div className={m.urlList}>
          {rows.map((r, i) => (
            <div key={i} className={m.urlItem}>
              <span className={m.urlNum}>{i + 1}</span>
              <input className={`${s.input} ${m.urlInp}`} placeholder="https://hh.ru/search/vacancy?…" value={r.url} title={r.url} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, url: e.target.value } : x)))} />
              <label className={m.urlPages} title={hasWeb ? undefined : 'Для mobile-профилей действует общая глубина из «Скорость и лимиты»'} style={hasWeb ? undefined : { opacity: 0.45 }}><span>стр.</span><input className={s.input} type="number" min={1} max={100} disabled={!hasWeb} placeholder={String(global)} value={r.pages} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, pages: e.target.value } : x)))} /></label>
              <button className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} aria-label="Удалить" onClick={() => edit((a) => a.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <Suggest has={(u) => rows.some((r) => r.url === u)} onAdd={(u) => edit((a) => [...a, { url: u, pages: '' }])} />
      <Actions status={flash || (dirty ? 'Есть несохранённые изменения' : '')} tone={tone}>
        <button className={s.btn} onClick={() => edit((a) => [...a, { url: '', pages: '' }])}><Icon name="plus" size={13} />Добавить URL</button>
        <button disabled={!dirty} className={`${s.btn} ${s.btnOn}`} onClick={() => void save()}>{busy ? 'Сохраняю…' : t('btn_save_pool')}</button>
        <button className={s.btn} onClick={() => { if (confirmDiscardChanges()) { reset(); setFlash(''); } }}>Загрузить актуальные ссылки</button>
      </Actions>
      </fieldset>
    </Sect>
  );
}
