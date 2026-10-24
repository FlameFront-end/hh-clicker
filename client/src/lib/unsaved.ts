import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

const pending = new Set<symbol>();
export function confirmDiscardChanges(): boolean {
  return pending.size === 0 || window.confirm('Есть несохранённые изменения. Выйти без сохранения?');
}

/** Single blocker covers links, programmatic navigation and browser Back. */
export function UnsavedGuard() {
  const blocker = useBlocker(() => pending.size > 0);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (confirmDiscardChanges()) blocker.proceed(); else blocker.reset();
  }, [blocker]);
  return null;
}

/** Guard local drafts; never auto-submit a form on navigation. */
export function useUnsavedChanges(dirty: boolean) {
  const id = useRef(Symbol('draft'));
  useEffect(() => {
    if (!dirty) return;
    const token = id.current;
    pending.add(token);
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => {
      pending.delete(token);
      window.removeEventListener('beforeunload', unload);
    };
  }, [dirty]);
}
