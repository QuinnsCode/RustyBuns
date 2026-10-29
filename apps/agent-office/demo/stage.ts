// The demo stage: the office's real page scripts (the setup cards, the GitHub writes card, the ask card, the wall
// screens, Ester's badge) on one page, talking to the office's real route handlers (connect/, askfirst/, live/floorguard.ts)
// with a fake GitHub, a keychain that is a temp file, and helpers that replay a fixed run. No GitHub app, 1Password,
// Touch ID or LLM; nothing of the real office is read or written (its data lives in a fresh temp folder per scenario).
// Not part of the shipped office: only `bun run demo` starts it (scripts/demo.ts).
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeCheck } from "../askfirst/ask.ts";
import { addGrants } from "../askfirst/grants.ts";
import { isKind } from "../askfirst/kinds.ts";
import { grantsRoute } from "../askfirst/server.ts";
import { connections } from "../connect/github.ts";
import { fileSecrets } from "../connect/keychain.ts";
import { cameraOf, logFile, record } from "../live/camera.ts";
import { asksRoute, answerAsk, outboundRoute, pendingAsks } from "../live/floorguard.ts";
import { boxRoute } from "../sandbox/server.ts";
import { fakeGitHub } from "./fake-github.ts";
import { RUN_SECONDS, TALLY, helperAt, lineAt, type Timeline } from "./runs.ts";
import { SCENARIOS, isScenario, names, type DemoWorker } from "./scenarios.ts";

const here = import.meta.dir;
const HOLD_MS = 15 * 60_000; // a held ask waits this long: a demo is looked at slowly
const TRUST = "x-rb-ask", TRIAGE = "x-rb-triage";

interface World {
  name: string;
  dir: string;
  gh: ReturnType<typeof fakeGitHub>;
  setup: ReturnType<typeof connections>;
  workers: DemoWorker[];
  log: string[];
  queued: string[];
  helpers: Record<"ester" | "mervin", Timeline>;
}

const toast = () => {};
const LOGIN = "octo-demo";

/** The sign-in codes waiting to be typed, as the setup page sees them. */
async function waiting(w: World): Promise<string[]> {
  const r = await w.setup("GET", new URL("http://stage/__rb/connections"));
  const pending = typeof r?.body === "object" && r.body !== null && "pending" in r.body && Array.isArray(r.body.pending) ? r.body.pending : [];
  return pending.flatMap((p: unknown) => (typeof p === "object" && p !== null && "userCode" in p && typeof p.userCode === "string" ? [p.userCode] : []));
}

async function build(name: string, now = Date.now()): Promise<World> {
  const sc = SCENARIOS[name]!;
  const dir = mkdtempSync(path.join(tmpdir(), "office-demo-"));
  const gh = fakeGitHub(), secrets = fileSecrets(dir);
  const setup = connections({ dir, clientId: sc.signIn ? "Iv1.demo" : "", secrets, fetch: (u, i) => fetch(u, i), web: gh.base, api: gh.base, wait: () => Bun.sleep(400) });
  // accounts are seeded the way a sign-in leaves them: the list on disk, the token in the (temp) secrets
  for (const a of sc.accounts) {
    await secrets.set(a.login, `tok_seed-${a.login}`);
    if (a.good) gh.type(`seed-${a.login}`, a.login);
  }
  if (sc.accounts.length) writeFileSync(path.join(dir, "connections.json"), JSON.stringify(sc.accounts.map((a) => ({ account: a.login, access: a.access ?? "read" }))));
  if (sc.grants.length) addGrants(dir, sc.grants.flatMap((g) => (isKind(g.kind) ? [{ ...g, kind: g.kind }] : [])));
  if (sc.waiting) await setup("POST", new URL("http://stage/__rb/connections?do=github"));
  const timeline = (r: (typeof sc)["ester"]): Timeline => r.phase === "idle" ? { phase: "idle" }
    : r.phase === "running" ? { phase: "running", startedAt: now - (r.age ?? 0) * 1000 }
    : { phase: r.phase, startedAt: now - RUN_SECONDS * 1000 - 5000, endedAt: now - 5000 };
  const w: World = { name, dir, gh, setup, workers: sc.workers.map((x) => ({ ...x })), log: [], queued: [], helpers: { ester: timeline(sc.ester), mervin: timeline(sc.mervin) } };
  if (sc.ask) void push(w, sc.ask.who, sc.ask.command);
  if (sc.box) seedBox(w, sc.box, now);
  return w;
}

const HOSTS = ["registry.npmjs.org:443", "api.anthropic.com:443", "github.com:443", "codeload.github.com:443"];

