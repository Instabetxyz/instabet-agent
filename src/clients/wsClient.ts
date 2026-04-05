import WebSocket from 'ws';
import { config } from '../config';
import type { WsIncomingEvent } from '../types';

type EventHandler = (event: WsIncomingEvent) => void;

// ─────────────────────────────────────────────────────────
// Persistent WebSocket client with auto-reconnect
// ─────────────────────────────────────────────────────────

export class StreamBetWsClient {
  private ws: WebSocket | null = null;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private reconnectDelayMs = 3_000;

  constructor(private readonly wsUrl: string) {}

  // ── Public ──────────────────────────────────────────────

  connect(): void {
    if (this.stopped) return;
    this._connect();
  }

  /** Subscribe to all incoming server events. */
  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /** Subscribe the agent to receive events for a specific market. */
  subscribeMarket(marketId: string): void {
    this._send({ type: 'subscribe', market_ids: [marketId] });
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer)      clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Private ─────────────────────────────────────────────

  private _connect(): void {
    // The agent authenticates with its API key as a query param.
    // The server's WS handler falls back to API key auth if it's not a Dynamic JWT.
    const url = `${this.wsUrl}?token=${encodeURIComponent(config.agent.apiKey)}`;
    console.log(`[WS] Connecting to ${this.wsUrl}`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[WS] Connected');
      this.reconnectDelayMs = 3_000; // reset backoff on successful connect
      this._startPing();
    });

    this.ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as WsIncomingEvent;
        this.handlers.forEach((h) => h(event));
      } catch {
        // ignore malformed frames
      }
    });

    this.ws.on('close', (code) => {
      console.warn(`[WS] Disconnected (code ${code})`);
      this._stopPing();
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      // 'close' will fire after 'error', triggering reconnect
    });
  }

  private _send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this._send({ type: 'ping' });
    }, 25_000);
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this.stopped) return;
    console.log(`[WS] Reconnecting in ${this.reconnectDelayMs}ms…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
      this._connect();
    }, this.reconnectDelayMs);
  }
}