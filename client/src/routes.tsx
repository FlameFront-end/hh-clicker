import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { IconName } from '@/components/icons';

const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): LazyExoticComponent<ComponentType> =>
  lazy(() => load().then((m) => ({ default: m[name] })));

export interface AppRoute {
  /** Путь без ведущего слеша; '' — главная. */
  path: string;
  /** i18n-ключ подписи; если пусто — берётся label. */
  key: string;
  label?: string;
  icon: IconName;
  Component: LazyExoticComponent<ComponentType>;
  /** Страница сама разбирает вложенные пути (path/*). */
  nested?: boolean;
}

export const ROUTES: AppRoute[] = [
  { path: '', key: 'tab_main', icon: 'layout-dashboard', Component: page(() => import('@/features/main/MainTab'), 'MainTab') },
  { path: 'log', key: 'tab_log', icon: 'scroll-text', Component: page(() => import('@/features/log/LogTab'), 'LogTab') },
  { path: 'applied', key: 'tab_applied', icon: 'check', Component: page(() => import('@/features/data/AppliedTab'), 'AppliedTab') },
  { path: 'tests', key: 'tab_tests', icon: 'flask-conical', Component: page(() => import('@/features/data/TestsTab'), 'TestsTab') },
  { path: 'db', key: 'tab_db', icon: 'database', Component: page(() => import('@/features/data/DbTab'), 'DbTab') },
  { path: 'hh', key: 'tab_hh', icon: 'target', Component: page(() => import('@/features/hh/HhTab'), 'HhTab') },
  { path: 'views', key: 'tab_views', icon: 'eye', Component: page(() => import('@/features/views/ViewsTab'), 'ViewsTab') },
  { path: 'apply', key: 'tab_apply', icon: 'rocket', Component: page(() => import('@/features/apply/ApplyTab'), 'ApplyTab') },
  { path: 'llm', key: 'tab_llm', icon: 'bot', Component: page(() => import('@/features/llm/LlmTab'), 'LlmTab') },
  { path: 'hedi', key: '', label: 'HH Хэдди', icon: 'sparkles', Component: page(() => import('@/features/hedi/HediTab'), 'HediTab') },
  { path: 'recommendations', key: '', label: 'Рекомендации', icon: 'lightbulb', Component: page(() => import('@/features/reco/RecoTab'), 'RecoTab') },
  { path: 'settings', nested: true, key: 'tab_settings', icon: 'settings', Component: page(() => import('@/features/settings/SettingsTab'), 'SettingsTab') },
];
