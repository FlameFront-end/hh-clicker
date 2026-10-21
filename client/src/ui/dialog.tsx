import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import s from './Ui.module.css';
import d from './dialog.module.css';

type Req =
  | { kind: 'confirm'; message: string; danger?: boolean; ok?: string; resolve: (v: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (v: string | null) => void };

const useDialogs = create<{ queue: Req[]; push(r: Req): void; shift(): void }>((set) => ({
  queue: [],
  push: (r) => set((x) => ({ queue: [...x.queue, r] })),
  shift: () => set((x) => ({ queue: x.queue.slice(1) })),
}));

/** Тёмные замены window.confirm / alert / prompt. Возвращают промис. */
export const confirmDialog = (message: string, opts: { danger?: boolean; ok?: string } = {}) =>
  new Promise<boolean>((resolve) => useDialogs.getState().push({ kind: 'confirm', message, resolve, ...opts }));
export const alertDialog = (message: string) =>
  new Promise<void>((resolve) => useDialogs.getState().push({ kind: 'alert', message, resolve }));
export const promptDialog = (message: string, value = '') =>
  new Promise<string | null>((resolve) => useDialogs.getState().push({ kind: 'prompt', message, value, resolve }));

export function DialogHost() {
  const req = useDialogs((x) => x.queue[0]);
  const shift = useDialogs((x) => x.shift);
  const [text, setText] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (req?.kind === 'prompt') setText(req.value); }, [req]);
  useEffect(() => { if (req && req.kind !== 'prompt') okRef.current?.focus(); }, [req]);
  if (!req) return null;

  const done = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else if (req.kind === 'prompt') req.resolve(ok ? text : null);
    else req.resolve();
    shift();
  };
  return (
    <div className={d.back} onMouseDown={(e) => e.target === e.currentTarget && done(false)}
      onKeyDown={(e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && req.kind === 'prompt') done(true); }}>
      <div className={d.box} role="dialog" aria-modal="true">
        <div className={d.msg}>{req.message}</div>
        {req.kind === 'prompt' && <input className={s.input} autoFocus value={text} onChange={(e) => setText(e.target.value)} />}
        <div className={d.actions}>
          {req.kind !== 'alert' && <button className={s.btn} onClick={() => done(false)}>Отмена</button>}
          <button ref={okRef} className={`${s.btn} ${req.kind === 'confirm' && req.danger ? d.danger : ''}`} onClick={() => done(true)}>
            {req.kind === 'confirm' && req.ok ? req.ok : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
