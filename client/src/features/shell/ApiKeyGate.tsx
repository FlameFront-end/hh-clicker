import { useState } from 'react';
import { setApiKey } from '@/lib/api';
import { useApp } from '@/store/app';
import styles from './ApiKeyGate.module.css';

export function ApiKeyGate() {
  const unauthorized = useApp((s) => s.unauthorized);
  const [value, setValue] = useState('');
  if (!unauthorized) return null;
  const submit = () => {
    if (!value.trim()) return;
    setApiKey(value);
    location.reload();
  };
  return (
    <div className={styles.overlay}>
      <form className={styles.box} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2>Нужен API-ключ</h2>
        <p>Сервер требует <code>HH_BOT_API_KEY</code>. Ключ хранится только в этом браузере.</p>
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="API-ключ" />
        <button type="submit">Войти</button>
      </form>
    </div>
  );
}
