// The egress proxy beside the box (network: "allowlist"): the box has no route out, so everything it reaches goes through here.
// Runs in its own container (`bun /proxy.ts`, mounted read-only by box.ts), with no imports so it needs nothing installed.
//   ALLOW=host,*.suffix   the only hosts a CONNECT may name (HTTPS only: that is what the model, GitHub and registries speak)
//   ASK_URL, OUTBOUND_TOKEN   ask the office (live/floorguard.ts outboundRoute) about hosts not on the list, and report the ones that are
//   FORWARD=host:port     also relays the port the host published to the box, so the page stays reachable on 127.0.0.1
import net from "node:net";

/** A host is allowed when the list names it, or names `*.suffix` and it's a subdomain of that. */
export function allowed(host: string, list: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return list.some((a) => (a.startsWith("*.") ? h.endsWith(a.slice(1).toLowerCase()) : h === a.toLowerCase()));
}

/** The host and port a `CONNECT host:port HTTP/1.1` line asks for, or null for anything else. */
export function connectTarget(head: string): { host: string; port: number } | null {
  const m = /^CONNECT ([^\s:]+):(\d{1,5}) HTTP\/1\.[01]\r?\n/.exec(head);
  return m && Number(m[2]) <= 65535 ? { host: m[1]!, port: Number(m[2]) } : null;
}

/**
 * Whether the box may tunnel to `host`. With the office to ask (ASK_URL), a listed host goes through and is only reported
 * for the log; any other waits on a person's Allow / Deny there, and is turned down if the office can't be reached.
 */
export async function mayReach(host: string, port: number, list: string[], office?: { url: string; token: string }): Promise<boolean> {
  const listed = allowed(host, list);
  if (!office || listed) return ask(host, port, listed, office);
  // one card per host: connections that arrive while it waits share its answer, and an Allow holds for ten minutes
  const key = `${host}:${port}`, hit = answers.get(key);
  if (hit && hit.until > Date.now()) return hit.answer;
  const answer = ask(host, port, listed, office);
  answers.set(key, { answer, until: Date.now() + 600_000 });
  if (!(await answer)) answers.set(key, { answer, until: Date.now() + 2_000 });
  return answer;
}

const answers = new Map<string, { answer: Promise<boolean>; until: number }>();

async function ask(host: string, port: number, listed: boolean, office?: { url: string; token: string }): Promise<boolean> {
  if (!office) return listed;
  try {
    const res = await fetch(office.url, { method: "POST", headers: { authorization: `Bearer ${office.token}`, "content-type": "application/json" },
      body: JSON.stringify({ host, port, listed }), signal: AbortSignal.timeout(130_000) });
    const answer: unknown = await res.json();
    return listed || (typeof answer === "object" && answer !== null && "allow" in answer && answer.allow === true);
  } catch {
    return listed;
  }
}

if (import.meta.main) {
  const office = process.env.ASK_URL && process.env.OUTBOUND_TOKEN ? { url: process.env.ASK_URL, token: process.env.OUTBOUND_TOKEN } : undefined;
  const list = (process.env.ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  net.createServer((client) => {
    client.once("data", async (chunk: Buffer) => {
      const head = chunk.toString("latin1");
      const t = connectTarget(head);
      if (!t || t.port !== 443 || !(await mayReach(t.host, t.port, list, office))) {
        console.log(`denied ${head.split("\r")[0]?.slice(0, 120)}`);
        client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const up = net.connect(t.port, t.host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = chunk.subarray(chunk.indexOf("\r\n\r\n") + 4);
        if (rest.length) up.write(rest);
        client.pipe(up).pipe(client);
      });
      up.on("error", () => client.destroy());
      client.on("error", () => up.destroy());
    });
    client.on("error", () => {});
  }).listen(3128);
  const to = process.env.FORWARD?.split(":");
  if (to?.[0]) {
    net.createServer((c) => {
      const up = net.connect(Number(to[1]), to[0]!);
      c.pipe(up).pipe(c);
      up.on("error", () => c.destroy());
      c.on("error", () => up.destroy());
    }).listen(4600);
  }
}
