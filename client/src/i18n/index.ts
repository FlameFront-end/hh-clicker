import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';
export type I18nKey = keyof typeof ru;

const dict = { ru, en } as const;

export function translate(lang: Lang, key: I18nKey | (string & {})): string {
  const d = dict[lang] as Record<string, string>;
  return d[key] ?? (dict.ru as Record<string, string>)[key] ?? key;
}

export function readStoredLang(): Lang {
  const v = localStorage.getItem('hh-lang');
  return v === 'en' || v === 'ru' ? v : 'ru';
}
