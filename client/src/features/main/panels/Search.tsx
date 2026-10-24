import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { post } from '@/lib/api';
import { useApp } from '@/store/app';
import type { Account } from '@/types/snapshot';
import { ResumeRules } from '@/features/settings/ResumeRules';
import { Toggle } from '@/ui/radix';
import s from '@/ui/Ui.module.css';
import { UrlBody } from './Local';
import { experience, sourceCount, workFormats } from './searchInfo';
import q from './Search.module.css';

/** Шаг конвейера поиска: номер, заголовок, пояснение, содержимое. */
function Step({ n, icon, title, desc, aside, children }: { n: number; icon: IconName; title: string; desc: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={q.step}>
      <div className={q.rail}><span className={q.num}>{n}</span></div>
      <div className={q.body}>
        <header className={q.head}>
          <div><h4><Icon name={icon} size={14} />{title}</h4><p>{desc}</p></div>
          {aside}
        </header>
        {children}
      </div>
    </section>
  );
}

/** Чип настройки: «название: значение», серый если выключено. */
function Chip({ on, label, value }: { on: boolean; label: string; value?: ReactNode }) {
  return <span className={`${q.chip} ${on ? q.chipOn : ''}`}>{label}{value != null && <b>{value}</b>}</span>;
}

const toSettings = (section: string) => <Link className={q.edit} to={`/settings/${section}`}>Изменить<Icon name="arrow-up-right" size={12} /></Link>;

