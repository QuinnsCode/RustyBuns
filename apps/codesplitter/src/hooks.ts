// Layout: outgoing webhooks: the owner's hooks, signed deliveries, the log, retries
// Outgoing webhooks: tell the outside world (CI, a chat bot) when something
// happens in a repo. The owner adds a URL per hook, picks its events, and gets
// a secret; every delivery is a POST of GitHub-shaped JSON, signed with
// HMAC-SHA256 of the body in `X-CodeSplitter-Signature: sha256=<hex>`, the way
// GitHub signs `X-Hub-Signature-256`.
//
//   commit           main was catalogued and pushed to git (GitHub's `push`)
//   branch.opened    a branch was opened (GitHub's `create`)
//   branch.merged    a branch merged into main (a merged `pull_request`)
//   deploy.finished  a real deploy finished, either way (`deployment_status`)
//   check_run        a check run started or finished, here or on GitHub (`check_run`, checks.ts)
//
// A hook made with `github_compat: true` speaks GitHub instead, so a receiver
// built for GitHub (Jenkins, Buildkite, Argo Events, Tekton) triggers on it as
// is: GitHub's event names in `X-GitHub-Event`, `X-GitHub-Delivery`, the
// signature in `X-Hub-Signature-256`, and the fields those receivers read
// (`commits`, `repository.clone_url` at our git remote, `pull_request.state`).
//
// Every delivery is logged, and every try is a message on the HOOKS queue
// (Cloudflare Queues; sqlite in the desktop's own process): the first goes out
// at once, and a failed one books the next on the queue after 1, 5, 30 and 120
// minutes, then is given up.
//
// A hook's URL can't point inside the network the app runs in (#648): loopback,
// RFC 1918, link-local (cloud metadata), CGNAT and IPv6's private ranges are refused
// when it's added. On Workers they're unreachable anyway; on the desktop the app runs
// on someone's machine, where they're not. There each delivery also looks the host up
// first and isn't sent if any address it has is private, so a public name pointed
// inward is caught too (a name that changes its answer between the lookup and the send
// still gets through: the desktop's own network is the last line).
//
//   GET    /api/repos/:o/:r/hooks                           the hooks, each with its last delivery (owner only)
//   POST   /api/repos/:o/:r/hooks                           {url, events?, secret?, github_compat?}: the secret is shown this once
//   DELETE /api/repos/:o/:r/hooks/:id
//   GET    /api/repos/:o/:r/hooks/:id/deliveries            the last 20
//   POST   /api/repos/:o/:r/hooks/:id/deliveries/:d/redeliver

import { audit } from "./audit.ts";
import { fail, json, type Env, need, readBody } from "./env.ts";
import { arr, bool, obj, oneOf, opt, raw, str } from "@rustybuns/util/guard";
import { repoRow } from "./repos.ts";
import { hex, hmacHex } from "./util.ts";

export const EVENTS = ["commit", "branch.opened", "branch.merged", "deploy.finished", "check_run"] as const;
export type Event = (typeof EVENTS)[number];
/** Minutes to wait after each failed try; past the last one, the delivery is given up. */
const BACKOFF = [1, 5, 30, 120];
const MAX_HOOKS = 10;
/** What GitHub calls each event, for a hook in GitHub mode. */
export const GITHUB_EVENT: Record<Event, string> = {
  commit: "push", "branch.opened": "create", "branch.merged": "pull_request", "deploy.finished": "deployment_status", check_run: "check_run",
};

/** A message on the queue: try `id` again, as its try number `n + 1`. */
export interface HookMessage { id: string; n: number }

export async function sign(secret: string, body: string) {
  return "sha256=" + await hmacHex(secret, body);
}

interface Delivery { id: string; event: string; payload: string; attempts: number }

const v4 = (h: string) => /^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.split(".").map(Number) : null;

