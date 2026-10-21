import { useCallback } from 'react';
import { create } from 'zustand';
import { SocketClient } from '@/lib/ws';
import { readStoredLang, translate, type I18nKey, type Lang } from '@/i18n';
import type { Snapshot, WsCommand } from '@/types/snapshot';

const ALIAS_KEY = 'hh-aliases';
const readAliases = (): Record<string, string> => {
  try { const v = JSON.parse(localStorage.getItem(ALIAS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};

/** Подменяет имена аккаунтов на пользовательские (ключ — оригинальное имя с HH). */
function withAliases(snap: Snapshot | null, aliases: Record<string, string>): Snapshot | null {
  if (!snap || !Array.isArray(snap.accounts) || !Object.keys(aliases).length) return snap;
  return { ...snap, accounts: snap.accounts.map((a) => { const al = aliases[a.hh_name ?? a.name]; return al ? { ...a, hh_name: a.hh_name ?? a.name, hh_short: a.hh_short ?? a.short, name: al, short: al } : a; }) };
}

interface AppState {
  snapshot: Snapshot | null;
  rawSnapshot: Snapshot | null;
  /** Свои названия аккаунтов: оригинальное имя → имя пользователя. */
  aliases: Record<string, string>;
  setAlias(hhName: string, alias: string): void;
  connected: boolean;
  unauthorized: boolean;
  lang: Lang;
  /** Развёрнутые карточки аккаунтов (по умолчанию все свёрнуты). */
  expanded: Set<number>;
  toggleLang(): void;
  toggleExpanded(idx: number): void;
  sendCmd(cmd: WsCommand): boolean;
  t(key: I18nKey | (string & {})): string;
}

let socket: SocketClient | null = null;

export const useApp = create<AppState>((set, get) => ({
  snapshot: null,
  rawSnapshot: null,
  aliases: readAliases(),
  setAlias: (hhName, alias) => {
    const aliases = { ...get().aliases };
    const v = alias.trim();
    if (v) aliases[hhName] = v; else delete aliases[hhName];
    try { localStorage.setItem(ALIAS_KEY, JSON.stringify(aliases)); } catch { /* ignore */ }
    set({ aliases, snapshot: withAliases(get().rawSnapshot, aliases) });
  },
  connected: false,
  unauthorized: false,
  lang: readStoredLang(),
  expanded: new Set(),

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
    onSnapshot: (raw) => useApp.setState({ rawSnapshot: raw, snapshot: withAliases(raw, useApp.getState().aliases) }),
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

/** Имя, которое видит пользователь, для «сырого» имени/short из данных бэкенда. */
export function resolveAlias(raw: string, aliases: Record<string, string>, snap: Snapshot | null): string {
  if (!raw) return raw;
  if (aliases[raw]) return aliases[raw];
  const a = snap?.accounts?.find((x) => x.name === raw || x.short === raw);
  return (a && aliases[a.name]) || raw;
}

/** Хук: перерисовывается при переименовании аккаунта. */
export function useAliasOf(): (raw: string) => string {
  const aliases = useApp((s) => s.aliases);
  const raw = useApp((s) => s.rawSnapshot);
  return useCallback((n: string) => resolveAlias(n, aliases, raw), [aliases, raw]);
}
