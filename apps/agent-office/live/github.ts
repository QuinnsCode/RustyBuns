// The office's GitHub boards, kept fresh without the refresh button.
//
// Upstream lists issues and PRs every 90s (10 min on an idle floor), and only its own buttons look again
// sooner. Up to three things on top, all on the office's machine, with no public URL:
//
// - a worker's own `gh pr merge`, `gh issue close`, `git push`… (seen by the PostToolUse hook) looks again
//   a moment later, and once more after GitHub's lists have caught up;
// - while a floor is busy, a conditional request every few seconds asks GitHub whether anything changed:
//   the repo's most recently updated issue or PR, and the check suites of open PRs whose CI is running.
//   An unchanged answer is a 304, which costs no rate limit, so the full `gh` lists run only on a change;
// - with AGENT_OFFICE_WEBHOOKS=1, `gh webhook forward` relays the repo's webhooks to a localhost port, so any
//   change, from anyone, on any floor, busy or idle, looks again within about a second. It needs the
//   cli/gh-webhook extension and repo admin, and GitHub runs one forwarder per repo; while it's up the watch
//   above stands down, and when it can't start or drops, the watch carries on and it tries again later.
import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** How often a busy floor asks GitHub whether anything changed. */
export const WATCH_MS = 10_000;
/** A worker's gh command is looked at once it's settled… */
export const SETTLE_MS = 1_500;
/** …and again after this, since GitHub's lists lag a write by a few seconds. */
export const AGAIN_MS = 5_000;
/** After GitHub says no (no token, a repo it can't see), the watch rests this long. */
export const REST_MS = 10 * 60_000;
/** The most open PRs with running CI watched at once. */
export const MAX_HEADS = 10;
/** A webhook's change is already in, so it's looked at almost at once (a burst of events is one look). */
export const HEARD_MS = 300;
/** The webhook events the boards care about. */
export const EVENTS = ["issues", "issue_comment", "pull_request", "pull_request_review", "check_suite"];

export interface Touch {
  issues: boolean;
  pulls: boolean;
}

const GH_WRITE = /\bgh\s+(pr|issue)\s+(create|merge|close|reopen|edit|comment|review|ready|lock|unlock|delete|transfer|develop|pin|unpin)\b/g;
const GH_API_WRITE = /\bgh\s+api\b[^\n;&|]*(?:-X|--method)[\s=]*(POST|PATCH|PUT|DELETE)\b/i;
const GIT_PUSH = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?push\b/;

/** Which boards a worker's shell command can have changed, or undefined for none. */
export function touches(command: unknown): Touch | undefined {
  if (typeof command !== "string") return undefined;
  const t: Touch = { issues: false, pulls: false };
  for (const m of command.matchAll(GH_WRITE)) {
    if (m[1] === "issue") t.issues = true;
    // a PR closing "Fixes #12" closes the issue too
    else t.pulls = t.issues = true;
  }
  if (GH_API_WRITE.test(command)) t.issues = t.pulls = true;
  // a push moves an open PR's head and starts its CI
  if (GIT_PUSH.test(command)) t.pulls = true;
  return t.issues || t.pulls ? t : undefined;
}

/** Which boards a webhook event can have changed, or undefined for none (a ping, say). */
export function heard(event: string | null): Touch | undefined {
  switch (event) {
    case "issues":
      return { issues: true, pulls: false };
    // a comment can be on an issue or a PR; a PR's change can close the issues it fixes
    case "issue_comment":
    case "pull_request":
      return { issues: true, pulls: true };
    case "pull_request_review":
    case "check_suite":
      return { issues: false, pulls: true };
  }
}

export interface Deps {
  refreshIssues(): Promise<unknown>;
  refreshPulls(): Promise<unknown>;
  /** owner/name */
  repo(): Promise<string>;
  token(): Promise<string>;
  /** People on the floor, or work under way. */
  active(): boolean;
  /** Head commits of open PRs whose checks are still running. */
  pendingHeads(): string[];
  fetch?: typeof fetch;
  now?: () => number;
  warn?: (msg: string) => void;
}

export class LiveGitHub {
  private etags = new Map<string, string>();
  private settle?: ReturnType<typeof setTimeout>;
  private again?: ReturnType<typeof setTimeout>;
  private timer?: ReturnType<typeof setInterval>;
  private want: Touch = { issues: false, pulls: false };
  private tok?: Promise<string>;
  private restUntil = 0;
  private watching = false;
  /** Webhooks are being forwarded, so the watch stands down. */
  pushed = false;

