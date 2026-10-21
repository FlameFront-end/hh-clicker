import { useState } from 'react';
import { toast } from 'sonner';
import { del, post } from '@/lib/api';
import { useApp } from '@/store/app';
import type { Account } from '@/types/snapshot';
import { confirmDialog } from '@/ui/dialog';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Все действия над аккаунтом: общие для карточки, меню и боковой панели. */
export function useAccount(acc: Account) {
  const sendCmd = useApp((s) => s.sendCmd);
  const [flags, setFlags] = useState<Record<string, boolean | undefined>>({});

  const run = async (label: string, fn: () => Promise<string | void>) => {
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
    applyTests: flags.apply_tests ?? !!acc.apply_tests,
    degraded: flags.degraded ?? acc.degraded_fallback_enabled !== false,
    llmOn: acc.llm_enabled !== false,
    autoTouch: acc.resume_touch_enabled !== false,
    togglePause: () => sendCmd({ type: 'account_pause', idx: acc.idx }),
    toggleOauth: () => sendCmd({ type: 'account_oauth', idx: acc.idx }),
    toggleLlm: () => sendCmd({ type: 'account_llm', idx: acc.idx }),
    toggleTouch: () => void post(`/api/account/${acc.idx}/resume_touch_toggle`),
    toggleApplyTests: () => flip('apply_tests', `/api/account/${acc.idx}/apply_tests`, 'apply_tests', flags.apply_tests ?? !!acc.apply_tests),
    toggleDegraded: () => flip('degraded', `/api/account/${acc.idx}/degraded_fallback`, 'degraded_fallback_enabled', flags.degraded ?? acc.degraded_fallback_enabled !== false),
    touchNow: () => run('Подъём резюме', async () => { await post(`/api/account/${acc.idx}/resume_touch`); return 'Резюме поднято'; }),
    declineDiscards: () => run('Очистка дискардов', async () => { const r = await post<{ declined?: number }>(`/api/account/${acc.idx}/decline_discards`); return `Отклонено: ${r.declined ?? 0}`; }),
    llmNow: () => run('Проверка чатов', async () => {
      const r = await post<{ started?: boolean; accounts?: number; error?: string }>('/api/llm_run_now');
      if (!r.started) throw new Error(r.error || 'Не запустилось');
      return `Запущено (${r.accounts ?? '?'})`;
    }),
    activate: () => run('Запуск сессии', async () => { await post(`/api/session/${acc.idx}/activate`); }),
    deactivate: () => run('Остановка сессии', async () => { await post(`/api/session/${acc.idx}/deactivate`); }),
    remove: async () => {
      if (!(await confirmDialog(`Удалить ${acc.temp ? 'сессию ' + acc.name : 'аккаунт #' + acc.idx}? Действие необратимо.`, { danger: true, ok: 'Удалить' }))) return;
      await run('Удаление', async () => { await del(acc.temp ? `/api/session/${acc.idx}` : `/api/account/${acc.idx}/delete`); });
    },
  };
}
