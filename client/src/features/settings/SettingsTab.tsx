import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useApp } from '@/store/app';
import { Search } from '@/ui/Kit';
import { SECTIONS, type SectionDef } from './sections';
import m from './Settings.module.css';

type Tone = 'ok' | 'warn' | 'bad' | 'dim';

/** Живая сводка по разделу: показывает состояние настроек, не заходя внутрь. */
function useSummaries(): Record<string, { text: string; tone: Tone }> {
  const snap = useApp((x) => x.snapshot);
  const cfg = snap?.config;
  const accs = snap?.accounts ?? [];
  const expired = accs.filter((a) => a.cookies_expired).length;
  const pool = cfg?.url_pool?.length ?? 0;
  const hasKey = cfg?.llm_api_key_set || (cfg?.llm_profiles ?? []).some((p) => (p as { key_set?: boolean }).key_set) || cfg?.llm_status_summary?.configured_provider === 'openclaw';
  const letters = cfg?.letter_templates?.length ?? 0;
  return {
    search: pool ? { text: `${pool} ${pool === 1 ? 'ссылка' : 'ссылок'} в пуле поиска`, tone: 'ok' } : { text: 'Добавьте хотя бы одну ссылку поиска', tone: 'warn' },
    limits: { text: cfg?.pause_between_cycles != null ? `Пауза ${cfg.pause_between_cycles} с · пачка ${cfg.batch_responses ?? 1} · лимит HH ${cfg.hh_daily_limit ?? 200}/день` : 'Скорость и лимиты по умолчанию', tone: 'dim' },
    letters: letters ? { text: `${letters} ${letters === 1 ? 'шаблон' : 'шаблонов'} письма`, tone: 'ok' } : { text: 'Шаблонов писем пока нет', tone: 'warn' },
    ai: !hasKey ? { text: 'Нет API-ключа — ИИ не работает', tone: 'bad' } : cfg?.llm_enabled ? { text: cfg.llm_auto_send ? 'Включён, отвечает автоматически' : 'Включён, только черновики', tone: 'ok' } : { text: 'Выключен', tone: 'dim' },
    access: expired ? { text: `${expired} из ${accs.length} аккаунтов: сессия устарела`, tone: 'bad' } : { text: accs.length ? `Все аккаунты подключены (${accs.length})` : 'Аккаунтов нет', tone: accs.length ? 'ok' : 'warn' },
    profile: { text: 'Статус поиска, навыки, анализ резюме', tone: 'dim' },
    data: { text: 'Бэкап настроек и отчёт для поддержки', tone: 'dim' },
  };
}

function Overview() {
  const sums = useSummaries();
  return (
    <>
      <header className={m.pageHead}><h2>Настройки</h2><p>Всё, что влияет на работу бота, собрано по темам. Выберите раздел — или найдите нужную настройку поиском.</p></header>
      <div className={m.cards}>
        {SECTIONS.map((s) => (
          <NavLink key={s.id} to={`/settings/${s.id}`} className={m.card}>
            <span className={m.cardIco}><Icon name={s.icon} size={18} /></span>
            <span className={m.cardTtl}>{s.label}</span>
            <span className={m.cardDesc}>{s.desc}</span>
            <span className={`${m.cardSum} ${m['s_' + sums[s.id]!.tone]}`}><i />{sums[s.id]!.text}</span>
          </NavLink>
        ))}
      </div>
    </>
  );
}

function SectionView({ section }: { section: SectionDef }) {
  const loc = useLocation();
  const target = (loc.state as { panel?: string } | null)?.panel;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!target) { window.scrollTo({ top: 0 }); return; }
    const el = ref.current?.querySelector<HTMLElement>(`[data-panel="${target}"]`);
    if (!el) return;
    el.querySelector('details')?.setAttribute('open', '');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add(m.flash!);
    const t = setTimeout(() => el.classList.remove(m.flash!), 1800);
    return () => clearTimeout(t);
  }, [section.id, target, loc.key]);
  return (
    <>
      <header className={m.pageHead}><h2>{section.title}</h2><p>{section.desc}</p></header>
      <div ref={ref} className={m.panels}>
        {section.panels.map(({ id, Component }) => <div key={id} data-panel={id} className={m.panel}><Component /></div>)}
      </div>
    </>
  );
}

export function SettingsTab() {
  const { '*': sectionId = '' } = useParams();
  const navigate = useNavigate();
  const sums = useSummaries();
  const [q, setQ] = useState('');
  const section = SECTIONS.find((s) => s.id === sectionId);

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return SECTIONS.flatMap((s) => s.panels.filter((p) => `${p.title} ${p.keywords} ${s.label}`.toLowerCase().includes(n)).map((p) => ({ s, p })));
  }, [q]);

  return (
    <div className={m.layout}>
      <aside className={m.nav}>
        <Search value={q} onChange={setQ} placeholder="Найти настройку…" />
        {q.trim() ? (
          <div className={m.results}>
            {hits.length === 0 && <div className={m.none}>Ничего не найдено</div>}
            {hits.map(({ s, p }) => (
              <button key={p.id} className={m.hit} onClick={() => { setQ(''); navigate(`/settings/${s.id}`, { state: { panel: p.id } }); }}>
                <b>{p.title}</b><span>{s.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <nav className={m.links}>
            <NavLink to="/settings" end className={({ isActive }) => `${m.link} ${isActive ? m.on : ''}`}><Icon name="layout-dashboard" size={15} />Обзор</NavLink>
            {SECTIONS.map((s) => (
              <NavLink key={s.id} to={`/settings/${s.id}`} className={({ isActive }) => `${m.link} ${isActive ? m.on : ''}`}>
                <Icon name={s.icon} size={15} />{s.label}
                {(sums[s.id]!.tone === 'bad' || sums[s.id]!.tone === 'warn') && <i className={`${m.dot} ${m['d_' + sums[s.id]!.tone]}`} title={sums[s.id]!.text} />}
              </NavLink>
            ))}
          </nav>
        )}
      </aside>
      <main className={m.content}>
        {sectionId === '' ? <Overview /> : section ? <SectionView section={section} /> : <Overview />}
      </main>
    </div>
  );
}