  constructor(private deps: Deps) {}

  start(every = WATCH_MS) {
    this.timer = setInterval(() => void this.watch(), every);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.settle);
    clearTimeout(this.again);
  }

  /** A worker ran `command` in its shell. */
  ran(command: unknown) {
    const t = touches(command);
    if (t) this.soon(t);
  }

  /** Looks again once things settle, then once more after GitHub's lists catch up. */
  soon(t: Touch, settle = SETTLE_MS) {
    this.want = { issues: this.want.issues || t.issues, pulls: this.want.pulls || t.pulls };
    clearTimeout(this.settle);
    clearTimeout(this.again);
    this.settle = setTimeout(() => {
      const want = this.want;
      this.want = { issues: false, pulls: false };
      void this.look(want);
      this.again = setTimeout(() => void this.look(want), AGAIN_MS);
      this.again.unref?.();
    }, settle);
    this.settle.unref?.();
  }

  private look(t: Touch) {
    return Promise.all([t.issues && this.deps.refreshIssues(), t.pulls && this.deps.refreshPulls()]);
  }

  /** One round of asking GitHub whether anything changed. Resolves to what it looked at again. */
  async watch(): Promise<Touch> {
    const t: Touch = { issues: false, pulls: false };
    const now = this.deps.now?.() ?? Date.now();
    if (this.pushed || this.watching || now < this.restUntil || !this.deps.active()) return t;
    this.watching = true;
    try {
      const repo = await this.deps.repo();
      // PRs are issues to GitHub: one list, newest change first, covers both boards
      if (await this.changed(`repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=1`))
        t.issues = t.pulls = true;
      const heads = this.deps.pendingHeads().slice(0, MAX_HEADS);
      for (const key of this.etags.keys())
        if (key.includes("/check-suites") && !heads.some((h) => key.includes(h))) this.etags.delete(key);
      for (const sha of heads)
        if (await this.changed(`repos/${repo}/commits/${sha}/check-suites?per_page=100`)) t.pulls = true;
    } catch (err) {
      this.restUntil = now + REST_MS;
      this.deps.warn?.(`🥐 live GitHub boards resting for ${REST_MS / 60_000} min: ${(err as Error).message}`);
    } finally {
      this.watching = false;
    }
    if (t.issues || t.pulls) await this.look(t);
    return t;
  }

  /** Whether `path` answers differently from last time. The first answer is only remembered. */
  private async changed(path: string, retried = false): Promise<boolean> {
    const etag = this.etags.get(path);
    const token = await (this.tok ??= this.deps.token());
    const res = await (this.deps.fetch ?? fetch)(`https://api.github.com/${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(etag ? { "if-none-match": etag } : {}),
      },
    });
    if (res.status === 304) return false;
    if (res.status === 401 && !retried) {
      this.tok = undefined;
      return this.changed(path, true);
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path.split("?")[0]}`);
    await res.body?.cancel();
    const next = res.headers.get("etag");
    if (next) this.etags.set(path, next);
    return etag !== undefined && etag !== next;
  }
}

