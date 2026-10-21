import { stripEmoji } from '@/components/Icon';
import { Select } from '@/ui/radix';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { post } from '@/lib/api';
import { useApp, useT } from '@/store/app';
import { PageHead } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';
import styles from './ApplyTab.module.css';

interface Opt { value: string; label: string }
interface Q { field: string; text: string; type: 'radio' | 'checkbox' | 'select' | 'textarea'; options?: Opt[]; suggested?: string | string[] }
interface Res { status?: string; message?: string; vacancy_id?: string; questions?: Q[] }
type Answer = string | string[];

export function ApplyTab() {
  const t = useT();
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [acc, setAcc] = useState<number | null>(null);
  const [vac, setVac] = useState('');
  const [letter, setLetter] = useState('');
  const [letterTouched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'warn' | 'err' | 'info' } | null>(null);
  const [vid, setVid] = useState('');
  const [qs, setQs] = useState<Q[] | null>(null);
  const [ans, setAns] = useState<Record<string, Answer>>({});

  const cur = acc ?? accounts[0]?.idx ?? null;
  const curLetter = accounts.find((a) => a.idx === cur)?.letter ?? '';
  useEffect(() => { if (!letterTouched) setLetter(curLetter); }, [curLetter, letterTouched]);

  const show = (r: Res, fallbackOk = 'ok' as const) => {
    const m = r.message || '';
    if (r.status === 'sent') setMsg({ text: m, kind: fallbackOk });
    else if (r.status === 'already') setMsg({ text: m, kind: 'warn' });
    else setMsg({ text: m || 'Неизвестная ошибка', kind: 'err' });
  };

  const check = async () => {
    if (busy) return;
    if (cur === null) return setMsg({ text: 'Сначала добавьте аккаунт', kind: 'err' });
    const raw = vac.trim();
    if (!raw) return setMsg({ text: 'Введите ссылку или ID вакансии', kind: 'err' });
    setBusy(true); setQs(null); setMsg({ text: 'Проверяю вакансию…', kind: 'info' });
    try {
      const r = await post<Res>('/api/apply/check', { account_idx: cur, vacancy_id: raw, letter });
      setVid(r.vacancy_id || raw);
      if (r.status === 'test_required') {
        const list = r.questions ?? [];
        setQs(list);
        const init: Record<string, Answer> = {};
        for (const q of list) init[q.field] = q.type === 'checkbox' ? (Array.isArray(q.suggested) ? q.suggested : q.suggested ? [q.suggested] : []) : (q.suggested as string) ?? '';
        setAns(init);
        setMsg({ text: `${r.message ?? ''}\nПроверьте ответы ниже и нажмите «Откликнуться»`, kind: 'info' });
      } else show(r);
    } catch (e) {
      setMsg({ text: 'Ошибка запроса: ' + (e instanceof Error ? e.message : e), kind: 'err' });
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (busy || cur === null) return;
    setBusy(true); setMsg({ text: 'Отправляю…', kind: 'info' });
    try {
      const r = await post<Res>('/api/apply/submit', { account_idx: cur, vacancy_id: vid, letter, answers: ans });
      show(r);
      if (r.status === 'sent') setQs(null);
    } catch (e) {
      setMsg({ text: 'Ошибка: ' + (e instanceof Error ? e.message : e), kind: 'err' });
    } finally { setBusy(false); }
  };

  const toggleCheck = (f: string, v: string) =>
    setAns((a) => { const c = (a[f] as string[]) ?? []; return { ...a, [f]: c.includes(v) ? c.filter((x) => x !== v) : [...c, v] }; });

  const resIcon = { ok: 'check', warn: 'triangle-alert', err: 'x', info: 'circle-help' } as const;
  return (
    <div className={styles.wrap}>
      <PageHead title={t('apply_title')} sub={t('apply_desc')} />

      <section className={styles.card}>
        <h3 className={styles.step}><i>1</i>Куда откликаемся</h3>
        <label className={styles.row}><span>{t('apply_label_acc')}</span>
          <Select value={cur ?? ''} onChange={(e) => { setAcc(Number(e.target.value)); setTouched(false); }} style={{ width: '100%' }}>
            {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}
          </Select>
        </label>
        <label className={styles.row}><span>{t('apply_label_vacancy')}</span>
          <input className={s.input} style={{ height: 36 }} value={vac} onChange={(e) => setVac(e.target.value)} placeholder={t('apply_vacancy_ph')} onKeyDown={(e) => e.key === 'Enter' && void check()} />
        </label>
      </section>

      <section className={styles.card}>
        <h3 className={styles.step}><i>2</i>Сопроводительное письмо</h3>
        <div className={styles.row}><span>{t('apply_label_tpl')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select style={{ flex: 1 }} value="" onChange={(e) => { const a = accounts.find((x) => String(x.idx) === e.target.value); if (a) { setLetter(a.letter ?? ''); setTouched(true); } }}>
              <option value="">{t('apply_tpl_ph')}</option>
              {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}
            </Select>
            <button className={s.btn} style={{ height: 30 }} onClick={() => { setLetter(''); setTouched(true); }}><Icon name="x" size={12} />{t('apply_btn_clear')}</button>
          </div>
        </div>
        <label className={styles.row}><span>{t('apply_label_letter')}</span>
          <textarea className={styles.ta} rows={5} value={letter} onChange={(e) => { setLetter(e.target.value); setTouched(true); }} placeholder={t('apply_letter_ph')} />
        </label>
      </section>

      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy} onClick={() => void check()}><Icon name="search" size={14} />{t('apply_btn_check')}</button>
      </div>

      {msg && <div className={`${styles.result} ${styles[msg.kind]}`}><Icon name={resIcon[msg.kind]} size={14} /><span>{msg.text}</span></div>}

      {qs && (
        <section className={styles.card}>
          <h3 className={styles.step}><i>3</i>Опросник работодателя <small>{qs.length} {qs.length === 1 ? 'вопрос' : 'вопросов'}</small></h3>
          {qs.map((q, i) => (
            <div key={q.field} className={styles.q}>
              <div className={styles.qn}>Вопрос {i + 1} из {qs.length}</div>
              <div className={styles.qt}>{q.text}</div>
              {q.type === 'radio' && q.options?.map((o) => (
                <label key={o.value} className={styles.opt}><input type="radio" name={`aq_${q.field}`} checked={ans[q.field] === o.value} onChange={() => setAns((a) => ({ ...a, [q.field]: o.value }))} />{o.label}</label>
              ))}
              {q.type === 'checkbox' && q.options?.map((o) => (
                <label key={o.value} className={styles.opt}><input type="checkbox" checked={((ans[q.field] as string[]) ?? []).includes(o.value)} onChange={() => toggleCheck(q.field, o.value)} />{o.label}</label>
              ))}
              {q.type === 'select' && (
                <Select value={(ans[q.field] as string) ?? ''} onChange={(e) => setAns((a) => ({ ...a, [q.field]: e.target.value }))}>
                  {q.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              )}
              {q.type === 'textarea' && <textarea className={styles.ta} rows={3} value={(ans[q.field] as string) ?? ''} onChange={(e) => setAns((a) => ({ ...a, [q.field]: e.target.value }))} />}
            </div>
          ))}
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy} onClick={() => void submit()}><Icon name="rocket" size={14} />Откликнуться</button>
            <button className={s.btn} style={{ height: 36 }} onClick={() => { setQs(null); setMsg(null); }}>Отмена</button>
          </div>
        </section>
      )}
    </div>
  );
}
