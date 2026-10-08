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
  const u = /^[a-z]+:\/\//i.test(target) ? new URL(target) : new URL(target, location.href);
  u.protocol = u.protocol === "https:" || u.protocol === "wss:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return new WebSocket(u);
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

/** What an excluded action's proxy does: reject clearly instead of reaching a host that never imported it. */
export function unavailable(module: string, fn: string): Promise<never> {
  return Promise.reject(new Error(`${fn} (${module}) is not available in the desktop build`));
}
