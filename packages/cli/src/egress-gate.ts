// The local egress gate for `rustybuns containers run --prod-like` (#1689, #818 part 3). It runs in an
// oven/bun sidecar on the container's private Docker network, the one place that network has a way out.
// The app's own `allowed` and `refused` (the egress module a container binding names) decide each request,
// so changing the list in the app changes the local run with no second edit. HTTPS is decrypted the way the
// runtime does it (#2600): an off-list host is refused at CONNECT, an allowed one's tunnel lands on a TLS
// server here holding a leaf the session's CA signed for the list's names, so each request is gated and
// logged with its path, then sent on. Plain HTTP is gated per request the same way.
//
//   GATE_MODULE=/gate/egress.ts GATE_HOSTS='["registry.npmjs.org"]' GATE_CERT=/gate/leaf.crt GATE_KEY=/gate/leaf.key FORWARD=ci:8080 bun egress-gate.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GateOpts {
  allowed: (host: string, list: readonly string[]) => boolean;
  refused: (host: string) => Response;
  hosts: string[];
  port: number;
  /** The leaf `sessionCerts` made, PEM: what the gate answers TLS with. */
  tls: { cert: string; key: string };
  log: (line: string) => void;
  /** Where a let-through request goes: the internet, unless a test says otherwise. */
  upstream?: (req: Request) => Promise<Response>;
}

type Peer = { upstream?: ReturnType<typeof Bun.connect> extends Promise<infer S> ? S : never; buf: Buffer; done?: boolean };

const line = (ok: boolean, host: string, verb: string, what: string, status: number, note = "") =>
  `egress  ${ok ? "✅" : "⛔"} ${host.padEnd(28)} ${verb.padEnd(7)} ${what.slice(0, 40).padEnd(40)} ${status}${note ? "  " + note : ""}`;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * This session's CA (`ca.crt`, mounted where the runtime puts its own) and a leaf it signed for `hosts`
 * (`leaf.crt`, `leaf.key`, the gate's), written to `dir` by openssl. `*.example.com` goes in as is.
 */
export function sessionCerts(dir: string, hosts: readonly string[]): { ca: string; cert: string; key: string } {
  const sans = [...new Set(hosts)].map((h) => (IPV4.test(h) ? "IP:" : "DNS:") + h).join(",");
  writeFileSync(join(dir, "x509.cnf"), `[req]\ndistinguished_name = dn\n[dn]\n
[ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n
[leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nauthorityKeyIdentifier = keyid\n${sans ? `subjectAltName = ${sans}\n` : ""}`);
  const f = (n: string) => join(dir, n), cnf = f("x509.cnf");
  const steps = [
    ["req", "-x509", "-config", cnf, "-extensions", "ca", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=rustybuns local gate", "-keyout", f("ca.key"), "-out", f("ca.crt")],
    ["req", "-new", "-config", cnf, "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=rustybuns egress gate", "-keyout", f("leaf.key"), "-out", f("leaf.csr")],
    ["x509", "-req", "-in", f("leaf.csr"), "-CA", f("ca.crt"), "-CAkey", f("ca.key"), "-set_serial", String(Date.now()), "-days", "1", "-extfile", cnf, "-extensions", "leaf", "-out", f("leaf.crt")],
  ];
  for (const a of steps) {
    const r = Bun.spawnSync(["openssl", ...a], { stdout: "ignore", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`--prod-like needs openssl to make this session's CA: ${r.stderr.toString().trim().split("\n").pop()}`);
  }
  return { ca: f("ca.crt"), cert: f("leaf.crt"), key: f("leaf.key") };
}

/** Starts the proxy; returns a stop function. */
export function startGate(o: GateOpts): () => void {
  const upstream = o.upstream ?? ((r: Request) => fetch(r, { redirect: "manual" }));
  /** One request, through the list: the app's refusal, or upstream's answer. */
  const pass = async (req: Request): Promise<Response> => {
    const url = new URL(req.url), host = url.hostname.toLowerCase();
    if (!o.allowed(host, o.hosts)) {
      const r = o.refused(host);
      o.log(line(false, host, req.method, url.pathname, r.status, "not on this binding's list"));
      return r;
    }
    const headers = new Headers();
    for (const [k, v] of req.headers) if (!/^(proxy-|connection$|host$|keep-alive$)/i.test(k)) headers.set(k, v);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    try {
      const r = await upstream(new Request(url, { method: req.method, headers, body, redirect: "manual" }));
      o.log(line(true, host, req.method, url.pathname, r.status));
      // fetch has already decoded the body, so the length and encoding it came with no longer hold.
      const out = new Headers(r.headers);
      out.delete("content-encoding"); out.delete("content-length");
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: out });
    } catch {
      o.log(line(true, host, req.method, url.pathname, 502, "unreachable"));
      return new Response("", { status: 502 });
    }
  };
  // Where an allowed CONNECT's tunnel lands: TLS with the session's leaf, then each request through `pass`.
  const tls = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: o.tls, fetch: pass });
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
        if (method === "CONNECT") {
          const i = target.lastIndexOf(":"), host = (i < 0 ? target : target.slice(0, i)).toLowerCase(), port = i < 0 ? 443 : Number(target.slice(i + 1));
          if (!o.allowed(host, o.hosts)) {
            const r = o.refused(host), body = await r.text();
            o.log(line(false, host, "CONNECT", `:${port}`, r.status, "not on this binding's list"));
            s.write(`HTTP/1.1 ${r.status} Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
            s.end();
            return;
          }
          try {
            p.upstream = await Bun.connect({ hostname: "127.0.0.1", port: tls.port!, socket: {
              data(_u, d) { s.write(d); },
              close() { s.end(); },
              error() { s.end(); },
            } });
          } catch { s.write("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n"); s.end(); return; }
          s.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (rest.length) p.upstream.write(rest);
          return;
        }
        let url: URL;
        try { url = new URL(target); } catch { s.write("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n"); s.end(); return; }
        const headers = new Headers();
        for (const h of head.slice(1)) { const j = h.indexOf(":"); if (j > 0) headers.append(h.slice(0, j).trim(), h.slice(j + 1).trim()); }
        const r = await pass(new Request(url, { method, headers, body: rest.length && method !== "GET" && method !== "HEAD" ? new Uint8Array(rest) : undefined }));
        const body = Buffer.from(await r.arrayBuffer()), out = new Headers(r.headers);
        out.set("content-length", String(body.length)); out.set("connection", "close");
        s.write(`HTTP/1.1 ${r.status} ${r.statusText || "OK"}\r\n${[...out].map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
        s.write(body);
        s.end();
      },
      close(s) { s.data.upstream?.end(); },
    },
  });
  return () => { server.stop(true); tls.stop(true); };
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
  const tls = { cert: await Bun.file(process.env.GATE_CERT!).text(), key: await Bun.file(process.env.GATE_KEY!).text() };
  startGate({ allowed: mod.allowed, refused: mod.refused, hosts: JSON.parse(process.env.GATE_HOSTS ?? "[]"), port: 3128, tls, log: (l) => console.log(l) });
  const f = process.env.FORWARD;
  if (f) { const i = f.lastIndexOf(":"); forward(9000, { hostname: f.slice(0, i), port: Number(f.slice(i + 1)) }); }
  console.log("gate ready");
}
