import type { TabId } from '@/store/app';

export function Placeholder({ tab }: { tab: TabId }) {
  return (
    <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>
      Вкладка «{tab}» ещё переносится на React. Пока она доступна в <a href="/">старом интерфейсе</a>.
    </div>
  );
}
