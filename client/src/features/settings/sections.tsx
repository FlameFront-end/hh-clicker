import type { ComponentType } from 'react';
import type { IconName } from '@/components/icons';
import { BotParams } from './BotParams';
import { JobStatus, ResumeAnalysis, Skills } from './Career';
import { MobileAuth } from './MobileAuth';
import { AddSession, Cookies, WsRealtime } from './Connection';
import { Filters } from './Filters';
import { Diagnostics, JsonBackup } from './JsonBackup';
import { LlmSettings } from './LlmSettings';
import { Proxy } from './Proxy';
import { Letters, Questionnaire } from './Templates';
import { UrlPool } from './UrlPool';

export interface PanelDef { id: string; title: string; keywords: string; Component: ComponentType }
export interface SectionDef { id: string; label: string; title: string; desc: string; icon: IconName; panels: PanelDef[] }

export const SECTIONS: SectionDef[] = [
  {
    id: 'search', label: 'Поиск и фильтры', icon: 'search',
    title: 'Какие вакансии искать',
    desc: 'Ссылки поиска на hh.ru и правила, по которым бот пропускает ненужные вакансии.',
    panels: [
      { id: 'urls', title: 'Ссылки поиска', keywords: 'url ссылки пул запросы поиск hh.ru страницы глубина', Component: UrlPool },
      { id: 'filters', title: 'Фильтры и автоматизация', keywords: 'фильтры зарплата рейтинг слова название исключить график опыт агентства свежие тесты', Component: Filters },
    ],
  },
  {
    id: 'limits', label: 'Скорость и лимиты', icon: 'timer',
    title: 'Как быстро откликаться',
    desc: 'Паузы между откликами, размер пачки, дневные лимиты и прокси.',
    panels: [
      { id: 'params', title: 'Параметры бота', keywords: 'скорость задержка пауза цикл пачка лимит интервал зарплата рейтинг ошибки авто-пауза страниц', Component: BotParams },
      { id: 'proxy', title: 'Прокси', keywords: 'прокси proxy сеть socks http', Component: Proxy },
    ],
  },
  {
    id: 'letters', label: 'Письма и ответы', icon: 'mail',
    title: 'Что отправлять работодателям',
    desc: 'Сопроводительные письма и готовые ответы на вопросы работодателей.',
    panels: [
      { id: 'letters', title: 'Шаблоны писем', keywords: 'письмо сопроводительное шаблон текст', Component: Letters },
      { id: 'questionnaire', title: 'Ответы на опросы', keywords: 'опрос анкета вопросы ответы тест шаблонные', Component: Questionnaire },
    ],
  },
  {
    id: 'ai', label: 'ИИ-ответы', icon: 'bot',
    title: 'ИИ-ответы работодателям',
    desc: 'Модель, ключ и поведение ИИ, который отвечает в чатах и заполняет опросы.',
    panels: [{ id: 'llm', title: 'ИИ и LLM', keywords: 'llm ии ai модель api ключ openai deepseek промпт автоотправка чат ответы', Component: LlmSettings }],
  },
  {
    id: 'access', label: 'Аккаунты и доступ', icon: 'plug',
    title: 'Подключение аккаунтов HH',
    desc: 'Как бот входит в ваши аккаунты: браузерные сессии, куки, вход по коду.',
    panels: [
      { id: 'phone', title: 'Вход по телефону или email', keywords: 'авторизация телефон email код otp мобильное вход', Component: MobileAuth },
      { id: 'session', title: 'Браузерные сессии', keywords: 'сессия браузер добавить аккаунт curl cookies куки', Component: AddSession },
      { id: 'cookies', title: 'Обновить куки', keywords: 'куки cookies обновить устарела сессия hhtoken', Component: Cookies },
      { id: 'ws', title: 'Живое обновление', keywords: 'websocket realtime живое обновление соединение', Component: WsRealtime },
    ],
  },
  {
    id: 'profile', label: 'Профиль на HH', icon: 'briefcase',
    title: 'Ваш профиль на hh.ru',
    desc: 'Статус поиска работы, навыки и анализ резюме.',
    panels: [
      { id: 'status', title: 'Статус поиска работы', keywords: 'статус поиск работы активно ищу рассматриваю предложения', Component: JobStatus },
      { id: 'skills', title: 'Навыки', keywords: 'навыки skills верификации подтверждение', Component: Skills },
      { id: 'analysis', title: 'Анализ резюме', keywords: 'анализ резюме советы улучшить аудит', Component: ResumeAnalysis },
    ],
  },
  {
    id: 'data', label: 'Данные и диагностика', icon: 'database',
    title: 'Данные и диагностика',
    desc: 'Резервная копия настроек и сводка для отчёта об ошибке.',
    panels: [
      { id: 'backup', title: 'Резервная копия', keywords: 'json бэкап резервная копия экспорт импорт загрузить выгрузить конфиг', Component: JsonBackup },
      { id: 'diag', title: 'Диагностика', keywords: 'диагностика отчёт ошибка версия логи', Component: Diagnostics },
    ],
  },
];
