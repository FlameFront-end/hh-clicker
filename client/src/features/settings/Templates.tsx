import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Hint, Sect, useFlash } from './kit';

interface Letter { name: string; text: string }
interface Q { keywords: string[]; answer: string }

/** Список, синхронизируемый со снимком, пока пользователь его не менял. */
function useDraft<T>(source: T[] | undefined): [T[], (f: (a: T[]) => T[]) => void, () => void] {
  const [list, setList] = useState<T[]>(source ?? []);
  const [dirty, setDirty] = useState(false);
  const sig = JSON.stringify(source ?? []);
  useEffect(() => { if (!dirty) setList(source ?? []); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return [list, (f) => { setDirty(true); setList(f); }, () => setDirty(false)];
}

export function Letters() {
  const t = useT();
  const send = useApp((x) => x.sendCmd);
  const [list, update, clean] = useDraft<Letter>(useApp((x) => x.snapshot?.config?.letter_templates));
  const [flash, setFlash] = useFlash();
  return (
    <Sect icon="mail" title={t('sec_letters')}>
      <Hint>{t('sec_letters_desc')}</Hint>
      {list.map((l, i) => (
        <div key={i} className={m.tpl}>
          <div>
            <input className={s.input} placeholder="Название шаблона (напр: IT, Аналитик)" value={l.name} onChange={(e) => update((a) => a.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
            <textarea className={m.ta} rows={3} placeholder="Текст письма…" value={l.text} onChange={(e) => update((a) => a.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))} />
          </div>
          <button className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} onClick={() => update((a) => a.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
        </div>
      ))}
      <div className={m.inline}>
        <button className={s.btn} onClick={() => update((a) => [...a, { name: '', text: '' }])}><Icon name="plus" size={13} />{t('btn_add_template').replace('＋ ', '')}</button>
        <button className={s.btn} onClick={() => { send({ type: 'set_letter_templates', templates: list.map((x) => ({ name: x.name.trim(), text: x.text.trim() })).filter((x) => x.name || x.text) }); clean(); setFlash('Сохранено'); }}>{t('btn_save_templates')}</button>
        <span className={`${m.status} ${s.ok}`}>{flash}</span>
      </div>
    </Sect>
  );
}

export function Questionnaire() {
  const t = useT();
  const send = useApp((x) => x.sendCmd);
  const cfg = useApp((x) => x.snapshot?.config);
  const [list, update, clean] = useDraft<Q>(cfg?.questionnaire_templates as Q[] | undefined);
  const [def, setDef] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  return (
    <Sect icon="clipboard-list" title={t('sec_questionnaire')}>
      <Hint>{t('sec_questionnaire_desc')}</Hint>
      {list.map((q, i) => (
        <div key={i} className={m.tpl}>
          <div>
            <input className={s.input} placeholder="Ключевые слова через запятую" value={(q.keywords ?? []).join(', ')} onChange={(e) => update((a) => a.map((x, n) => (n === i ? { ...x, keywords: e.target.value.split(',').map((k) => k.trimStart()) } : x)))} />
            <textarea className={m.ta} rows={2} placeholder="Ответ" value={q.answer} onChange={(e) => update((a) => a.map((x, n) => (n === i ? { ...x, answer: e.target.value } : x)))} />
          </div>
          <button className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} onClick={() => update((a) => a.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
        </div>
      ))}
      <label><span className={s.dim}>{t('q_default_label')}</span>
        <textarea className={m.ta} rows={2} value={def ?? String(cfg?.questionnaire_default_answer ?? '')} onChange={(e) => setDef(e.target.value)} />
      </label>
      <div className={m.inline}>
        <button className={s.btn} onClick={() => update((a) => [...a, { keywords: [], answer: '' }])}><Icon name="plus" size={13} />{t('btn_add_template').replace('＋ ', '')}</button>
        <button className={s.btn} onClick={() => {
          const templates = list.map((q) => ({ keywords: (q.keywords ?? []).map((k) => k.trim()).filter(Boolean), answer: q.answer })).filter((q) => q.keywords.length || q.answer);
          send({ type: 'set_questionnaire', templates, default_answer: def ?? String(cfg?.questionnaire_default_answer ?? '') });
          clean(); setDef(null); setFlash(`Сохранено ${templates.length} шаблонов`);
        }}>{t('btn_save_templates')}</button>
        <span className={`${m.status} ${s.ok}`}>{flash}</span>
      </div>
    </Sect>
  );
}
