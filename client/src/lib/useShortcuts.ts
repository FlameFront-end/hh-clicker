import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/app';
import { ROUTES } from '@/routes';

/** Клавиши 1–9 и 0 — вкладки по порядку, P — пауза, ? — справка (см. ShortcutsHelp). */
const KEY_TO_PATH: Record<string, string> = {
  '1': '', '2': 'log', '3': 'applied', '4': 'tests', '5': 'db', '6': 'hh', '7': 'views', '8': 'apply', '9': 'settings', '0': 'hedi',
};

export function useShortcuts(toggleHelp: () => void, closeHelp: () => void) {
  const navigate = useNavigate();
  const sendCmd = useApp((s) => s.sendCmd);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Не менять вкладку и не запускать бота клавишей P из модального окна.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        if (e.key === 'Escape') closeHelp();
        return;
      }
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const path = KEY_TO_PATH[e.key];
      if (path !== undefined && ROUTES.some((r) => r.path === path)) { navigate(`/${path}`); return; }
      if (e.key === 'p' || e.key === 'P') sendCmd({ type: 'pause_toggle' });
      else if (e.key === '?' || e.key === '/') toggleHelp();
      else if (e.key === 'Escape') closeHelp();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate, sendCmd, toggleHelp, closeHelp]);
}