export function SearchTab({ acc }: { acc: Account }) {
  const cfg = useApp((x) => x.snapshot?.config);
  const connected = useApp((x) => x.connected);
  const [safety, setSafety] = useState<boolean | undefined>(undefined);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyError, setSafetyError] = useState('');
  const safe = safety ?? !!acc.safety_enabled;
  const flipSafety = async () => {
    if (safetyBusy || !connected) return;
    setSafetyBusy(true); setSafetyError('');
    setSafety(!safe);
    try { const r = await post<{ ok?: boolean; safety_enabled?: boolean }>(`/api/account/${acc.idx}/safety_toggle`); if (!r.ok) throw new Error('Не удалось сохранить'); setSafety(r.safety_enabled ?? !safe); }
    catch { setSafety(safe); setSafetyError('Не удалось сохранить проверку. Прежнее значение восстановлено.'); }
    finally { setSafetyBusy(false); }
  };
  const days = Number(cfg?.search_period_days) || 0;
  const fmt = workFormats(acc, cfg);
  const exp = experience(acc);
  const minSal = Number(cfg?.min_salary) || 0;
  const rating = Number(cfg?.min_employer_rating) || 0;
  const recPct = Number(cfg?.min_recommendations_percent) || 0;
  const tests = acc.apply_tests || !!cfg?.auto_apply_tests;
  const usesPool = acc.search_source_mode === 'inherit' || (!acc.search_source_mode && !acc.urls?.length);
  const searchesEnabled = sourceCount(acc, cfg) > 0 || acc.include_saved_searches !== false;
  return (
    <div className={q.flow}>
      <p className={q.lead}>Так бот находит вакансии для этого профиля: берёт поиски на hh.ru, просит у HH отфильтровать выдачу, затем сам отсеивает неподходящее и откликается на остальное.</p>

      <Step n={1} icon="link" title="Где ищет" desc={usesPool ? 'Используется общий пул из настроек. Источник можно изменить ниже.' : 'Только выбранные ниже поиски и отдельно включённые источники HH.'}>
        <div className={q.urls}><UrlBody acc={acc} /></div>
        <div className={q.chips}>
          <Chip on={searchesEnabled} label="Избранное HH" value={searchesEnabled ? 'добавляется при включённом поиске' : 'поиск отключён'} />
          <Chip on={searchesEnabled && !!cfg?.related_vacancies_enabled} label="Похожие вакансии" value={searchesEnabled && cfg?.related_vacancies_enabled ? 'добавляются' : 'выкл'} />
        </div>
      </Step>

      <Step n={2} icon="sliders-horizontal" title="Что просит у HH" desc="Эти условия уходят в сам поиск — HH не покажет вакансии, которые им не подходят." aside={toSettings('search')}>
        <div className={q.chips}>
          <Chip on={days > 0} label="Свежесть" value={days > 0 ? `${days} дн.` : 'любая'} />
          <Chip on={!!cfg?.filter_agencies} label="Без агентств" value={cfg?.filter_agencies ? 'да' : 'нет'} />
          <Chip on={!!cfg?.filter_low_competition} label="Мало откликов" value={cfg?.filter_low_competition ? 'да' : 'нет'} />
          <Chip on={fmt.length > 0} label="Формат" value={fmt.length ? fmt.join(', ') : 'любой'} />
          <Chip on={exp.length > 0} label="Опыт" value={exp.length ? exp.join(', ') : 'из ссылки'} />
          {!!cfg?.hh_region && <Chip on label="Регион" value={`${String(cfg.hh_region)}.hh.ru`} />}
        </div>
      </Step>

      <Step n={3} icon="search" title="Что отсеивает бот" desc="Перед откликом бот проверяет каждую найденную вакансию. Слова ниже можно править прямо здесь.">
        <ResumeRules key={acc.resume_hash} acc={acc} hash={acc.resume_hash} />
        <div className={q.chips}>
          <Chip on={minSal > 0} label="Зарплата от" value={minSal > 0 ? `${minSal.toLocaleString('ru')} ₽` : 'не важна'} />
          <Chip on={rating > 0 || recPct > 0} label="Рейтинг работодателя" value={rating > 0 ? `от ${rating}` : recPct > 0 ? `${recPct}% рекомендуют` : 'не важен'} />
          <Chip on={!!cfg?.skip_auto_response_vacancies} label="Без авто-откликов HH" value={cfg?.skip_auto_response_vacancies ? 'да' : 'нет'} />
          <Chip on={!!cfg?.accredited_it_only} label="Только IT-аккредитация" value={cfg?.accredited_it_only ? 'да' : 'нет'} />
          <Chip on label="Тесты и опросы" value={tests ? 'заполняет' : 'пропускает'} />
          <Chip on label="Уже откликались / отказали" value="пропускает" />
        </div>
        <div className={q.row}>
          <div><b>Проверять вакансию перед откликом</b><small>HH подскажет, подходит ли резюме и какие поля обязательны. Медленнее, но меньше пустых откликов.</small></div>
          <Toggle checked={safe} disabled={safetyBusy || !connected} onChange={() => void flipSafety()} label="Проверка перед откликом" />
        </div>
        {safetyError && <p role="status" className={q.badT}>{safetyError}</p>}
        <div className={q.links}>{toSettings('search')}<span className={q.dim}>зарплата, рейтинг и остальные общие фильтры</span></div>
      </Step>

      <Step n={4} icon="send" title="Как откликается" desc="Порядок и ограничения отправки." aside={toSettings('limits')}>
        <div className={q.chips}>
          <Chip on label="Сначала" value={cfg?.fresh_vacancies_mode ? 'свежие и горячие лиды' : 'горячие лиды'} />
          <Chip on={Number(cfg?.daily_apply_limit) > 0} label="Свой лимит в день" value={Number(cfg?.daily_apply_limit) > 0 ? String(cfg?.daily_apply_limit) : 'нет'} />
          <Chip on label="Лимит HH" value={`${Number(acc.hh_daily_limit) || 200} в день`} />
          <Chip on label="Канал" value={acc.use_oauth || cfg?.use_oauth_apply ? 'API HH' : 'сайт'} />
        </div>
      </Step>
      <p className={q.foot}><Link to="/settings/search" className={s.btn}><Icon name="settings" size={13} />Все настройки поиска</Link></p>
    </div>
  );
}
