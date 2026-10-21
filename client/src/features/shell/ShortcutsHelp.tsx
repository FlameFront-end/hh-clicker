import { useT } from '@/store/app';
import s from '@/ui/Ui.module.css';
import d from '@/ui/dialog.module.css';

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const t = useT();
  const rows: [string, string][] = [
    ['1–9, 0', t('shortcuts_tabs')], ['P', t('shortcuts_pause')], ['? /', t('shortcuts_help')], ['Esc', t('shortcuts_esc')],
  ];
  return (
    <div className={d.back} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={d.box} role="dialog" aria-modal="true">
        <div className={d.title}>{t('shortcuts_title')}</div>
        <table className={s.table}><tbody>
          {rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
        </tbody></table>
        <div className={d.actions}><button className={s.btn} onClick={onClose}>{t('btn_close')}</button></div>
      </div>
    </div>
  );
}
