// git over ssh:// (#5500, #6195): a TCP client reaches codeSplitter's `connect()` (worker.ts's default export, port
// 8788 locally, a Spectrum app on the edge), which pipes the bytes to the SshGate Durable Object, which pipes them into
// its container, where `sshd` and `git-serve.sh` (ssh/) bridge git to the repo's smart-HTTP remote (Artifacts), so the
// container keeps no repos (#5505). Bound only with CODESPLITTER_SSH=1. `bun ssh/try.ts` proves it; ssh/README.md has the findings.
//
// The Worker sees only encrypted SSH bytes, so it can't tell which repo a connection asks for. It sends every
// connection to one DO and its container. The repo path is read inside the container (`git-serve.sh`).
//
// Keys (#5504): sshd asks whose each offered key is (`authorized-keys.sh`, its AuthorizedKeysCommand). That request
// is plain HTTP to 192.0.2.1, which the DO routes to `KeyLookup` below; it asks GET /api/ssh/key in this Worker,
// reads the reply through the guard that route answers with, and writes the authorized_keys line.

import { check } from "@rustybuns/util/guard";
import type { Env } from "./env.ts";
import { SshKeyOwner } from "./ssh-key.ts";
import { sshKeyRoutes } from "./ssh-keys.ts";

/** The bits of a `cloudflare:sockets` socket this file uses. */
export interface Socket {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly opened: Promise<{ remoteAddress?: string; localAddress?: string }>;
  close(): Promise<void>;
}
type SocketOptions = { allowHalfOpen: boolean; secureTransport: "off" };
interface ContainerApi {
  readonly running: boolean;
  start(opts?: { env?: Record<string, string>; enableInternet?: boolean }): void;
  interceptOutboundHttp(addr: string, binding: unknown): Promise<void>;
  getTcpPort(port: number): { connect(address: string, opts?: SocketOptions): Socket };
}
/** The SSH_GATE binding: the one gate object, dialled like a socket. */
export interface SshGateNamespace { getByName(name: string): { connect(address: string, opts?: SocketOptions): Socket } }

const SSHD = 2222;
// allowHalfOpen: git closes its side of the pipe when it has sent everything, then still reads the reply.
const OPTS: SocketOptions = { allowHalfOpen: true, secureTransport: "off" };

/** Pipe two sockets into each other until both directions end, then close both. */
async function splice(a: Socket, b: Socket): Promise<void> {
  try {
    await Promise.all([a.readable.pipeTo(b.writable), b.readable.pipeTo(a.writable)]);
  } finally {
    await Promise.allSettled([a.close(), b.close()]);
  }
}

/**
 * Dial sshd in the container, waiting until it says its `SSH-2.0-...` banner. A cold container's port takes the
 * connection before sshd listens and then drops it, so an open socket alone doesn't mean sshd is up. sshd always
 * speaks first, so its first bytes are the proof. They are handed back to be sent on to the client.
 */
async function dialSshd(container: ContainerApi): Promise<{ up: Socket; banner: Uint8Array }> {
  for (let i = 0; i < 100; i++) {
    const up = container.getTcpPort(SSHD).connect(`10.0.0.1:${SSHD}`, OPTS);
    try {
      await up.opened;
      const reader = up.readable.getReader();
      const first = await reader.read();
      reader.releaseLock();
      if (!first.done && first.value.length > 0) return { up, banner: first.value };
    } catch {
      // not listening yet
    }
    await up.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("sshd in the container never answered");
}

/** Where authorized-keys.sh asks: a documentation address (RFC 5737) nothing routes to, caught by the DO. */
const KEYS_ADDR = "192.0.2.1:80";

/** GET /api/ssh/key for this fingerprint: this Worker's own route, or SSH_KEYS_URL's when set (ssh/try.ts's stand-in). */
function askKey(env: Env, fp: string): Promise<Response> {
  const path = `/api/ssh/key?fingerprint=${encodeURIComponent(fp)}`;
  if (env.SSH_KEYS_URL) return fetch(`${env.SSH_KEYS_URL}${path}`);
  const url = new URL(path, "https://codesplitter.internal");
  return sshKeyRoutes(new Request(url), env, ["api", "ssh", "key"], url, null).then((r) => r ?? new Response("", { status: 404 }));
}

/**
 * The authorized_keys line for the key with this fingerprint, or a 404 when nobody added it. The key and the user
 * come back through SshKeyOwner's guard, which takes only a handle and `type base64`, so neither can break out of
 * the line or the forced command.
 */
export const KeyLookup = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await askKey(env, new URL(req.url).searchParams.get("fingerprint") ?? "");
    if (res.status === 404 || res.status === 400) return new Response("", { status: 404 });
    const owner = res.ok ? check(SshKeyOwner, await res.json().catch(() => null)) : null;
    if (!owner) return new Response(`codeSplitter's key lookup answered ${res.status}\n`, { status: 502 });
    const opts = "no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty";
    return new Response(`command="/git-serve.sh ${owner.user}",${opts} ${owner.key}\n`);
  },
};

/** The DO in front of the git container: starts it if it is asleep, then joins the client's socket to sshd. */
export class SshGate {
  constructor(private ctx: { container?: ContainerApi; exports?: { KeyLookup?: (opts: { props: object }) => unknown } }, private env: Env) {}

  async connect(socket: Socket): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("SshGate has no container");
    if (!container.running) {
      const GATE_SECRET = this.env.SSH_GATE_SECRET;
      if (!GATE_SECRET) throw new Error("SshGate needs SSH_GATE_SECRET, the bearer git-serve.sh shows GET /api/ssh/remote");
      // git-serve.sh asks for each repo's remote and a token here (ssh-remote.ts). The internet is on so it can reach
      // that and the repo's HTTP remote (#5505); the site's own origin unless SSH_LOOKUP_URL says otherwise (try.ts).
      const LOOKUP_URL = this.env.SSH_LOOKUP_URL ?? `${this.env.BETTER_AUTH_URL ?? ""}/api/ssh/remote`;
      // sshd's key lookups go to KEYS_ADDR, which only KeyLookup answers. Set before start, like egress.ts.
      const lookup = this.ctx.exports?.KeyLookup?.({ props: {} });
      if (!lookup) throw new Error("SshGate needs ctx.exports.KeyLookup to look keys up");
      await container.interceptOutboundHttp(KEYS_ADDR, lookup);
      container.start({ enableInternet: true, env: { LOOKUP_URL, GATE_SECRET } });
    }
    const { up, banner } = await dialSshd(container);
    const writer = socket.writable.getWriter();
    await writer.write(banner);
    writer.releaseLock();
    await splice(socket, up);
  }
}

/** worker.ts's `connect()`: every inbound TCP connection goes to the one gate, or is closed when there is none. */
export async function sshConnect(socket: Socket, env: Env): Promise<void> {
  if (!env.SSH_GATE) { await socket.close(); return; }
  const gate = env.SSH_GATE.getByName("git").connect(`gate:${SSHD}`, OPTS);
  await gate.opened;
  await splice(socket, gate);
}
