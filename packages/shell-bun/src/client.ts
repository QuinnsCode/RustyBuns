// Browser-side helpers bundled into the desktop client.
export async function callAction<T = unknown>(module: string, fn: string, args: unknown[]): Promise<T> {
  const r = await fetch(`/__rb/action`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ module, fn, args }),
  });
  if (!r.ok) throw new Error(`action ${module}#${fn}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}
/**
 * The world socket. A path joins this host's world; an absolute http(s)/ws(s)
 * URL joins another machine's, with the guest query the host checks:
 *   worldSocket("http://192.168.1.20:4000/ws", { join: "pw", uid, name, v: await wireVersion() })
 * Guest pages are served from their own 127.0.0.1 host over http, so a ws://
 * LAN target is not mixed content; an https page could only open wss://.
 */
export function worldSocket(target = "/ws", params: Record<string, string | undefined> = {}): WebSocket {
  return new WebSocket(worldUrl(target, params));
}

/** The address `worldSocket` opens, for a page that keeps the socket itself (`connectSocket` in `@rustybuns/util/socket`). */
export function worldUrl(target = "/ws", params: Record<string, string | undefined> = {}): URL {
  const u = /^[a-z]+:\/\//i.test(target) ? new URL(target) : new URL(target, location.href);
  u.protocol = u.protocol === "https:" || u.protocol === "wss:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u;
}

/**
 * The `v` a guest sends: what this page's own host checks guests against
 * (`guests.version`, which defaults to the build's RB_VERSION). The guest runs
 * the same app, so a matching build gets the same answer. RB_VERSION itself is
 * only defined in the host bundle, not in the client build. Undefined when the
 * check is off (`guests.version: false`).
 */
export async function wireVersion(info = "/__rb/info"): Promise<string | undefined> {
  const r = await fetch(info);
  if (!r.ok) throw new Error(`wireVersion: ${info} ${r.status}`);
  const i = await r.json() as { guests?: { version?: string | null } };
  return i.guests?.version ?? undefined;
}

/** A stable per-player id for the guest query (`uid`), generated once per browser profile. */
export function playerId(key = "rb_player_id"): string {
  try {
    const have = localStorage.getItem(key);
    if (have) return have;
    const id = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}

/** "reconnecting": the socket dropped (a deploy restarts every Durable Object); a UI shows "updating, back in a moment". "offline": it kept failing. */
export type SocketState = "connecting" | "online" | "reconnecting" | "offline";

export interface ResilientSocket { readonly state: SocketState; send(data: Parameters<WebSocket["send"]>[0]): boolean; close(): void }

/**
 * A WebSocket that survives its server restarting. A deploy keeps a Durable Object's storage but drops
 * its sockets and memory, so a page that reconnects with the same identity (`open` builds the URL each
 * time, uid and all) picks its session back up. Backoff is quick first, then slow; after `giveUp` failed
 * tries in a row the state is "offline" (it keeps trying). `onOpen` runs on every (re)connect: resend held state.
 * A close code in `final` stops it (the server said why, e.g. a refused version).
 */
export function resilientSocket(
  open: () => WebSocket,
  ev: { onMessage(data: MessageEvent["data"]): void; onState(s: SocketState, detail?: { tries: number; code?: number }): void; onOpen?(): void },
  opts: { final?: number[]; giveUp?: number; delay?: (tries: number) => number } = {},
): ResilientSocket {
  const final = new Set(opts.final ?? [1008]), giveUp = opts.giveUp ?? 6, delay = opts.delay ?? ((n) => Math.min(500 * 2 ** n, 15_000));
  let ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined, tries = 0, stopped = false, state: SocketState = "connecting";
  const emit = (s: SocketState, code?: number) => { state = s; ev.onState(s, { tries, code }); };
  const retry = (code?: number) => {
    emit(tries >= giveUp ? "offline" : "reconnecting", code);
    timer = setTimeout(connect, delay(tries++));
  };
  function connect() {
    if (!tries) emit("connecting");
    let w: WebSocket;
    try { w = open(); } catch { retry(); return; }
    ws = w;
    w.onopen = () => { tries = 0; emit("online"); ev.onOpen?.(); };
    w.onmessage = (e) => ev.onMessage(e.data);
    w.onclose = (e) => {
      if (ws === w) ws = null;
      if (stopped) return;
      if (final.has(e.code)) { stopped = true; emit("offline", e.code); return; }
      retry(e.code);
    };
  }
  connect();
  return {
    get state() { return state; },
    send(data) { if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(data); return true; },
    close() { stopped = true; clearTimeout(timer); try { ws?.close(1000, "bye"); } catch { /* already gone */ } },
  };
}

/** What an excluded action's proxy does: reject clearly instead of reaching a host that never imported it. */
export function unavailable(module: string, fn: string): Promise<never> {
  return Promise.reject(new Error(`${fn} (${module}) is not available in the desktop build`));
}
