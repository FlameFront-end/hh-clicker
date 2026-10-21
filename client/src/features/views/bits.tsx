import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';

export type Json = Record<string, any>; // данные HH приходят произвольной формы

/** auto — ключ автозагрузки: при смене запускает загрузку сам. */
export function useLoader<T = Json>(fn: () => Promise<T>, auto?: string) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (auto) { setData(null); void run(); } }, [auto]);
  return { busy, data, err, run };
}

export function Section({ icon, title, desc, tone, actions, status, children }: { icon: IconName; title: string; desc?: string; tone?: string; actions?: ReactNode; status?: ReactNode; children?: ReactNode }) {
  return (
    <section className={v.sec}>
      <div className={v.secHead}>
        <span className={v.secIco}><Icon name={icon} size={16} className={tone} /></span>
        <div className={v.secTtl}>
          <h3 className={v.secTitle}>{title}</h3>
          {(desc || status) && <div className={v.secDesc}>{status ? <span className={v.status}>{status}</span> : desc}</div>}
        </div>
        <div className={v.secActs}>{actions}</div>
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

const AUTH = /^(auth_error|HTTP (401|403|406))$/;

/** Ошибка загрузки; для проблем с веб-сессией подсказывает, что делать. */
export const Err = ({ text }: { text: string | null }) => {
  if (!text) return null;
  if (AUTH.test(text.trim())) {
    return <span className={s.warn}>Веб-сессия аккаунта устарела ({text}). <Link to="/settings/access">Обновить куки</Link></span>;
  }
  return <span className={s.bad}>{text}</span>;
};
