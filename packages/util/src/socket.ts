// The page's side of a world socket, once: open it, keep what was sent before it opened, hand
// every frame through one decoder, and try again after a close when the caller says how long.
// The world's side is `Sockets` in ./room.ts.

export interface LinkOpts<In, Out> {
  /** A text frame's JSON, checked. null drops the frame. */
  decode(v: unknown): In | null;
  /** A binary frame (the socket is opened with binaryType "arraybuffer"). Without it, binary frames are dropped. */
  decodeBinary?(data: ArrayBuffer): In | null;
  onMessage(m: In): void;
  /** The socket opened; `tries` is how many closes came before it since the last open. */
  onOpen?(tries: number): void;
  /**
   * The socket closed (not by `close()`). `seen`: a message had arrived on it; `tries`: closes
   * since the last open, this one included. Return the ms to wait before opening again, or
   * nothing to stay closed.
   */
  onClose?(e: { code: number; reason: string; seen: boolean; tries: number }): number | null | void;
  /** Messages kept while the socket is not open and sent once it is (default: none, they are dropped). */
  queue?: number;
  /** `send` turns a message into a frame with this (default JSON.stringify). */
  encode?(m: Out): string;
}

export interface Link<Out> {
  /** True once sent, false when dropped (not open and the queue is full or absent). */
  send(m: Out): boolean;
  readonly open: boolean;
  /** Close for good: no retry, no callbacks. */
  close(code?: number, reason?: string): void;
}

/** Open a socket to `url` (a function is called on every try) and keep it, as `opts` says. */
export function connectSocket<In, Out>(url: string | URL | (() => string | URL), opts: LinkOpts<In, Out>): Link<Out> {
  const encode = opts.encode ?? ((m: Out) => JSON.stringify(m));
  let ws: WebSocket | null = null;
  let closed = false;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: string[] = [];

  const connect = () => {
    if (closed) return;
    const s = new WebSocket(typeof url === "function" ? url() : url);
    if (opts.decodeBinary) s.binaryType = "arraybuffer";
    let seen = false;
    ws = s;
    s.onopen = () => {
      const n = tries;
      tries = 0;
      for (const m of queue.splice(0)) s.send(m);
      opts.onOpen?.(n);
    };
    s.onmessage = (e) => {
      let m: In | null = null;
      if (typeof e.data === "string") {
        let v: unknown;
        try { v = JSON.parse(e.data); } catch { return; }
        m = opts.decode(v);
      } else if (opts.decodeBinary && e.data instanceof ArrayBuffer) m = opts.decodeBinary(e.data);
      if (m === null) return;
      seen = true;
      opts.onMessage(m);
    };
    s.onclose = (e) => {
      if (ws === s) ws = null;
      if (closed) return;
      const wait = opts.onClose?.({ code: e.code, reason: e.reason, seen, tries: ++tries });
      if (typeof wait === "number" && wait >= 0) timer = setTimeout(connect, wait);
    };
  };
  connect();

  return {
    send(m) {
      if (closed) return false;
      const s = encode(m);
      if (ws?.readyState === WebSocket.OPEN) { ws.send(s); return true; }
      if (queue.length < (opts.queue ?? 0)) { queue.push(s); return true; }
      return false;
    },
    get open() { return ws?.readyState === WebSocket.OPEN; },
    close(code = 1000, reason = "") {
      closed = true;
      clearTimeout(timer);
      queue.length = 0;
      try { ws?.close(code, reason); } catch { /* never opened */ }
      ws = null;
    },
  };
}
