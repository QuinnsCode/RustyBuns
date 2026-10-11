// The office answers only to the names it is known by: the DNS-rebinding guard, belt and braces with its cookie.
//
// A page on evil.example can point evil.example at 127.0.0.1 once it has loaded, and its script then talks to the
// office as "same origin": Origin and Host both say evil.example, so the office's own Origin == Host check passes.
// The Host it sends still says evil.example, though, and no name the office is known by does. Known names:
// localhost (and *.localhost), any IP literal (a rebinding needs a name to rebind), the --host it binds, this
// machine's own name (and <name>.local), AGENT_OFFICE_PUBLIC_HOST, the tailnet (and its <port>.<tailnet> tunnels),
// the names office:phone's tunnels bring (*.ts.net, *.trycloudflare.com: only Tailscale and Cloudflare answer for
// those, so none can be pointed at 127.0.0.1), and AGENT_OFFICE_ALLOWED_HOSTS, comma separated, for any other, a
// named tunnel's --hostname say. Behind --trust-proxy the proxy routes by name, so a rebound name never reaches
// the office: the check stands aside there.
import { hostname as machineName } from "node:os";
import { isIP } from "node:net";

const TUNNELS = [".localhost", ".ts.net", ".trycloudflare.com"];

export interface HostCfg {
  host?: string;
  publicHost?: string;
  tailnet?: string;
  trustProxy?: boolean;
}

/** The name in a Host header, lower case, without its port or an IPv6 literal's brackets; "" when it has none. */
export function hostName(header: string | undefined): string {
  const h = (header ?? "").trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") > 0 ? h.indexOf("]") : undefined);
  return h.replace(/:\d*$/, "").replace(/\.$/, "");
}

export function allowedHosts(cfg: HostCfg, env: Record<string, string | undefined> = process.env): (header: string | undefined) => boolean {
  const names = new Set(["localhost", machineName().toLowerCase(), `${machineName().toLowerCase().replace(/\.local$/, "")}.local`]);
  for (const n of [cfg.host, cfg.publicHost, cfg.tailnet, ...(env.AGENT_OFFICE_ALLOWED_HOSTS ?? "").split(",")]) {
    const name = hostName(n);
    if (name) names.add(name);
  }
  const tailnet = hostName(cfg.tailnet);
  return (header) => {
    if (cfg.trustProxy) return true;
    const name = hostName(header);
    if (!name) return false;
    return names.has(name) || isIP(name) !== 0 || TUNNELS.some((t) => name.endsWith(t)) || (!!tailnet && name.endsWith(`.${tailnet}`));
  };
}

/** For the office's request handler: answers 421 to a name the office isn't known by, else false. */
export function guardHost(cfg: HostCfg) {
  const ok = allowedHosts(cfg);
  return (req: { headers: { host?: string } }, res: { writeHead(s: number, h: Record<string, string>): unknown; end(b: string): unknown }): boolean => {
    if (ok(req.headers.host)) return false;
    res.writeHead(421, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end("This office doesn't answer to that name. Add it to AGENT_OFFICE_ALLOWED_HOSTS to let it in.\n");
    return true;
  };
}

/** For its WebSocket upgrades: closes the socket on a name the office isn't known by, and says whether it did. */
export function guardUpgrade(cfg: HostCfg) {
  const ok = allowedHosts(cfg);
  return (req: { headers: { host?: string } }, socket: { write(s: string): unknown; destroy(): unknown }): boolean => {
    if (ok(req.headers.host)) return false;
    socket.write("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  };
}
