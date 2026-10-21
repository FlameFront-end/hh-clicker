import { Dialog, Tabs } from 'radix-ui';
import { Emoji, Icon, stripEmoji } from '@/components/Icon';
import { fmtInt, num } from '@/lib/format';
import { useApp, useT } from '@/store/app';
import { promptDialog } from '@/ui/dialog';
import type { Account } from '@/types/snapshot';
import { Autosearches, AutoResponse, Bell, CareerRadar, Conversion, Hidden, Visibility } from './panels/Data';
import { Letter, ResumePicker, SmartFilters, UrlPanel } from './panels/Local';
import { plural, statusOf } from './status';
import { useAccount } from './useAccount';
import r from '@/ui/Radix.module.css';
import { Toggle } from '@/ui/radix';
import s from './AccountSheet.module.css';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className={s.setting}><div><div>{title}</div>{hint && <div className={s.hint}>{hint}</div>}</div>{children}</div>;
}

function Body({ acc }: { acc: Account }) {
  const t = useT();
  const snap = useApp((x) => x.snapshot)!;
  const cfg = snap.config;
  const a = useAccount(acc);
  const llmOff = !cfg.llm_enabled || !a.llmOn;
  let llmChip = '', tone: 'ok' | 'bad' | 'dim' | 'accent' = 'dim';
  if (!cfg.llm_enabled) { llmChip = 'Выключено во всех аккаунтах (Настройки → ИИ)'; tone = 'bad'; }
  else if (!a.llmOn) llmChip = 'Выключено для этого аккаунта';
  else if (acc.llm_status) { llmChip = acc.llm_status; tone = acc.llm_status.startsWith('✅') ? 'ok' : acc.llm_status.startsWith('💤') ? 'dim' : 'accent'; }
  else llmChip = 'Чаты ещё не проверялись';
  const touchSec = num(acc.resume_next_touch_seconds);

  return (
    <>
      <Tabs.Content value="overview" className={s.pane}>
        <section className={s.block}>
          <h4>Отклики на HH</h4>
          <div className={s.tiles}>
            <div className={`${s.tile} ${num(acc.hh_interviews) > 0 ? s.tileOk : ''}`}><b>{num(acc.hh_interviews)}</b><span>{plural(num(acc.hh_interviews), 'приглашение', 'приглашения', 'приглашений')}</span></div>
            <div className={s.tile}><b>{num(acc.hh_viewed)}</b><span>просмотрено работодателем</span></div>
            <div className={s.tile}><b>{num(acc.hh_not_viewed)}</b><span>ещё ждут просмотра</span></div>
          </div>
          <div className={s.kv}>
            <span>Отказы</span><b>{num(acc.hh_discards)}</b>
            <span>Непрочитанные сообщения у работодателя</span><b>{num(acc.hh_unread_by_employer)}</b>
          </div>
          {acc.hh_stats_updated && <div className={s.hint}>Данные HH обновлены {acc.hh_stats_updated}</div>}
        </section>

        <section className={s.block}>
          <h4>Ответы HR через ИИ</h4>
          <div className={`${s.llm} ${s['l_' + tone]}`}>
            <Icon name="bot" size={14} /><span className={s.llmChip}><Emoji text={llmChip} size={12} /></span>
            <i>отвечено</i><b className="tnum">{fmtInt(num(acc.llm_replied_count))}</b>
            {!llmOff && <><i>в очереди</i><b className={num(acc.llm_pending_chats) > 0 ? s.warn : ''}>{num(acc.llm_pending_chats)}</b></>}
          </div>
        </section>

        {num(acc.resume_views_7d) > 0 && (
          <section className={s.block}>
            <h4>Резюме за последние 7 дней</h4>
            <div className={s.resume}>
              <div><Icon name="eye" size={13} /><b>{num(acc.resume_views_7d)}</b><span>просмотров</span><em>+{num(acc.resume_views_new)}</em></div>
              <div><Icon name="search" size={13} /><b>{num(acc.resume_shows_7d)}</b><span>показов в поиске</span></div>
              <div><Icon name="mailbox" size={13} tone="ok" /><b>{num(acc.resume_invitations_7d)}</b><span>приглашений</span></div>
            </div>
            <div className={s.hint}>
              {touchSec > 0 ? `Следующий подъём через ${Math.floor(touchSec / 3600) > 0 ? Math.floor(touchSec / 3600) + 'ч ' : ''}${Math.floor((touchSec % 3600) / 60)}м` : `Можно поднять резюме: ${num(acc.resume_free_touches)} раз`}
            </div>
          </section>
        )}

        {acc.acc_event_log?.length > 0 && (
          <section className={s.block}>
            <h4>Последние события</h4>
            <div className={s.events}>
              {acc.acc_event_log.map((e, i) => (
                <div key={i} className={s.ev}>
                  <span className={s.time}>{e.time}</span>
                  <Emoji text={e.icon} size={13} />
                  <div><div>{e.title}{e.company && <span className={s.hint}> @ {e.company}</span>}</div>{e.extra && <div className={s.hint}>{e.extra}</div>}</div>
                </div>
              ))}
            </div>
          </section>
        )}
        {acc.action_history?.length > 0 && <div className={s.hist}>{acc.action_history.slice(-5).join('  |  ')}</div>}
      </Tabs.Content>

      <Tabs.Content value="apply" className={s.pane}>
        <section className={s.block}>
          <h4>Как откликаться</h4>
          <div className={s.group}>
            <Row title={t('card_apply_tests')} hint="Откликаться и на вакансии, где работодатель просит пройти тест"><Toggle checked={a.applyTests} onChange={a.toggleApplyTests} label={t('card_apply_tests')} /></Row>
            <Row title="Откликаться через API HH" hint="Стабильнее веб-сессии; выключите, чтобы откликаться через браузерные cookies"><Toggle checked={!!acc.use_oauth} onChange={a.toggleOauth} label="OAuth" /></Row>
            <Row title="Запасной канал через API" hint="Если веб-сессия устарела, продолжать откликаться через API HH"><Toggle checked={a.degraded} onChange={a.toggleDegraded} label="OAuth-fallback" /></Row>
          </div>
        </section>
        <section className={s.block}>
          <h4>Резюме и чаты</h4>
          <div className={s.group}>
            <Row title="Поднимать резюме автоматически" hint="Резюме будет чаще показываться работодателям в поиске"><Toggle checked={a.autoTouch} onChange={a.toggleTouch} label="Авто-подъём" /></Row>
            <Row title="Отвечать HR через ИИ" hint="ИИ сам ответит на сообщения работодателей в чатах"><Toggle checked={a.llmOn} onChange={a.toggleLlm} label="LLM-ответы" /></Row>
          </div>
        </section>
        <section className={s.block}>
          <h4>Что и куда отправлять</h4>
          <Letter acc={acc} />
          <UrlPanel acc={acc} />
          <SmartFilters acc={acc} />
          {acc.temp && <ResumePicker acc={acc} />}
        </section>
      </Tabs.Content>

      <Tabs.Content value="hh" className={s.pane}>
        <p className={s.lead}>Данные и инструменты с hh.ru для этого аккаунта. Раскройте раздел — данные загрузятся при открытии.</p>
        <section className={s.block}>
          <h4>Автоматизация</h4>
          <AutoResponse idx={acc.idx} resumeHash={acc.resume_hash || ''} />
        </section>
        <section className={s.block}>
          <h4>Аналитика</h4>
          <Conversion idx={acc.idx} />
          <CareerRadar idx={acc.idx} />
          <Visibility idx={acc.idx} />
        </section>
        <section className={s.block}>
          <h4>Поиски и уведомления</h4>
          <Autosearches idx={acc.idx} />
          <Hidden idx={acc.idx} />
          <Bell idx={acc.idx} />
        </section>
      </Tabs.Content>
    </>
  );
}

