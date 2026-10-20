import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, get, post, del } from '@/lib/api';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Hint, Hr, Sect } from './kit';

type Obj = Record<string, unknown>;
interface SaveRes { ok?: boolean; restored?: string[]; warning?: string; error?: string; errors?: unknown }

/** Поля, потеря которых при сохранении JSON считается опасной (как в старом UI). */
const LOSS_FIELDS: Record<string, string[] | null> = {
  accounts: ['letter', 'url_pool'], url_pool: null, letter_templates: null, questionnaire: null,
};

function lostFields(cur: Obj, next: Obj): string[] {
  const lost: string[] = [];
  for (const [name, fields] of Object.entries(LOSS_FIELDS)) {
    const o = cur[name]; const n = next[name];
    if (fields && Array.isArray(o) && Array.isArray(n)) {
      o.forEach((oa, i) => {
        const na = (n[i] ?? {}) as Obj;
        for (const f of fields) {
          const ov = (oa as Obj)?.[f]; const nv = na[f];
          const oNon = Array.isArray(ov) || typeof ov === 'string' ? (ov as unknown[] | string).length > 0 : !!ov;
          const nEmpty = Array.isArray(nv) || typeof nv === 'string' ? (nv as unknown[] | string).length === 0 : !nv;
          if (oNon && nEmpty) lost.push(`${name}[${i}]/${f}`);
        }
      });
    } else if (!fields) {
      const oa = Array.isArray(o) ? o : []; const na = Array.isArray(n) ? n : [];
      if (oa.length > 0 && na.length === 0) lost.push(`${name} (${oa.length} → 0)`);
    }
  }
  return lost;
}

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function JsonBackup() {
  const [text, setText] = useState('');
  const [st, setSt] = useState<{ t: string; tone?: 'ok' | 'bad' } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const say = (t: string, tone?: 'ok' | 'bad') => setSt({ t, tone });

  const load = async () => {
    try { setText(JSON.stringify(await get('/api/backup'), null, 2)); say('Загружено'); }
    catch (e) { say(String(e), 'bad'); }
  };
  const afterWrite = (r: SaveRes) => {
    if (r.ok === false || r.error) { say(r.error ?? JSON.stringify(r.errors ?? {}), 'bad'); return; }
    say(`Сохранено: ${(r.restored ?? []).join(', ')}. ${r.warning ?? ''}`, 'ok');
    void load();
  };
  const save = async () => {
    let parsed: Obj;
    try { parsed = JSON.parse(text) as Obj; } catch (e) { say(`Невалидный JSON: ${(e as Error).message}`, 'bad'); return; }
    setBusy(true);
    try {
      const cur = await get<Obj>('/api/backup');
      const lost = lostFields(cur, parsed);
      const msg = lost.length
        ? `Потеряются непустые поля:\n• ${lost.join('\n• ')}\n\nПродолжить (затрёт всё)?`
        : 'Сохранить и перезаписать ВСЕ data/*.json? Текущие данные потеряются.';
      if (!window.confirm(msg)) { setBusy(false); return; }
      afterWrite(await post<SaveRes>('/api/backup', parsed as never));
    } catch (e) { say(String(e), 'bad'); }
    setBusy(false);
  };
  const restore = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as Obj;
      if (!window.confirm(`Восстановить из «${f.name}»? Текущие data/*.json будут перезаписаны.`)) return;
      afterWrite(await post<SaveRes>('/api/backup', parsed as never));
    } catch (e) { say(String(e), 'bad'); }
    if (file.current) file.current.value = '';
  };
  const wipe = async () => {
    if (!window.confirm('Удалить ВСЕ данные (аккаунты, шаблоны, пул)? Действие необратимо.')) return;
    if (!window.confirm('Точно стереть? Это второе подтверждение.')) return;
    try {
      const r = await del<{ cleared?: string[] }>('/api/backup');
      say(`Очищено: ${(r.cleared ?? []).join(', ')}`, 'ok'); void load();
    } catch (e) { say(String(e), 'bad'); }
  };

  return (
    <Sect icon="database" title="JSON и бэкап">
      <Hint>Прямое редактирование data/*.json одним документом. Перед сохранением проверяется, не потеряются ли непустые поля.</Hint>
      <div className={m.inline}>
        <button className={s.btn} onClick={async () => { try { download(`hh-backup-${stamp()}.json`, JSON.stringify(await get('/api/backup'), null, 2)); } catch (e) { say(String(e), 'bad'); } }}><Icon name="download" size={13} />Скачать бэкап</button>
        <button className={s.btn} onClick={() => file.current?.click()}><Icon name="upload" size={13} />Восстановить из файла</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void restore(f); }} />
        <button className={s.btn} onClick={() => void load()}>Загрузить в редактор</button>
        <button className={`${s.btn} ${s.btnDanger}`} onClick={() => void wipe()}><Icon name="trash-2" size={13} />Стереть всё</button>
      </div>
      {text !== '' && (
        <>
          <textarea className={m.ta} style={{ fontFamily: 'var(--mono)', minHeight: 280 }} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
          <div className={m.inline}>
            <button className={s.btn} disabled={busy} onClick={() => void save()}>Сохранить JSON</button>
          </div>
        </>
      )}
      {st && <div className={`${m.status} ${st.tone === 'ok' ? s.ok : st.tone === 'bad' ? s.bad : s.dim}`} style={{ whiteSpace: 'pre-wrap' }}>{st.t}</div>}
    </Sect>
  );
}

export function Diagnostics() {
  const [info, setInfo] = useState('');
  const fetchBundle = async () => {
    setInfo('читаю…');
    const r = await api<unknown>('/api/diagnostic_bundle');
    const txt = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
    setInfo(`${(txt.length / 1024).toFixed(1)} KB готово`);
    return txt;
  };
  return (
    <Sect icon="activity" title="Диагностика">
      <Hint>Сводка состояния бота для отчёта об ошибке: версия, конфиг без секретов, последние события.</Hint>
      <Hr />
      <div className={m.inline}>
        <button className={s.btn} onClick={async () => {
          try { await navigator.clipboard.writeText(await fetchBundle()); setInfo('скопировано в буфер'); }
          catch { setInfo('буфер недоступен — используйте «Скачать»'); }
        }}><Icon name="copy" size={13} />Копировать</button>
        <button className={s.btn} onClick={async () => { try { download(`hh-bot-diag-${stamp()}.txt`, await fetchBundle(), 'text/plain'); } catch (e) { setInfo(String(e)); } }}><Icon name="download" size={13} />Скачать</button>
        <span className={`${m.status} ${s.dim}`}>{info}</span>
      </div>
    </Sect>
  );
}
