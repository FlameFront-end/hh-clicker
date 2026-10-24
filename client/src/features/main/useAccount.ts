import { useState } from 'react';
import { toast } from 'sonner';
import { del, post } from '@/lib/api';
import { useApp, useT } from '@/store/app';
import type { Account } from '@/types/snapshot';
import { confirmDialog } from '@/ui/dialog';
import { mainCopy } from './copy';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Все действия над аккаунтом: общие для карточки, меню и боковой панели. */
export function useAccount(acc: Account) {
  const t = useT();
  const sendCmd = useApp((s) => s.sendCmd);
  const connected = useApp((s) => s.connected);
  const c = mainCopy(useApp((s) => s.lang) === 'en');
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean | undefined>>({});

  const run = async (label: string, fn: () => Promise<string | void>) => {
    if (!connected) { toast.error(c.noConnection); return; }
    const id = toast.loading(`${label}…`);
    try { toast.success((await fn()) || label, { id }); } catch (e) { toast.error(errMsg(e), { id }); }
  };

  const flip = async (key: 'apply_tests' | 'degraded', path: string, field: string, cur: boolean) => {
    setFlags((f) => ({ ...f, [key]: !cur }));
    try {
      const r = await post<Record<string, unknown> & { ok?: boolean }>(path);
      if (!r.ok) throw new Error('fail');
      setFlags((f) => ({ ...f, [key]: !!r[field] }));
    } catch { setFlags((f) => ({ ...f, [key]: cur })); toast.error('Не удалось сохранить'); }
    window.setTimeout(() => setFlags((f) => ({ ...f, [key]: undefined })), 2000);
  };

  return {
    runNowBusy,
    runNow: async () => {
      if (runNowBusy) return;
      setRunNowBusy(true);
      try {
        const r = await post<{ ok: boolean; error?: string }>(`/api/account/${acc.idx}/run_now`);
        if (!r.ok) throw new Error(r.error || t('run_now_failed'));
        toast.success(t('run_now_queued'));
      } catch (e) { toast.error(errMsg(e)); }
      finally { setRunNowBusy(false); }
    },
    applyTests: flags.apply_tests ?? !!acc.apply_tests,
    degraded: flags.degraded ?? acc.degraded_fallback_enabled !== false,
    llmOn: acc.llm_enabled !== false,
    autoTouch: acc.resume_touch_enabled !== false,
    togglePause: () => sendCmd({ type: 'account_pause', idx: acc.idx }),
    toggleOauth: () => sendCmd({ type: 'account_oauth', idx: acc.idx }),
    toggleLlm: () => sendCmd({ type: 'account_llm', idx: acc.idx }),
    toggleTouch: () => run('Авто-подъём', async () => { const r = await post<{ ok?: boolean; enabled?: boolean }>(`/api/account/${acc.idx}/resume_touch_toggle`); if (!r.ok) throw new Error('Не удалось сохранить'); return r.enabled ? 'Авто-подъём включён' : 'Авто-подъём выключен'; }),
    toggleApplyTests: () => flip('apply_tests', `/api/account/${acc.idx}/apply_tests`, 'apply_tests', flags.apply_tests ?? !!acc.apply_tests),
    toggleDegraded: () => flip('degraded', `/api/account/${acc.idx}/degraded_fallback`, 'degraded_fallback_enabled', flags.degraded ?? acc.degraded_fallback_enabled !== false),
    touchNow: () => run(c.touch, async () => { const r = await post<{ ok?: boolean; error?: string }>(`/api/account/${acc.idx}/resume_touch`); if (!r.ok) throw new Error(r.error || 'Не удалось запланировать'); return c.touchQueued; }),
    declineDiscards: () => run('Очистка дискардов', async () => { const r = await post<{ declined?: number }>(`/api/account/${acc.idx}/decline_discards`); return `Отклонено: ${r.declined ?? 0}`; }),
    llmNow: () => run('Проверка чатов', async () => {
      const r = await post<{ started?: boolean; accounts?: number; error?: string }>(`/api/llm_run_now?account_idx=${acc.idx}`);
      if (!r.started) throw new Error(r.error || 'Не запустилось');
      return `Запущено (${r.accounts ?? '?'})`;
    }),
    activate: () => run('Запуск сессии', async () => { const r = await post<{ ok?: boolean; error?: string }>(`/api/session/${acc.idx}/activate`); if (r.ok === false) throw new Error(r.error || 'Запуск не выполнен'); }),
    deactivate: () => run('Остановка сессии', async () => { const r = await post<{ ok?: boolean; error?: string }>(`/api/session/${acc.idx}/deactivate`); if (r.ok === false) throw new Error(r.error || 'Остановка не выполнена'); }),
    remove: async () => {
      if (!(await confirmDialog(`Удалить ${acc.temp ? 'сессию ' + acc.name : 'аккаунт #' + acc.idx}? Действие необратимо.`, { danger: true, ok: 'Удалить' }))) return;
      await run('Удаление', async () => { await del(acc.temp ? `/api/session/${acc.idx}` : `/api/account/${acc.idx}/delete`); });
    },
  };
}
