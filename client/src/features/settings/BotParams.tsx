import { useState } from 'react';
import { useApp, useT } from '@/store/app';
import { Slider } from '@/ui/radix';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Sect, useFlash } from './kit';

const DEF: { key: string; min: number; max: number; step: number; float?: boolean }[] = [
  { key: 'pages_per_url', min: 5, max: 100, step: 5 },
  { key: 'response_delay', min: 0, max: 30, step: 1 },
  { key: 'pause_between_cycles', min: 15, max: 600, step: 15 },
  { key: 'batch_responses', min: 1, max: 10, step: 1 },
  { key: 'limit_check_interval', min: 5, max: 120, step: 5 },
  { key: 'min_salary', min: 0, max: 300000, step: 10000 },
  { key: 'min_employer_rating', min: 0, max: 5, step: 0.1, float: true },
  { key: 'min_recommendations_percent', min: 0, max: 100, step: 5 },
  { key: 'auto_pause_errors', min: 0, max: 20, step: 1 },
];

export function BotParams() {
  const t = useT();
  const cfg = useApp((x) => x.snapshot?.config);
  const send = useApp((x) => x.sendCmd);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  // Mobile-поиск физически ограничен 20 страницами — больше ставить бессмысленно.
  const hasWeb = (useApp((x) => x.snapshot?.accounts) ?? []).some((acc) => !['mobile', 'oauth'].includes(String(acc.mode || '').toLowerCase()));
  const [flash, setFlash] = useFlash();
  return (
    <Sect icon="sliders-horizontal" title={t('settings_title')} open>
      <div className={m.grid}>
        {DEF.map((d) => {
          const max = d.key === 'pages_per_url' && !hasWeb ? 20 : d.max;
          const cur = Math.min(drafts[d.key] ?? Number(cfg?.[d.key] ?? d.min), max);
          return (
            <div key={d.key} className={m.rowS}>
              <div className={m.lbl}><span>{t('lbl_' + d.key)}</span><span className={m.val}>{d.float ? cur.toFixed(1) : cur}</span></div>
              <div className={s.dim} style={{ fontSize: 11.5 }}>{t('hint_' + d.key)}{d.key === 'pages_per_url' && !hasWeb ? ' · для mobile-профилей максимум 20' : ''}</div>
              <Slider min={d.min} max={max} step={d.step} value={cur} label={t('lbl_' + d.key)} onChange={(v) => setDrafts((x) => ({ ...x, [d.key]: v }))} onCommit={(v) => { send({ type: 'set_config', key: d.key, value: v }); setFlash('Сохранено'); }} />
            </div>
          );
        })}
      </div>
      {flash && <div className={`${m.status} ${s.ok}`}>{flash}</div>}
    </Sect>
  );
}
