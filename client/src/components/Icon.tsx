import type { CSSProperties, ReactNode } from 'react';
import { EMOJI_MAP, ICONS, type IconName, type Tone } from './icons';
import styles from './Icon.module.css';

interface IconProps {
  name: IconName;
  size?: number;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, tone = '', className, style }: IconProps) {
  const cls = [styles.icon, tone ? styles[tone] : '', className].filter(Boolean).join(' ');
  if (name === 'dot') {
    return (
      <svg className={`${cls} ${styles.dot}`} width={size * 0.6} height={size * 0.6} viewBox="0 0 12 12" aria-hidden style={style}>
        <circle cx="6" cy="6" r="6" fill="currentColor" />
      </svg>
    );
  }
  const Cmp = ICONS[name];
  return <Cmp className={cls} size={size} strokeWidth={1.75} aria-hidden style={style} />;
}

const EMOJI_RE = /([\u{1F000}-\u{1FFFF}☀-➿⬀-⯿⌀-⏿▶✕✓✖])[️‍⃣]*/gu;

/** Строка с эмодзи (пришла с сервера) → текст + иконки Lucide. Неизвестные эмодзи отбрасываются. */
export function Emoji({ text, size = 14 }: { text: string | null | undefined; size?: number }) {
  if (!text) return null;
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(EMOJI_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const hit = EMOJI_MAP[m[1] ?? ''];
    if (hit) out.push(<Icon key={i++} name={hit[0]} tone={hit[1]} size={size} />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Только текст без эмодзи. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
