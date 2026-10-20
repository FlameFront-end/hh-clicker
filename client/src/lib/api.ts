/** Тонкий API-клиент. Ключ (HH_BOT_API_KEY) берём из ?key=… или localStorage и шлём только на same-origin. */

const KEY_STORAGE = 'hh-api-key';

function bootstrapKey(): string {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('key');
  const key = (fromUrl || localStorage.getItem(KEY_STORAGE) || '').trim();
  if (key) localStorage.setItem(KEY_STORAGE, key);
  // Ключ в query string уезжает в историю/закладки — убираем сразу после чтения.
  if (fromUrl) {
    params.delete('key');
    const q = params.toString();
    try {
      history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
    } catch {
      /* ignore */
    }
  }
  return key;
}

export const apiKey = bootstrapKey();

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Json;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const qs = p.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers = new Headers();
  if (apiKey) headers.set('X-API-Key', apiKey);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, detail, data);
  }
  return data as T;
}

export const get = <T = unknown>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
  api<T>(path, { query, signal });
export const post = <T = unknown>(path: string, body?: Json) => api<T>(path, { method: 'POST', body });
export const put = <T = unknown>(path: string, body?: Json) => api<T>(path, { method: 'PUT', body });
export const patch = <T = unknown>(path: string, body?: Json) => api<T>(path, { method: 'PATCH', body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });
