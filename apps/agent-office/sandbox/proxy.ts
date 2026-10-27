// The egress proxy beside the box (network: "allowlist"): the box has no route out, so everything it reaches goes through here.
// Runs in its own container (`bun /proxy.ts`, mounted read-only by box.ts), with no imports so it needs nothing installed.
//   ALLOW=host,*.suffix   the only hosts a CONNECT may name (HTTPS only: that is what the model, GitHub and registries speak)
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

if (import.meta.main) {
  const list = (process.env.ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  net.createServer((client) => {
    client.once("data", (chunk: Buffer) => {
      const head = chunk.toString("latin1");
      const t = connectTarget(head);
      if (!t || t.port !== 443 || !allowed(t.host, list)) {
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