/** Whether `host` (a URL's hostname, or an address) is loopback, private, link-local or otherwise not out on the internet. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const a = v4(h);
  if (a) {
    const [x, y] = a as [number, number];
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || (x === 192 && y === 0 && a[2] === 0) || (x === 198 && (y === 18 || y === 19));
  }
  if (!h.includes(":")) return false;
  const g = v6(h);
  if (!g) return true; // not an address we can read: not one to send to
  const tail = (i: number) => privateHost([g[i]! >> 8, g[i]! & 255, g[i + 1]! >> 8, g[i + 1]! & 255].join("."));
  const zero = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::/96 (unspecified, loopback, IPv4-compatible), ::ffff:0:0/96 (mapped), ::ffff:0:0:0/96 (translated) and
  // 64:ff9b::/96 (NAT64) carry an IPv4 address that may be inward; so does 6to4 (2002::/16).
  if (zero(6) || (zero(5) && g[5] === 0xffff) || (zero(4) && g[4] === 0xffff && g[5] === 0)) return zero(6) && g[6] === 0 && g[7]! <= 1 ? true : tail(6);
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g.slice(3, 6).every((x) => x === 0) ? tail(6) : true;
  if (g[0] === 0x2002) return tail(1);
  // Anything else under ::/8 is reserved; fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 site-local,
  // ff00::/8 multicast, 2001::/32 Teredo (an IPv4 address inside, obscured) and 2001:db8::/32 documentation.
  return g[0]! < 0x100 || (g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0 || g[0]! >= 0xff00
    || (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8));
}

/** An IPv6 address as its eight 16-bit groups, a dotted IPv4 tail included; null when it isn't one. */
function v6(h: string): number[] | null {
  let s = h.replace(/%.*$/, "");
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const a = v4(dotted[2]!);
    if (!a || a.some((x) => x > 255)) return null;
    s = dotted[1] + ((a[0]! << 8) | a[1]!).toString(16) + ":" + ((a[2]! << 8) | a[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x: string) => (x ? x.split(":") : []);
  const [head, rest] = [part(halves[0]!), halves.length === 2 ? part(halves[1]!) : null];
  const groups = rest ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest] : head;
  if (groups.length !== 8 || (rest && head.length + rest.length > 7) || groups.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return groups.map((x) => parseInt(x, 16));
}

/** On the desktop: whether `url`'s host resolves to a private address. A name that doesn't resolve isn't, and fails on its own. */
async function resolvesInward(url: string) {
  if (typeof Bun === "undefined") return false;
  const host = new URL(url).hostname;
  if (privateHost(host)) return true;
  try {
    const { lookup } = await import("node:dns/promises");
    return (await lookup(host.replace(/^\[|\]$/g, ""), { all: true })).some((r) => privateHost(r.address));
  } catch { return false; }
}

/** One try: POST it and log the answer. Says how many seconds until the next try, or null when there's none. */
async function attempt(env: Env, d: Delivery, url: string, secret: string, github: boolean) {
  const send = (env.HOOK_FETCH as typeof fetch | undefined) ?? fetch;
  let code = 0, response = "";
  try {
    if (await resolvesInward(url)) throw new Error("refused: the hook's host is a private address");
    const res = await send(url, {
      method: "POST",
      body: d.payload,
      headers: github ? {
        "content-type": "application/json",
        "user-agent": "GitHub-Hookshot/codeSplitter",
        "x-github-event": d.event,
        "x-github-delivery": d.id,
        "x-hub-signature-256": await sign(secret, d.payload),
      } : {
        "content-type": "application/json",
        "user-agent": "codeSplitter-Hookshot",
        "x-codesplitter-event": d.event,
        "x-codesplitter-delivery": d.id,
        "x-codesplitter-signature": await sign(secret, d.payload),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    code = res.status;
    response = (await res.text().catch(() => "")).slice(0, 1000);
  } catch (e) {
    response = (e as Error).message.slice(0, 1000);
  }
  const ok = code >= 200 && code < 300, tries = d.attempts + 1;
  const status = ok ? "ok" : tries > BACKOFF.length ? "failed" : "pending";
  const wait = status === "pending" ? BACKOFF[tries - 1]! * 60 : null;
  await env.DB.prepare("UPDATE webhook_deliveries SET status = ?, attempts = ?, next_at = ?, code = ?, response = ? WHERE id = ?")
    .bind(status, tries, wait === null ? null : Date.now() + wait * 1000, code, response, d.id).run();
  return wait;
}

/**
 * `data` the way GitHub would send it: the fields receivers built for GitHub read
 * that the native payload leaves out. A commit is the one commit of its push.
 */
function githubShaped(event: Event, data: Record<string, any>, repository: Record<string, unknown>): Record<string, unknown> {
  if (event === "commit") {
    const head = data.head_commit && { ...data.head_commit, tree_id: null, distinct: true, committer: data.head_commit.author };
    return { ...data, deleted: false, forced: false, base_ref: null, compare: null, commits: head ? [head] : [], head_commit: head ?? null };
  }
  if (event === "branch.opened") return { ...data, pusher_type: "user", description: null };
  if (event === "branch.merged") {
    const pr = data.pull_request;
    return { ...data, pull_request: { ...pr, state: "closed", title: pr.head.ref, head: { ...pr.head, repo: repository }, base: { ...pr.base, repo: repository } } };
  }
  return data;
}

/** Something happened in owner/repo: log a delivery to every hook that wants it, and queue their first tries. */
export async function emit(env: Env, owner: string, repo: string, event: Event, sender: string, data: Record<string, unknown>) {
  try {
    const { results } = await env.DB.prepare("SELECT id, url, secret, events, github_compat, owner_only FROM webhooks WHERE owner = ? AND repo = ?").bind(owner, repo).all<{ id: string; url: string; secret: string; events: string; github_compat: number; owner_only: number }>();
    // An owner_only hook hears the owner's own work, not a crew member's or an agent's (a CI that builds it runs with the owner's secrets).
    const theirs = sender !== owner || sender.startsWith("agent-") || String(data.ref ?? "").startsWith("agent-run-");
    const hooks = results.filter((h) => h.events.split(",").includes(event) && !(h.owner_only && theirs));
    if (!hooks.length) return;
    const r = await repoRow(env, owner, repo, "visibility, artifact_remote");
    const repository = { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner }, private: r?.visibility === "private", default_branch: "main" };
    const payload = JSON.stringify({ ...data, repository, sender: { login: sender } });
    // GitHub's receivers fetch the sha from `clone_url`: our git remote (a private repo's wants a token).
    const ghRepo = { ...repository, master_branch: "main", clone_url: (r?.artifact_remote as string | null) ?? null, git_url: (r?.artifact_remote as string | null) ?? null };
    const ghPayload = hooks.some((h) => h.github_compat) ? JSON.stringify({ ...githubShaped(event, data, ghRepo), repository: ghRepo, sender: { login: sender } }) : "";
    const now = Date.now();
    const ids = hooks.map(() => crypto.randomUUID());
    await env.DB.batch(hooks.map((hook, i) => env.DB.prepare("INSERT INTO webhook_deliveries (id, hook, owner, repo, event, payload, status, next_at, at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .bind(ids[i], hook.id, owner, repo, hook.github_compat ? GITHUB_EVENT[event] : event, hook.github_compat ? ghPayload : payload, now, now)));
    await env.HOOKS.sendBatch(ids.map((id) => ({ body: { id, n: 0 } satisfies HookMessage })));
  } catch {
    // A hook never gets in the way of what happened.
  }
}

/**
 * The HOOKS queue's consumer: each message is one try. A message is stale once
 * its delivery has moved on (tried since, redelivered, or finished), and whoever
 * claims the delivery's next_at sends it, so a message the queue hands out twice
 * is sent once.
 */
export async function deliverHooks(batch: { messages: readonly { body: HookMessage; ack(): void }[] }, env: Env) {
  await Promise.all(batch.messages.map(async (m) => {
    const { id, n } = m.body;
    const d = await env.DB.prepare(`SELECT d.id, d.event, d.payload, d.attempts, d.next_at, h.url, h.secret, h.github_compat FROM webhook_deliveries d
      LEFT JOIN webhooks h ON h.id = d.hook WHERE d.id = ? AND d.status = 'pending' AND d.attempts = ?`).bind(id, n).first<Delivery & { next_at: number | null; url: string | null; secret: string | null; github_compat: number | null }>();
    if (d && !d.url) await env.DB.prepare("UPDATE webhook_deliveries SET status = 'failed', next_at = NULL, response = 'hook deleted' WHERE id = ?").bind(id).run();
    else if (d && d.next_at !== null) {
      const claim = await env.DB.prepare("UPDATE webhook_deliveries SET next_at = NULL WHERE id = ? AND attempts = ? AND next_at = ? AND status = 'pending'").bind(id, n, d.next_at).run();
      if (claim.meta?.changes) {
        const wait = await attempt(env, d, d.url!, d.secret!, !!d.github_compat);
        if (wait !== null) await env.HOOKS.send({ id, n: n + 1 } satisfies HookMessage, { delaySeconds: wait });
      }
    }
    m.ack();
  }));
}

function checkUrl(u: unknown) {
  try {
    const url = new URL(String(u));
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !privateHost(url.hostname) ? url.toString() : null;
  } catch { return null; }
}

export async function hookRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "repos" && p[2] && p[3] && p[4] === "hooks")) return null;
  const [owner, repo, id] = [p[2], p[3], p[5]];
  // Hooks carry a secret and say what happens in the repo: the owner's alone.
  if (user !== owner) return fail("OwnerOnly", "only the repo's owner can manage its webhooks");
  if (!(await repoRow(env, owner, repo, "1"))) return fail("NoSuchRepo", "not found");

  if (!id && req.method === "GET") {
    const { results } = await env.DB.prepare(`SELECT h.id, h.url, h.events, h.github_compat, h.owner_only, h.created_at,
      (SELECT json_object('event', d.event, 'status', d.status, 'code', d.code, 'at', d.at) FROM webhook_deliveries d WHERE d.hook = h.id ORDER BY d.at DESC LIMIT 1) AS last
      FROM webhooks h WHERE h.owner = ? AND h.repo = ? ORDER BY h.created_at`).bind(owner, repo).all<any>();
    return json({ events: EVENTS, hooks: results.map((h) => ({ ...h, events: h.events.split(","), github_compat: !!h.github_compat, owner_only: !!h.owner_only, last: h.last ? JSON.parse(h.last) : null })) });
  }
  if (!id && req.method === "POST") {
    const b = need(await readBody(req), obj({ url: raw, events: opt(arr(oneOf(EVENTS), 100, { min: 1 })), secret: opt(str(1000, { min: 16 })), github_compat: opt(bool()), owner_only: opt(bool()) }));
    if (b instanceof Response) return b;
    const url = checkUrl(b.url), events = b.events ?? [...EVENTS];
    if (!url) return fail("BadInput", "url: an http(s) URL out on the internet (not a private or loopback address), without a password in it");
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM webhooks WHERE owner = ? AND repo = ?").bind(owner, repo).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_HOOKS) return fail("TooManyWebhooks", `a repo has at most ${MAX_HOOKS} webhooks`);
    const hook = { id: crypto.randomUUID().slice(0, 8), url, events: [...new Set(events)], secret: b.secret ?? hex(crypto.getRandomValues(new Uint8Array(24)).buffer), github_compat: b.github_compat ?? false, owner_only: b.owner_only ?? false, created_at: Date.now() };
    await env.DB.prepare("INSERT INTO webhooks (id, owner, repo, url, secret, events, github_compat, owner_only, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(hook.id, owner, repo, hook.url, hook.secret, hook.events.join(","), hook.github_compat ? 1 : 0, hook.owner_only ? 1 : 0, hook.created_at).run();
    await audit(env, req, { actor: user, action: "hook.create", owner, repo, target: hook.id, detail: new URL(hook.url).host });
    return json(hook, 201);
  }

  const hook = id && await env.DB.prepare("SELECT id, url, secret FROM webhooks WHERE id = ? AND owner = ? AND repo = ?").bind(id, owner, repo).first();
  if (!hook) return fail("NoSuchWebhook", "no such webhook");
  if (!p[6] && req.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM webhook_deliveries WHERE hook = ?").bind(id),
    ]);
    await audit(env, req, { actor: user, action: "hook.delete", owner, repo, target: id, detail: new URL(hook.url as string).host });
    return json({ ok: true });
  }
  if (p[6] === "deliveries" && !p[7] && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, event, status, attempts, next_at, code, response, payload, at FROM webhook_deliveries WHERE hook = ? ORDER BY at DESC LIMIT 20").bind(id).all();
    return json(results);
  }
  if (p[6] === "deliveries" && p[7] && p[8] === "redeliver" && req.method === "POST") {
    const d = await env.DB.prepare("SELECT id FROM webhook_deliveries WHERE id = ? AND hook = ?").bind(p[7], id).first();
    if (!d) return fail("NoSuchDelivery", "no such delivery");
    // A fresh run of tries, starting now; messages left from the last run are stale.
    await env.DB.prepare("UPDATE webhook_deliveries SET status = 'pending', attempts = 0, next_at = ? WHERE id = ?").bind(Date.now(), d.id).run();
    await env.HOOKS.send({ id: d.id as string, n: 0 } satisfies HookMessage);
    return json({ ok: true }, 202);
  }
  return null;
}
