import { create } from 'zustand';
import { SocketClient } from '@/lib/ws';
import { readStoredLang, translate, type I18nKey, type Lang } from '@/i18n';
import type { Snapshot, WsCommand } from '@/types/snapshot';

export type TabId =
  | 'main' | 'log' | 'applied' | 'tests' | 'db' | 'hh' | 'views'
  | 'apply' | 'llm' | 'hedi' | 'recoh' | 'settings';

interface AppState {
  snapshot: Snapshot | null;
  connected: boolean;
  unauthorized: boolean;
  lang: Lang;
  tab: TabId;
  /** Развёрнутые карточки аккаунтов (по умолчанию все свёрнуты). */
  expanded: Set<number>;
  setTab(tab: TabId): void;
  toggleLang(): void;
  toggleExpanded(idx: number): void;
  sendCmd(cmd: WsCommand): boolean;
  t(key: I18nKey | (string & {})): string;
}

let socket: SocketClient | null = null;

export const useApp = create<AppState>((set, get) => ({
  snapshot: null,
  connected: false,
  unauthorized: false,
  lang: readStoredLang(),
  tab: 'main',
  expanded: new Set(),

  setTab: (tab) => set({ tab }),
  toggleLang: () => {
    const lang: Lang = get().lang === 'ru' ? 'en' : 'ru';
    localStorage.setItem('hh-lang', lang);
    document.documentElement.lang = lang;
    set({ lang });
  },
  toggleExpanded: (idx) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (!next.delete(idx)) next.add(idx);
      return { expanded: next };
    }),
  sendCmd: (cmd) => socket?.send(cmd) ?? false,
  t: (key) => translate(get().lang, key),
}));

/** Подписка на WS живёт вне React — один сокет на всё приложение. */
export function startSocket(): () => void {
  if (socket) return () => undefined;
  socket = new SocketClient({
    onOpen: () => useApp.setState({ connected: true, unauthorized: false }),
    onClose: ({ unauthorized }) => useApp.setState({ connected: false, unauthorized: unauthorized || useApp.getState().unauthorized }),
    onSnapshot: (snapshot) => useApp.setState({ snapshot }),
  });
  socket.start();
  return () => {
    socket?.stop();
    socket = null;
  };
}

/** Хук перевода: перерисовывается при смене языка. */
export function useT(): (key: I18nKey | (string & {})) => string {
  const lang = useApp((s) => s.lang);
  return (key) => translate(lang, key);
}