export function AccountSheet({ acc, onClose }: { acc: Account | undefined; onClose: () => void }) {
  const t = useT();
  const snap = useApp((x) => x.snapshot);
  return (
    <Dialog.Root open={!!acc} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={r.overlay} />
        <Dialog.Content className={r.sheet} aria-describedby={undefined}>
          {acc && snap && (
            <Tabs.Root defaultValue="overview" className={s.root}>
              <header className={s.head}>
                <div>
                  <Dialog.Title className={s.title}>{stripEmoji(acc.name).replace(/\s*\(\s*\)/, '')}<button className={s.rename} aria-label="Переименовать" title="Переименовать" onClick={async () => { const v = await promptDialog(`Своё название для «${acc.hh_name ?? acc.name}» (пусто — вернуть исходное):`, acc.hh_name ? acc.name : ''); if (v !== null) useApp.getState().setAlias(acc.hh_name ?? acc.name, v); }}><Icon name="pencil" size={13} /></button></Dialog.Title>
                  <div className={s.sub}>{statusOf(acc, snap, t).label} · {acc.use_oauth ? 'через API HH' : 'через веб-сессию'}</div>
                </div>
                <Dialog.Close className={s.close} aria-label="Закрыть"><Icon name="x" size={16} /></Dialog.Close>
              </header>
              <Tabs.List className={r.tabList}>
                <Tabs.Trigger className={r.tab} value="overview">Обзор</Tabs.Trigger>
                <Tabs.Trigger className={r.tab} value="apply">Настройки откликов</Tabs.Trigger>
                <Tabs.Trigger className={r.tab} value="hh">Инструменты HH</Tabs.Trigger>
              </Tabs.List>
              <div className={s.scroll}><Body acc={acc} /></div>
            </Tabs.Root>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
