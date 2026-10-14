// The local egress gate for `rustybuns containers run --prod-like` (#1689, #818 part 3). It runs in an
// oven/bun sidecar on the container's private Docker network, the one place that network has a way out.
// The app's own `allowed` and `refused` (the egress module a container binding names) decide each request,
// so changing the list in the app changes the local run with no second edit. HTTPS is gated by host at
// CONNECT and tunnelled, not decrypted; plain HTTP is gated per request.
//
//   GATE_MODULE=/gate/egress.ts GATE_HOSTS='["registry.npmjs.org"]' FORWARD=ci:8080 bun egress-gate.ts

export interface GateOpts {
  allowed: (host: string, list: readonly string[]) => boolean;
  refused: (host: string) => Response;
  hosts: string[];
  port: number;
  log: (line: string) => void;
}

type Peer = { upstream?: ReturnType<typeof Bun.connect> extends Promise<infer S> ? S : never; buf: Buffer; done?: boolean };

const line = (ok: boolean, host: string, verb: string, what: string, status: number, note = "") =>
  `egress  ${ok ? "✅" : "⛔"} ${host.padEnd(28)} ${verb.padEnd(7)} ${what.slice(0, 40).padEnd(40)} ${status}${note ? "  " + note : ""}`;

/** Starts the proxy; returns a stop function. */
export function startGate(o: GateOpts): () => void {
  const server = Bun.listen<Peer>({
    hostname: "0.0.0.0",
    port: o.port,
    socket: {
      open(s) { s.data = { buf: Buffer.alloc(0) }; },
      async data(s, chunk) {
        const p = s.data;
        if (p.upstream) { p.upstream.write(chunk); return; }
        p.buf = Buffer.concat([p.buf, chunk]);
        const end = p.buf.indexOf("\r\n\r\n");
        if (end < 0 || p.done) return;
        p.done = true;
        const head = p.buf.subarray(0, end).toString("latin1").split("\r\n");
        const rest = p.buf.subarray(end + 4);
        const [method = "", target = ""] = head[0]!.split(" ");
        const deny = async (host: string, verb: string, what: string) => {
          const r = o.refused(host), body = await r.text();
          o.log(line(false, host, verb, what, r.status, "not on this binding's list"));
          s.write(`HTTP/1.1 ${r.status} Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
          s.end();
        };
        if (method === "CONNECT") {
          const i = target.lastIndexOf(":"), host = (i < 0 ? target : target.slice(0, i)).toLowerCase(), port = i < 0 ? 443 : Number(target.slice(i + 1));
          if (!o.allowed(host, o.hosts)) return deny(host, "CONNECT", `:${port}`);
          try {
            p.upstream = await Bun.connect({ hostname: host, port, socket: {
              data(_u, d) { s.write(d); },
              close() { s.end(); },
              error() { s.end(); },
            } });
          } catch { o.log(line(true, host, "CONNECT", `:${port}`, 502, "unreachable")); s.write("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n"); s.end(); return; }
          o.log(line(true, host, "CONNECT", `:${port}`, 200));
          s.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length) p.upstream.write(rest);
          return;
        }
        let url: URL;
        try { url = new URL(target); } catch { s.write("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n"); s.end(); return; }
        const host = url.hostname.toLowerCase();
        if (!o.allowed(host, o.hosts)) return deny(host, method, url.pathname);
        const headers = new Headers();
        for (const h of head.slice(1)) { const j = h.indexOf(":"); if (j > 0 && !/^(proxy-|connection$|host$)/i.test(h.slice(0, j))) headers.set(h.slice(0, j).trim(), h.slice(j + 1).trim()); }
        try {
          const r = await fetch(url, { method, headers, body: rest.length ? new Uint8Array(rest) : undefined, redirect: "manual" });
          const body = Buffer.from(await r.arrayBuffer());
          o.log(line(true, host, method, url.pathname, r.status));
          const out = new Headers(r.headers);
          out.delete("content-encoding"); out.set("content-length", String(body.length)); out.set("connection", "close");
          s.write(`HTTP/1.1 ${r.status} ${r.statusText || "OK"}\r\n${[...out].map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
          s.write(body);
        } catch { o.log(line(true, host, method, url.pathname, 502, "unreachable")); s.write("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n"); }
        s.end();
      },
      close(s) { s.data.upstream?.end(); },
    },
  });
  return () => server.stop(true);
}

/** Plain TCP from `listen` to `to`: how the host reaches a container whose network has no published ports. */
export function forward(listen: number, to: { hostname: string; port: number }): () => void {
  const server = Bun.listen<{ peer?: { write(d: Uint8Array): unknown; end(): unknown }; queue: Uint8Array[] }>({
    hostname: "0.0.0.0",
    port: listen,
    socket: {
      async open(s) {
        s.data = { queue: [] };
        try {
          s.data.peer = await Bun.connect({ ...to, socket: { data(_u, d) { s.write(d); }, close() { s.end(); }, error() { s.end(); } } });
          for (const d of s.data.queue) s.data.peer.write(d);
        } catch { s.end(); }
      },
      data(s, d) { if (s.data.peer) s.data.peer.write(d); else s.data.queue.push(new Uint8Array(d)); },
      close(s) { s.data.peer?.end(); },
    },
  });
  return () => server.stop(true);
}

/** Refused hosts out of the gate's log lines, and the line to add to the list for each. */
export function refusedSummary(lines: string[], binding: string): string {
  const hosts = [...new Set(lines.filter((l) => l.includes("⛔")).map((l) => l.split(/\s+/)[2]!))];
  if (!hosts.length) return "egress  nothing was refused";
  return `egress  refused ${hosts.length} host${hosts.length === 1 ? "" : "s"}: ${hosts.join(", ")}\negress  if ${hosts.length === 1 ? "it" : "they"} should be allowed, add ${hosts.map((h) => JSON.stringify(h)).join(", ")} to ${binding}'s egress hosts`;
}

if (import.meta.main) {
  const mod = await import(process.env.GATE_MODULE!);
  startGate({ allowed: mod.allowed, refused: mod.refused, hosts: JSON.parse(process.env.GATE_HOSTS ?? "[]"), port: 3128, log: (l) => console.log(l) });
  const f = process.env.FORWARD;
  if (f) { const i = f.lastIndexOf(":"); forward(9000, { hostname: f.slice(0, i), port: Number(f.slice(i + 1)) }); }
  console.log("gate ready");
}