/** The box's folder as a first run leaves it: only the example permission set, a log of outbound and send-home lines, and one host held. */
function seedBox(w: World, box: { log: number; held?: string }, now: number) {
  copyFileSync(path.join(here, "../sandbox/box.example.json"), path.join(w.dir, "box.example.json"));
  for (let i = 0; i < box.log; i++) {
    const home = i % 7 === 3, at = now - (box.log - i) * 9 * 60_000;
    record(logFile(w.dir), home ? { kind: "home", who: "You", what: `${w.workers[i % w.workers.length]!.name} (cleanup: worktree)`, verdict: "allowed" }
      : { kind: "outbound", who: "box", what: HOSTS[i % HOSTS.length]!, verdict: i % 11 === 5 ? "denied" : "listed" }, cameraOf(w.dir), at);
  }
  // the box's proxy asking, as sandbox/proxy.ts does: the office's own route holds it on the card
  if (box.held) void outboundRoute("POST", new URL("http://stage/__rb/outbound"), "Bearer demo", { host: box.held, port: 443 }, { token: "demo", dir: w.dir, ms: HOLD_MS })
    .then((r) => w.log.push(`The box: ${box.held}:443 => ${r?.body && typeof r.body === "object" && "allow" in r.body && r.body.allow ? "went through" : "held back"}`));
}

/** A worker runs a shell command: the office's own writeCheck decides, and a write waits on the real card. */
async function push(w: World, who: string, command: string) {
  const worker = w.workers.find((x) => x.name === who);
  if (worker) worker.state = "asking";
  const r = await writeCheck(w.dir, "QuinnsCode/RustyBuns", "demo", who, { command }, toast, HOLD_MS);
  if (worker) worker.state = r.allow ? "working" : "idle";
  w.log.push(`${who}: ${command} => ${r.allow ? "went through" : `held: ${r.error}`}`);
}

function finish(w: World, who: "ester" | "mervin", now: number) {
  const t = w.helpers[who], sc = SCENARIOS[w.name]!;
  if (t.phase === "running" && now - (t.startedAt ?? now) > RUN_SECONDS * 1000) w.helpers[who] = { ...t, phase: who === "ester" ? sc.esterEnds : "green", endedAt: (t.startedAt ?? now) + RUN_SECONDS * 1000 };
}

export interface Stage { url: string; port: number; scenario: () => string; stop(): void }

