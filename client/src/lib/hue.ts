const HUES = ['#8b93ff', '#4cc38a', '#d9a441', '#e879a6', '#45b8d6', '#b18cff', '#ef8a5a'];
/** Стабильный цвет по имени (аватары аккаунтов). */
export const hueOf = (s: string) => HUES[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length] as string;
export const initialsOf = (s: string) => s.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
