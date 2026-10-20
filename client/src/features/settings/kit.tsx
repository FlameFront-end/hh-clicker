import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';

export const Group = ({ children }: { children: ReactNode }) => <div className={m.group}>{children}</div>;

export function Sect({ icon, title, open, children }: { icon: IconName; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className={m.sect} open={open}>
      <summary><Icon name={icon} size={15} className={s.dim} />{title}<Icon name="chevron-down" size={15} className="chev" /></summary>
      <div className={m.body}>{children}</div>
    </details>
  );
}

export const Sub = ({ children }: { children: ReactNode }) => <h4 className={m.sub}>{children}</h4>;
export const Hint = ({ children }: { children: ReactNode }) => <div className={m.hint}>{children}</div>;
export const Hr = () => <div className={m.hr} />;

export function CfgCheck({ k, children, hint, invert }: { k: string; children: ReactNode; hint?: ReactNode; invert?: boolean }) {
  const v = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  const checked = invert ? v === false : !!v;
  return (
    <div>
      <label className={s.checkLbl} style={{ color: 'var(--text)' }}>
        <input type="checkbox" checked={checked} onChange={(e) => send({ type: 'set_config', key: k, value: invert ? !e.target.checked : e.target.checked })} />{children}
      </label>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/** Числовое поле: показывает значение конфига, пока не в фокусе; шлёт при change. */
export function CfgNumber({ k, min, max, fallback = 0, width = 70, map }: { k: string; min?: number; max?: number; fallback?: number; width?: number; map?: (n: number) => number }) {
  const cfgV = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(cfgV ?? fallback);
  return (
    <input className={s.input} type="number" min={min} max={max} style={{ width, minWidth: 0 }} value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const n = parseInt(draft, 10);
        send({ type: 'set_config', key: k, value: map ? map(Number.isFinite(n) ? n : fallback) : Number.isFinite(n) ? n : 0 });
        setDraft(null);
      }} />
  );
}

export function CfgSelect({ k, options, number }: { k: string; options: [string, string][]; number?: boolean }) {
  const v = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  return (
    <select className={s.select} value={String(v ?? '')} onChange={(e) => send({ type: 'set_config', key: k, value: number ? parseInt(e.target.value, 10) : e.target.value })}>
      {options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
    </select>
  );
}

export function TagInput({ tags, onChange, tone, placeholder }: { tags: string[]; onChange: (t: string[]) => void; tone: 'ok' | 'bad'; placeholder: string }) {
  const [v, setV] = useState('');
  const commit = (raw: string) => {
    const add = raw.split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean).filter((x) => !tags.includes(x));
    if (add.length) onChange([...tags, ...add]);
    setV('');
  };
  return (
    <div>
      <div className={m.tags}>
        {tags.map((t) => <span key={t} className={`${m.tag} ${tone === 'ok' ? m.tagOk : m.tagBad}`}>{t}<button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label="Убрать"><Icon name="x" size={11} /></button></span>)}
      </div>
      <input className={s.input} style={{ width: '100%' }} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && commit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(v); } }} />
    </div>
  );
}

/** Статус «сохранено» на несколько секунд. */
export function useFlash(ms = 3000) {
  const [t, setT] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [t, (msg: string) => { setT(msg); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(''), ms); }] as const;
}