export async function startStage({ scenario, port = 0 }: { scenario: string; port?: number }): Promise<Stage> {
  if (!isScenario(scenario)) throw new Error(`no scenario "${scenario}"; try one of: ${names().join(", ")}`);
  const built = await Bun.build({ entrypoints: [path.join(here, "client.ts")], target: "browser", minify: false });
  if (!built.success) throw new AggregateError(built.logs, "the stage's page script failed to build");
  const client = await built.outputs[0]!.text();
  let world = await build(scenario);
  let switching: Promise<void> = Promise.resolve();

  const go = (name: string) => {
    switching = switching.then(async () => {
      for (const a of pendingAsks()) answerAsk(a.id, false); // asks of the old state would linger in the office's shared list
      const old = world;
      world = await build(name);
      old.gh.stop();
      rmSync(old.dir, { recursive: true, force: true });
    });
    return switching;
  };

  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const server = Bun.serve<{ w: World }>({
    hostname: "127.0.0.1",
    port,
    async fetch(req, srv) {
      const url = new URL(req.url), p = url.pathname, m = req.method;
      if (p === "/") {
        const want = url.searchParams.get("scenario");
        if (want && isScenario(want) && want !== world.name) await go(want);
        return new Response(page(world.name), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      if (p === "/client.js") return new Response(client, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      await switching;
      const w = world, sc = SCENARIOS[w.name]!, now = Date.now();
      if (p === "/__stage/ws") return srv.upgrade(req, { data: { w } }) ? undefined : new Response("websocket", { status: 426 });
      if (p === "/__stage/state") return json({ scenario: w.name, about: sc.about, serves: sc.serves, scenarios: Object.fromEntries(names().map((n) => [n, { about: SCENARIOS[n]!.about, serves: SCENARIOS[n]!.serves }])),
        workers: w.workers, log: w.log, queued: w.queued, waiting: (await waiting(w)).length > 0,
        screens: sc.screens, each: !!sc.each, keep: !!sc.keep, asking: pendingAsks().length });
      if (p === "/__stage/go" && m === "POST") {
        const n = url.searchParams.get("scenario") ?? "";
        if (!isScenario(n)) return json({ error: `scenario is one of ${names().join(", ")}` }, 400);
        await go(n);
        return json({ scenario: n });
      }
      if (p === "/__stage/push" && m === "POST") {
        const who = url.searchParams.get("who") ?? "Gizmo", command = url.searchParams.get("command") ?? "git push origin office/gizmo-221a";
        if (!w.workers.some((x) => x.name === who)) return json({ error: `no worker called ${who}` }, 400);
        void push(w, who, command);
        return json({ ok: true });
      }
      if (p === "/__stage/type" && m === "POST") {
        // the person typing the code at github.com/login/device: the fake GitHub starts accepting it
        const code = (await waiting(w))[0];
        if (!code) return json({ error: "no sign-in is waiting" }, 409);
        w.gh.type(`dev${Number(code.slice(-4))}`, LOGIN);
        return json({ ok: true });
      }
      if (p === "/__rb/connections") {
        const r = await w.setup(m, url);
        return r ? json(r.body, r.status) : json({ error: "No such route" }, 404);
      }
      if (p === "/__rb/grants") {
        const r = grantsRoute(() => w.dir)(m, url, req.headers.get(TRUST) === "1");
        return r ? json(r.body, r.status) : json({ error: "No such route" }, 404);
      }
      if (p.startsWith("/__rb/asks")) {
        const r = asksRoute(m, url, req.headers.get(TRUST) === "1", "You");
        return r ? json(r.body, r.status) : json({ error: "No such route" }, 404);
      }
      if (p === "/__rb/box" && sc.box) {
        const r = await boxRoute(() => w.dir, { host: async () => ({ cpus: 10, memBytes: 32 * 2 ** 30 }),
          health: async () => ({ running: true, status: "running", health: "healthy", answers: true, healthy: true, restart: false }) })(m, url);
        return r ? json(r.body, r.status) : json({ error: "No such route" }, 404);
      }
      if (p === "/__rb/builder") {
        return json({ connections: [{ id: "builder", kind: "builder", account: "q@Build-Mac.local", status: sc.builder === "ok" ? "ok" : "down", access: "read" }],
          setup: "sh scripts/builder-setup.sh", nightly: sc.builder === "ok" ? { at: new Date(now - 9 * 3600_000).toISOString(), results: [{ app: "agent-office", ok: true }, { app: "codesplitter", ok: true }, { app: "skate", ok: false }] } : null });
      }
      if (p === "/__rb/helpers" && m === "GET") {
        finish(w, "ester", now); finish(w, "mervin", now);
        const h = (who: "ester" | "mervin") => helperAt(who, w.helpers[who], sc.esterEnds, !!sc.each, now);
        return json({ ester: h("ester"), mervin: h("mervin"), dexter: { phase: "idle", lines: [], hold: [] }, tally: sc.keep ? TALLY : null });
      }
      const call = p.match(/^\/__rb\/helpers\/(ester|mervin)$/);
      if (call && m === "POST") {
        if (req.headers.get(TRIAGE) !== "1") return json({ error: `Send ${TRIAGE}: 1 with the POST` }, 403);
        const who = call[1] as "ester" | "mervin";
        if (w.helpers[who].phase === "running") return json({ error: "Already on it" }, 409);
        w.helpers[who] = { phase: "running", startedAt: now };
        return json(helperAt(who, w.helpers[who], sc.esterEnds, !!sc.each, now));
      }
      if (p === "/__rb/line") return json(lineAt(now));
      if (p === "/__rb/codesplitter/hold") return json({ prevented: 2, held: [] });
      return json({ error: "No such route in the demo" }, 404);
    },
    websocket: {
      // the wall's Cheap fix button queues a task over the office's socket: the stage just shows what it was sent
      message(ws, raw) {
        try {
          const msg: unknown = JSON.parse(String(raw));
          if (typeof msg === "object" && msg !== null && "t" in msg && msg.t === "queue.add") {
            const t = msg as { title?: unknown; model?: unknown; effort?: unknown };
            ws.data.w.queued.push(`${String(t.title)} (${String(t.model)}, ${String(t.effort)} effort)`);
          }
        } catch {}
      },
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`, port: server.port ?? 0, scenario: () => world.name,
    stop() { server.stop(true); world.gh.stop(); rmSync(world.dir, { recursive: true, force: true }); },
  };
}

const esc = (s: string) => s.replace(/[<&>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page: the localStorage the real scripts read is set first, then the stage's own script brings them all in. */
function page(name: string) {
  const sc = SCENARIOS[name]!;
  const saved = JSON.stringify(Object.fromEntries([...sc.screens.map((s) => [s, true]), ["each", !!sc.each], ["keep", !!sc.keep]]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Office demo: ${esc(name)}</title>
<script>try{localStorage.setItem("rb.screens",${JSON.stringify(saved)});localStorage.setItem("rb.codesplitter",JSON.stringify({repo:"demo/repo"}))}catch{}</script>
</head><body><div id="stage"></div><script src="/client.js"></script></body></html>`;
}
