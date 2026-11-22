// codeSplitter over ssh://, the spike (#5500): a TCP client reaches this Worker's `connect()` handler, the Worker pipes
// the bytes to a Durable Object, and the DO pipes them into its container, where `sshd` and `git-serve.sh` bridge
// git to the repo's smart-HTTP remote (Artifacts), so the container keeps no repos (#5505).
// Run it with `bun ssh/try.ts` from apps/codesplitter. The findings are in ssh/README.md.
//
// The Worker sees only encrypted SSH bytes, so it can't tell which repo a connection asks for. It sends every
// connection to one DO (`GATE`) and its container. The repo path is read inside the container (`git-serve.sh`).
//
// Keys (#5504): sshd asks whose each offered key is (`authorized-keys.sh`, its AuthorizedKeysCommand). That request
// is plain HTTP to 192.0.2.1, which the DO routes to `KeyLookup` below; it asks codeSplitter's GET /api/ssh/key,
// reads the reply through the guard codeSplitter answers with, and writes the authorized_keys line.

import { check } from "@rustybuns/util/guard";
import { SshKeyOwner } from "../src/ssh-key.ts";

/** The bits of a `cloudflare:sockets` socket this file uses. */
interface Socket {
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
interface Env {
  GATE: { getByName(name: string): { connect(address: string, opts?: SocketOptions): Socket } };
  /** codeSplitter's origin, whose GET /api/ssh/key says whose a key is (#5504). */
  CODESPLITTER_URL: string;
  /** Where git-serve.sh asks for a repo's smart-HTTP remote and a token for the user (#5505), and the secret it shows. */
  LOOKUP_URL: string;
  GATE_SECRET: string;
}

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

/**
 * The authorized_keys line for the key with this fingerprint, or a 404 when nobody added it. The key and the user
 * come back from codeSplitter through SshKeyOwner's guard, which takes only a handle and `type base64`, so neither
 * can break out of the line or the forced command.
 */
export const KeyLookup = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const fp = new URL(req.url).searchParams.get("fingerprint") ?? "";
    const res = await fetch(`${env.CODESPLITTER_URL}/api/ssh/key?fingerprint=${encodeURIComponent(fp)}`);
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
    // The internet is on so git-serve.sh can reach the lookup and the repo's HTTP remote (#5505). A Worker binding back
    // instead would keep the container off the internet; that waits on rustybuns carrying this app (see README).
    const { LOOKUP_URL, GATE_SECRET } = this.env;
    if (!container.running) {
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

export default {
  async connect(socket: Socket, env: Env): Promise<void> {
    const { remoteAddress } = await socket.opened;
    console.log(`ssh in from ${remoteAddress ?? "?"}`);
    const gate = env.GATE.getByName("git").connect(`gate:${SSHD}`, OPTS);
    await gate.opened;
    await splice(socket, gate);
  },
  fetch(): Response {
    return new Response("codeSplitter ssh spike: git over ssh:// on the connect port, nothing on HTTP\n");
  },
};