/** Whether `signature` (X-Hub-Signature-256) is `body` signed with `secret`. */
export function signed(secret: string, body: string, signature: string | null) {
  const want = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const got = Buffer.from(signature ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface ForwardDeps {
  repo(): Promise<string>;
  cwd: string;
  /** A webhook's boards. */
  heard(t: Touch): void;
  /** Whether the forwarder is up. */
  up(on: boolean): void;
  /** The forwarder to run, given the repo, the local URL and the secret: `gh webhook forward` by default. */
  command?: (repo: string, url: string, secret: string) => string[];
  warn?: (msg: string) => void;
}

/** `gh webhook forward` into a localhost port, started again after REST_MS whenever it stops. */
export class Forward {
  private secret = randomBytes(20).toString("hex");
  private server?: ReturnType<typeof Bun.serve>;
  private child?: ReturnType<typeof spawn>;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private deps: ForwardDeps) {}

  /** One webhook delivery, as GitHub (through the forwarder) sends it. */
  async handle(req: Request) {
    const body = await req.text();
    if (req.method !== "POST" || !signed(this.secret, body, req.headers.get("x-hub-signature-256")))
      return new Response("no", { status: 401 });
    const t = heard(req.headers.get("x-github-event"));
    if (t) this.deps.heard(t);
    return new Response(null, { status: 204 });
  }

  async start(rest = REST_MS) {
    if (this.stopped) return;
    try {
      this.server ??= Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => this.handle(req) });
      const repo = await this.deps.repo();
      const url = `http://127.0.0.1:${this.server.port}/`;
      const argv = (this.deps.command ?? ((r, u, s) => ["gh", "webhook", "forward", `--repo=${r}`, `--events=${EVENTS.join(",")}`, `--url=${u}`, `--secret=${s}`]))(repo, url, this.secret);
      // gh runs the extension as its own child, so it gets a process group of its own to stop as one
      const child = (this.child = spawn(argv[0]!, argv.slice(1), { cwd: this.deps.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true }));
      process.once("exit", this.kill);
      let last = "";
      const read = (chunk: Buffer) => {
        for (const line of String(chunk).split("\n").map((l) => l.trim()).filter(Boolean)) {
          // the forwarder says this once its websocket to GitHub is open
          if (/^Forwarding Webhook events/i.test(line)) {
            this.deps.up(true);
            this.deps.warn?.(`🥐 live GitHub boards: webhooks for ${repo} forwarded`);
          } else last = line;
        }
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.on("error", (err) => (last = err.message));
      child.on("close", () => {
        process.off("exit", this.kill);
        this.deps.up(false);
        if (this.stopped) return;
        this.deps.warn?.(`🥐 live GitHub boards: webhook forwarding stopped (${last || "no reason given"}), trying again in ${rest / 60_000} min`);
        this.later(rest);
      });
    } catch (err) {
      this.deps.warn?.(`🥐 live GitHub boards: no webhook forwarding (${(err as Error).message}), trying again in ${rest / 60_000} min`);
      this.later(rest);
    }
  }

  private kill = () => {
    const pid = this.child?.pid;
    if (!pid) return;
    try {
      process.kill(-pid);
    } catch {}
  };

  private later(rest: number) {
    this.retry = setTimeout(() => void this.start(rest), rest);
    this.retry.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.kill();
    this.server?.stop(true);
    this.deps.up(false);
  }
}

function ghToken(cwd: string) {
  return new Promise<string>((resolve, reject) =>
    execFile("gh", ["auth", "token"], { cwd, timeout: 10_000 }, (err, out) => {
      const token = String(out ?? "").trim();
      if (err || !token) reject(new Error("gh auth token gave nothing (is gh signed in?)"));
      else resolve(token);
    }));
}

/** A floor of the office (floor.js), as much of it as this needs. */
interface Floor {
  github: {
    refreshIssues(): Promise<unknown>;
    refreshPulls(): Promise<unknown>;
    repoInfo(): Promise<{ nameWithOwner: string }>;
    pulls: { items: { state: string; checks?: string; headRefOid?: string }[] };
  };
  workers: { __rbOnGh?: (command: unknown) => void };
  active(): boolean;
}

/** Hooks a floor up: called from its constructor (see scripts/rustybunsify.ts). */
export function liveGitHub(floor: Floor, dir: string) {
  const live = new LiveGitHub({
    refreshIssues: () => floor.github.refreshIssues(),
    refreshPulls: () => floor.github.refreshPulls(),
    repo: () => floor.github.repoInfo().then((r) => r.nameWithOwner),
    token: () => ghToken(dir),
    active: () => floor.active(),
    pendingHeads: () =>
      floor.github.pulls.items.flatMap((p) => (p.state === "OPEN" && p.checks === "pending" && p.headRefOid ? [p.headRefOid] : [])),
    warn: (msg) => console.warn(msg),
  });
  floor.workers.__rbOnGh = (command) => live.ran(command);
  live.start();
  if (process.env.AGENT_OFFICE_WEBHOOKS !== "1") return live;
  const forward = new Forward({
    repo: () => floor.github.repoInfo().then((r) => r.nameWithOwner),
    cwd: dir,
    heard: (t) => live.soon(t, HEARD_MS),
    up: (on) => void (live.pushed = on),
    warn: (msg) => console.warn(msg),
  });
  void forward.start();
  return { stop: () => (forward.stop(), live.stop()) };
}
