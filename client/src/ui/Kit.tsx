import type { ReactNode } from 'react';
import { Icon, stripEmoji } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { hueOf, initialsOf } from '@/lib/hue';
import { shortAcc } from '@/lib/safe';
import { useAliasOf, useApp } from '@/store/app';
import k from './Kit.module.css';

export function PageHead({ title, count, sub, children }: { title: string; count?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className={k.head}>
      <div>
        <h2 className={k.title}>{title}{count != null && <span className={k.count}>{count}</span>}</h2>
        {sub && <p className={k.sub}>{sub}</p>}
      </div>
      <div className={k.actions}>{children}</div>
    </header>
  );
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className={k.search}>
      <Icon name="search" size={14} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && <button type="button" className={k.clear} onClick={() => onChange('')} aria-label="Очистить"><Icon name="x" size={13} /></button>}
    </label>
  );
}

export interface SegOption<T extends string> { id: T; label: string; count?: number; tone?: 'ok' | 'bad' | 'warn' | 'accent' }
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: SegOption<T>[] }) {
  return (
    <div className={k.seg} role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={`${k.segBtn} ${value === o.id ? k.segOn : ''}`} onClick={() => onChange(o.id)}>
          {o.tone && <i className={`${k.dot} ${k['t_' + o.tone]}`} />}{o.label}
          {o.count != null && <span className={k.segCount}>{o.count.toLocaleString('ru')}</span>}
        </button>
      ))}
    </div>
  );
}

export function CheckPill({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={`${k.checkPill} ${checked ? k.checkOn : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  );
}

export function Stats({ items }: { items: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' | 'accent'; hint?: string }[] }) {
  return (
    <div className={k.stats}>
      {items.map((i) => (
        <div key={i.label} className={k.stat} title={i.hint}>
          <b className={`tnum ${i.tone ? k['t_' + i.tone] : ''}`}>{i.value}</b>
          <span>{i.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className={k.empty}>
      <span className={k.emptyIco}><Icon name={icon} size={20} /></span>
      <b>{title}</b>
      {hint && <p>{hint}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return <div className={k.skel}>{Array.from({ length: rows }, (_, i) => <div key={i} className={k.skelRow} style={{ opacity: 1 - i * 0.12 }} />)}</div>;
}

/** Короткое имя аккаунта; если от него остались одни эмодзи — берём полное имя без эмодзи. */
export function accLabel(name: string): string {
  const short = stripEmoji(shortAcc(name)).trim();
  if (short) return short;
  return stripEmoji(name).replace(/\(.*?\)/g, '').trim() || name;
}

export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const n = accLabel(name);
  // цвет считаем от оригинального имени, чтобы переименование его не меняло
  const orig = useApp((s) => s.rawSnapshot?.accounts?.find((a) => (s.aliases[a.name] ?? a.name) === name)?.name) ?? name;
  return <span className={k.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ['--acc' as string]: hueOf(accLabel(orig)) }}>{initialsOf(n)}</span>;
}

export function AccChip({ name }: { name: string }) {
  const alias = useAliasOf();
  if (!name) return <span className={k.mute}>—</span>;
  const shown = alias(name);
  return <span className={k.accChip}><Avatar name={shown} size={18} />{accLabel(shown)}</span>;
}

export function Pill({ tone = 'dim', icon, children }: { tone?: 'ok' | 'bad' | 'warn' | 'accent' | 'dim'; icon?: IconName; children: ReactNode }) {
  return <span className={`${k.pill} ${k['p_' + tone]}`}>{icon && <Icon name={icon} size={12} />}{children}</span>;
}

/** Вакансия: название ссылкой + компания второй строкой. */
export function JobCell({ title, company, href, fallback }: { title?: string; company?: string; href: string; fallback: string }) {
  return (
    <div className={k.job}>
      <a href={href} target="_blank" rel="noopener noreferrer" className={title ? k.jobTitle : `${k.jobTitle} ${k.mute}`}>
        {title || fallback}<Icon name="arrow-up-right" size={12} />
      </a>
      {company && <span className={k.jobCo}>{company}</span>}
    </div>
  );
}
