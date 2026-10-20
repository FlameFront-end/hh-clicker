/** Ссылка из данных сервера → только http(s), иначе «#». */
export function safeHref(url: unknown): string {
  if (!url) return '#';
  try {
    const u = new URL(String(url).trim(), location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '#';
  } catch {
    return '#';
  }
}
export const shortAcc = (s: string) => s.replace(/^.*?\((.+?)\).*$/, '$1') || s;
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const colorVar = (c: string) => ({ cyan: 'var(--accent)', magenta: '#c084fc', green: 'var(--ok)', yellow: 'var(--warn)', red: 'var(--bad)', blue: '#6aa8ff' } as Record<string, string>)[c] ?? 'var(--dim)';
