import { useState } from 'react';
import { useDraft } from '@/lib/useDraft';
import { patch } from '@/lib/api';
import { useUnsavedChanges } from '@/lib/unsaved';
import { useApp } from '@/store/app';
import type { Account, ResumeFilters } from '@/types/snapshot';
import { Select } from '@/ui/radix';
import { effectiveList, SOURCE_LABEL, type FilterKey } from '@/features/main/panels/searchInfo';
import { ChipSet, Field, TagInput, Actions } from './kit';
import s from '@/ui/Ui.module.css';

const EXP: [string, string][] = [['noExperience', 'Без опыта'], ['between1And3', '1–3 года'], ['between3And6', '3–6 лет'], ['moreThan6', '6+ лет']];
const FMT: [string, string][] = [['REMOTE', 'Удалёнка'], ['HYBRID', 'Гибрид'], ['ON_SITE', 'Офис']];
const WORDS: [FilterKey, string, 'ok' | 'bad'][] = [['title_include_keywords', 'Разрешить в названии', 'ok'], ['title_exclude_keywords', 'Исключить в названии', 'bad'], ['employer_exclude_keywords', 'Исключить работодателей', 'bad']];
type Rules = Partial<ResumeFilters>;

/** null deletes an override; [] deliberately disables a filter. */
export function ResumeRules({ acc, hash }: { acc: Account; hash: string }) {
  const cfg = useApp((x) => x.snapshot?.config);
  const connected = useApp((x) => x.connected);
  const profile = acc.resume_filters?.[hash] ?? {};
  const sig = JSON.stringify(profile);
  const [busy, setBusy] = useState(false);
  const { base, draft, setDraft, dirty, accept, reset } = useDraft<Rules>(profile, busy);
  const [msg, setMsg] = useState('');
  useUnsavedChanges(dirty || busy);
  const inherited = (key: keyof ResumeFilters) => !(key in draft);
  const override = (key: keyof ResumeFilters, on: boolean) => {
    setMsg('');
    setDraft((d) => {
      const next = { ...d };
      if (on) {
        next[key] = key === 'experience' || key === 'allowed_work_formats' ? [] : effectiveList({ ...acc, resume_hash: hash, resume_filters: {} }, cfg, key).list;
      } else delete next[key];
      return next;
    });
  };
  const change = (key: keyof ResumeFilters, value: string[]) => { setDraft((d) => ({ ...d, [key]: value })); setMsg(''); };
  const save = async () => {
    if (busy || !dirty || !connected) return;
    const sent = { ...draft };
    const filters = Object.fromEntries((Object.keys({ ...base, ...sent }) as (keyof ResumeFilters)[])
      .filter((k) => JSON.stringify(base[k]) !== JSON.stringify(sent[k])).map((k) => [k, sent[k] ?? null]));
    setBusy(true); setMsg('Сохраняю…');
    try {
      const r = await patch<{ ok?: boolean; error?: string; filters: Rules }>(`/api/account/${acc.idx}/resume_filters`, { resume_hash: hash, filters });
      if (!r.ok) throw new Error(r.error || 'Не удалось сохранить');
      accept(r.filters); setMsg('Сохранено. Применится перед следующей отправкой.');
    } catch (e) { setMsg(`Ошибка: ${e instanceof Error ? e.message : String(e)}. Сохранение не подтверждено. Черновик оставлен; проверьте актуальные настройки перед повтором.`); }
    finally { setBusy(false); }
  };
  return <div>
    <p>Все изменения ниже — только для этого резюме. Сначала отредактируйте, затем сохраните.</p>
    {WORDS.map(([key, label, tone]) => {
      const eff = effectiveList({ ...acc, resume_hash: hash, resume_filters: {} }, cfg, key);
      return <Field key={key} label={label} hint={inherited(key) ? `Источник: ${SOURCE_LABEL[eff.source]}. ${eff.list.length ? eff.list.join(', ') : 'Ограничения нет.'}` : 'Пустой список — отключить этот фильтр для резюме.'}>
        <Select aria-label={`${label}: источник`} disabled={busy} value={inherited(key) ? 'inherit' : 'own'} onChange={(e) => override(key, e.target.value === 'own')}>
          <option value="inherit">Наследовать от профиля / общих настроек</option><option value="own">Свои правила резюме</option>
        </Select>
        {!inherited(key) && <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: '8px 0' }}><TagInput label={label} tone={tone} tags={draft[key] ?? []} placeholder="Введите слово и нажмите Enter" onChange={(v) => change(key, v)} /></fieldset>}
      </Field>;
    })}
    {([['experience', 'Опыт', EXP], ['allowed_work_formats', 'Формат работы', FMT]] as const).map(([key, label, options]) => <Field key={key} label={label} hint={inherited(key) ? 'Опыт — из поисковых ссылок; формат — из общих настроек и ссылок.' : 'Ничего не выбрано — ограничение отключено.'}>
      <Select aria-label={`${label}: источник`} disabled={busy} value={inherited(key) ? 'inherit' : 'own'} onChange={(e) => override(key, e.target.value === 'own')}><option value="inherit">Наследовать</option><option value="own">Задать для резюме</option></Select>
      {!inherited(key) && <fieldset disabled={busy} style={{ border: 0, padding: '8px 0', margin: 0 }}><ChipSet options={[...options]} value={draft[key] ?? []} onChange={(v) => change(key, v)} /></fieldset>}
    </Field>)}
    {dirty && JSON.stringify(base) !== sig && <p role="status">Настройки изменились в другом окне. Сохранение затронет только изменённые здесь поля.</p>}
    <Actions status={msg || (dirty ? 'Есть несохранённые изменения' : 'Изменений нет')} tone={msg.startsWith('Ошибка') ? 'bad' : undefined}>
      <button className={s.btn} disabled={busy || !dirty || !connected} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить правила резюме'}</button>
      <button className={s.btn} disabled={busy || !dirty} onClick={() => { reset(); setMsg(''); }}>Отменить изменения</button>
    </Actions>
  </div>;
}
