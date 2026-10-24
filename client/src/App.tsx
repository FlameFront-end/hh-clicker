import { Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { startSocket } from '@/store/app';
import { Header } from '@/features/shell/Header';
import { Tabs } from '@/features/shell/Tabs';
import { ApiKeyGate } from '@/features/shell/ApiKeyGate';
import { Toaster } from 'sonner';
import { TipProvider } from '@/ui/radix';
import { DialogHost } from '@/ui/dialog';
import { ShortcutsHelp } from '@/features/shell/ShortcutsHelp';
import { useShortcuts } from '@/lib/useShortcuts';
import { useDocumentStatus } from '@/lib/useDocumentStatus';
import { ROUTES } from './routes';
import styles from './App.module.css';
import { UnsavedGuard } from '@/lib/unsaved';

export function App() {
  useEffect(() => startSocket(), []);
  const [help, setHelp] = useState(false);
  useShortcuts(useCallback(() => setHelp((x) => !x), []), useCallback(() => setHelp(false), []));
  useDocumentStatus();
  return (
    <TipProvider>
    <UnsavedGuard />
    <div className={styles.app}>
      <Header />
      <Tabs />
      <main className={styles.main}>
        <Suspense fallback={null}>
          <Routes>
            {ROUTES.map(({ path, Component, nested }) => (
              <Route key={path} index={path === ''} path={path ? (nested ? `${path}/*` : path) : undefined} element={<Component />} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <ApiKeyGate />
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      <DialogHost />
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: 'var(--card2)', border: '1px solid var(--border-hi)', color: 'var(--text)' } }} />
    </div>
    </TipProvider>
  );
}
