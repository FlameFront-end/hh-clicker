import { apiKey } from './api';
import type { Snapshot, WsCommand } from '@/types/snapshot';

export interface WsHandlers {
  onOpen(): void;
  onClose(info: { unauthorized: boolean }): void;
  onSnapshot(snap: Snapshot): void;
}

const MAX_LOG = 100;
const MAX_RECENT = 100;
const MAX_LLM = 200;

/** WebSocket с экспоненциальным reconnect. Код 4401 — сервер отверг ключ, цикл останавливается. */
export class SocketClient {
  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private delay = 1000;
  private stopped = false;

  constructor(private readonly h: WsHandlers) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
  }

  send(cmd: WsCommand): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(cmd));
    return true;
  }

  private connect(): void {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : '';
    const ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
    this.ws = ws;

    ws.onopen = () => {
      this.delay = 1000;
      this.h.onOpen();
    };
    ws.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data as string) as Snapshot;
        if (snap.type !== 'state_update') return;
        // Режем большие массивы, иначе за дни uptime снимок копит память.
        if (Array.isArray(snap.log)) snap.log = snap.log.slice(-MAX_LOG);
        if (Array.isArray(snap.recent_responses)) snap.recent_responses = snap.recent_responses.slice(-MAX_RECENT);
        if (Array.isArray(snap.llm_log)) snap.llm_log = snap.llm_log.slice(-MAX_LLM);
        this.h.onSnapshot(snap);
      } catch (e) {
        console.error('WS parse error', e);
      }
    };
    ws.onclose = (ev) => {
      const unauthorized = ev.code === 4401;
      this.h.onClose({ unauthorized });
      if (unauthorized || this.stopped) return;
      this.timer = window.setTimeout(() => {
        this.delay = Math.min(this.delay * 2, 30000);
        this.connect();
      }, this.delay);
    };
    ws.onerror = () => ws.close();
  }
}
