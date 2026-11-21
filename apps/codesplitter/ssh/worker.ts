// codeSplitter over ssh://, the spike (#5500): a TCP client reaches this Worker's `connect()` handler, the Worker pipes
// the bytes to a Durable Object, and the DO pipes them into its container, where `sshd` and `git-shell` serve git.
// Run it with `bun ssh/try.ts` from apps/codesplitter. The findings are in ssh/README.md.
//
// The Worker sees only encrypted SSH bytes, so it can't tell which repo a connection asks for. It sends every
// connection to one DO (`GATE`) and its container. The repo path is read inside the container (`git-serve.sh`).

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
  getTcpPort(port: number): { connect(address: string, opts?: SocketOptions): Socket };
}
interface Env {
  GATE: { getByName(name: string): { connect(address: string, opts?: SocketOptions): Socket } };
  /** The one public key let in, for the spike. Step 2 of #5500 swaps it for a lookup of codeSplitter users' keys. */
  AUTHORIZED_KEY: string;
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

/** The DO in front of the git container: starts it if it is asleep, then joins the client's socket to sshd. */
export class SshGate {
  constructor(private ctx: { container?: ContainerApi }, private env: Env) {}

  async connect(socket: Socket): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("SshGate has no container");
    if (!container.running) container.start({ enableInternet: false, env: { AUTHORIZED_KEY: this.env.AUTHORIZED_KEY } });
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
