import { useEffect } from 'react';
import { startSocket, useApp } from '@/store/app';
import { Header } from '@/features/shell/Header';
import { Tabs } from '@/features/shell/Tabs';
import { ApiKeyGate } from '@/features/shell/ApiKeyGate';
import { MainTab } from '@/features/main/MainTab';
import { LogTab } from '@/features/log/LogTab';
import { AppliedTab } from '@/features/data/AppliedTab';
import { TestsTab } from '@/features/data/TestsTab';
import { DbTab } from '@/features/data/DbTab';
import { HhTab } from '@/features/hh/HhTab';
import { ApplyTab } from '@/features/apply/ApplyTab';
import { ViewsTab } from '@/features/views/ViewsTab';
import { LlmTab } from '@/features/llm/LlmTab';
import { HediTab } from '@/features/hedi/HediTab';
import { RecoTab } from '@/features/reco/RecoTab';
import { SettingsTab } from '@/features/settings/SettingsTab';
import { Placeholder } from '@/features/shell/Placeholder';
import styles from './App.module.css';

export function App() {
  const tab = useApp((s) => s.tab);
  useEffect(() => startSocket(), []);
  return (
    <div className={styles.app}>
      <Header />
      <Tabs />
      <main className={styles.main}>{tab === 'main' ? <MainTab /> : tab === 'log' ? <LogTab /> : tab === 'applied' ? <AppliedTab /> : tab === 'tests' ? <TestsTab /> : tab === 'db' ? <DbTab /> : tab === 'hh' ? <HhTab /> : tab === 'apply' ? <ApplyTab /> : tab === 'views' ? <ViewsTab /> : tab === 'llm' ? <LlmTab /> : tab === 'hedi' ? <HediTab /> : tab === 'recoh' ? <RecoTab /> : tab === 'settings' ? <SettingsTab /> : <Placeholder tab={tab} />}</main>
      <ApiKeyGate />
    </div>
  );
}
