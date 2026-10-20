import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';

export type Json = Record<string, any>; // данные HH приходят произвольной формы

export function useLoader<T = Json>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const d = await fn();
      const e = (d as Json | null)?.error;
      if (e) setErr(String(e)); else setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return { busy, data, err, run };
}

export function Section({ icon, title, tone, actions, status, children }: { icon: IconName; title: string; tone?: string; actions?: ReactNode; status?: ReactNode; children?: ReactNode }) {
  return (
    <section className={v.sec}>
      <div className={v.secHead}>
        <h3 className={v.secTitle}><Icon name={icon} size={15} className={tone} />{title}</h3>
        {actions}
        {status && <span className={v.status}>{status}</span>}
      </div>
      {children}
    </section>
  );
}

export function Item({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className={v.item}>
      <div className={v.itemT}>{title}{right}</div>
      {sub && <div className={v.itemS}>{sub}</div>}
    </div>
  );
}

export const Err = ({ text }: { text: string | null }) => (text ? <span className={s.bad}>{text}</span> : null);
