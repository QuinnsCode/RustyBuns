// GET /__rb/codesplitter?repo=owner/name, behind the office's sign-in (http/router.js): what's new on that
// codeSplitter repo for each board (news.ts). The office asks, not the page, so the token stays on this machine
// and codeSplitter needn't allow another origin.
//
// Where and as whom: CODESPLITTER_URL and CODESPLITTER_TOKEN (a cst_ token from your profile page), else what
// `codesplitter login` saved, else the desktop app if it's running, else the live site, signed out. The desktop
// takes a cst_ token too, but sits behind its own launch token: a URL like http://127.0.0.1:5199/?token=<it> (what
// RB_NO_BROWSER=1 prints, or what the running app leaves in ~/.codesplitters/desktop.json) hands that over as the
// cookie the desktop expects, and the token never reaches the page.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { stillBusy, type Held, type Hint, type QueueAdd } from "./hint.ts";
import { busiest } from "../screens/read.ts";
import { summarize, type AgentRun, type Branch, type CheckRun, type Summary } from "./news.ts";

export const LIVE = "https://codesplitter.notryanquinn.workers.dev";
const REPO = /^[\w.-]+\/[\w.-]+$/;
const FRESH_MS = 15_000;
const HOLD_MAX = 8000;   // a held task rides in the query string, and the office has no body to read here
const HOLD_DAYS = 14;
const PATH_MS = 60_000;
const PATH_FILES = 3;

export interface Site { url: string; token?: string; cookie?: string }

export function site(env: Record<string, string | undefined> = process.env): Site {
  let conf: { url?: string; token?: string } = {};
  const dir = env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? homedir(), ".config");
  try { conf = JSON.parse(readFileSync(path.join(dir, "codesplitter", "config.json"), "utf8")); } catch {}
  const u = new URL(env.CODESPLITTER_URL ?? conf.url ?? desktop(env.HOME ?? homedir()) ?? LIVE);
  const launch = u.searchParams.get("token");
  u.search = "";
  return {
    url: u.toString().replace(/\/$/, ""),
    token: env.CODESPLITTER_TOKEN ?? conf.token,
    ...(launch && { cookie: `rb_token_${u.port}=${launch}` }),
  };
}

/** The running desktop app's URL, launch token and all, from the 0600 file it keeps while it runs; else undefined. */
export function desktop(home: string): string | undefined {
  try {
    const d = JSON.parse(readFileSync(path.join(home, ".codesplitters/desktop.json"), "utf8")) as { url: string; token: string; pid: number };
    process.kill(d.pid, 0); // throws when the app is gone and left the file behind (a crash, kill -9)
    return `${d.url}/?token=${encodeURIComponent(d.token)}`;
  } catch { return undefined; }
}

/** The route; null for any other path. */
export function codesplitterRoute(s: Site = site(), get: typeof fetch = fetch) {
  const cache = new Map<string, { at: number; body: Promise<unknown> }>();
  const api = async <T,>(p: string): Promise<T | null> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (s.token) headers.authorization = `Bearer ${s.token}`;
    if (s.cookie) headers.cookie = s.cookie;
    try {
      const r = await get(`${s.url}/api${p}`, { headers, signal: AbortSignal.timeout(8000) });
      return r.ok ? await r.json() as T : null;
    } catch { return null; }
  };
  // Tasks the hint card's Wait is holding (#1287), per repo, until the branches they wait on have merged. Held here,
  // not in the page, so a reload keeps them; the page sends the queue.add itself once one is ready (take).
  const held = new Map<string, Held & { repo: string }>();
  const ready = async (repo: string): Promise<Held[]> => {
    const mine = [...held.values()].filter((h) => h.repo === repo);
    if (!mine.length) return [];
    const branches = await api<{ name: string; status: string }[]>(`/repos/${repo}/branches`);
    const gone = Date.now() - HOLD_DAYS * 864e5;
    return mine.filter((h) => h.at > gone && stillBusy(h, branches)?.length === 0);
  };
  const look = async (repo: string): Promise<{ site: string; repo: string; boards: Summary | null }> => {
    const [branches, checks, runs] = await Promise.all([
      api<Branch[]>(`/repos/${repo}/branches`),
      api<{ runs: CheckRun[] }>(`/repos/${repo}/checks?ref=main`),
      api<AgentRun[]>(`/repos/${repo}/agents`), // the owner's only; anyone else sees no runs
    ]);
    const none = !branches && !checks && !runs;
    return { site: s.url, repo, boards: none ? null : summarize(branches, checks?.runs ?? null, runs) };
  };
  const paths = new Map<string, { at: number; body: Promise<unknown> }>();
  const gitpath = async (repo: string) => {
    const files = busiest(await api<unknown>(`/repos/${repo}/gitpath`)).slice(0, PATH_FILES);
    const histories = await Promise.all(files.map((f) => api<unknown>(`/repos/${repo}/gitpath?path=${encodeURIComponent(f)}&limit=40`)));
    return { site: s.url, repo, histories: histories.filter(Boolean) };
  };
  // GET /__rb/codesplitter/hold?repo=  what's held for the repo and what's ready to queue now.
  // POST .../hold?repo=&msg=<queue.add json>&branches=a,b  hold a task. POST .../hold/take?id=  claim a ready one
  // (once; it's gone after) or DELETE .../hold?id= to drop it.
  const hold = async (method: string, url: URL): Promise<{ status: number; body: unknown }> => {
    const repo = url.searchParams.get("repo") ?? "";
    const id = url.searchParams.get("id") ?? "";
    if (method === "GET") {
      if (!REPO.test(repo)) return { status: 400, body: { error: "repo is owner/name" } };
      const now = await ready(repo);
      return { status: 200, body: { held: [...held.values()].filter((h) => h.repo === repo).map(({ repo: _, ...h }) => h), ready: now.map((h) => h.id) } };
    }
    if (method === "DELETE") return { status: 200, body: { dropped: held.delete(id) } };
    if (method !== "POST") return { status: 405, body: { error: `GET, POST or DELETE ${url.pathname}` } };
    if (url.pathname.endsWith("/take")) {
      const h = held.get(id);
      if (!h || !(await ready(h.repo)).includes(h)) return { status: 409, body: { error: "not ready" } };
      held.delete(id);
      return { status: 200, body: h.msg };
    }
    const raw = url.searchParams.get("msg") ?? "";
    const branches = (url.searchParams.get("branches") ?? "").split(",").filter(Boolean).slice(0, 20);
    let msg: QueueAdd | undefined;
    try { msg = JSON.parse(raw); } catch {}
    if (!REPO.test(repo) || raw.length > HOLD_MAX || msg?.t !== "queue.add" || typeof msg.prompt !== "string" || !branches.length)
      return { status: 400, body: { error: "repo, msg (a queue.add under 8KB) and branches" } };
    const h = { id: crypto.randomUUID(), repo, msg, branches, at: Date.now() };
    held.set(h.id, h);
    return { status: 201, body: { id: h.id } };
  };
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (!/^\/__rb\/codesplitter(\/hint|\/hold|\/hold\/take|\/gitpath)?$/.test(url.pathname)) return null;
    if (url.pathname.includes("/hold")) return hold(method, url);
    if (method !== "GET") return { status: 405, body: { error: `GET ${url.pathname}` } };
    const repo = url.searchParams.get("repo") ?? "";
    // GET /__rb/codesplitter/hint?repo=&task=  the dispatch hint (#1187): the open branches already changing the
    // files a task names, asked before it's queued. Nothing busy when codeSplitter can't say.
    if (url.pathname.endsWith("/hint")) {
      if (!REPO.test(repo)) return { status: 400, body: { error: "repo is owner/name" } };
      const task = (url.searchParams.get("task") ?? "").slice(0, 4000);
      return { status: 200, body: await api<Hint>(`/repos/${repo}/dispatch-hint?task=${encodeURIComponent(task)}`) ?? { files: [], busy: [] } };
    }
    // GET /__rb/codesplitter/gitpath?repo=  the wall screen's gitpath (screens/): the repo's busiest files and the
    // histories of the top few, as codeSplitter's /gitpath answers them
    if (url.pathname.endsWith("/gitpath")) {
      if (!REPO.test(repo)) return { status: 400, body: { error: "repo is owner/name" } };
      const hit = paths.get(repo);
      if (hit && Date.now() - hit.at < PATH_MS) return { status: 200, body: await hit.body };
      const body = gitpath(repo);
      paths.set(repo, { at: Date.now(), body });
      return { status: 200, body: await body };
    }
    if (!repo) return { status: 200, body: { site: s.url, repo: null, boards: null } };
    if (!REPO.test(repo)) return { status: 400, body: { error: "repo is owner/name" } };
    const hit = cache.get(repo);
    if (hit && Date.now() - hit.at < FRESH_MS) return { status: 200, body: await hit.body };
    const body = look(repo);
    cache.set(repo, { at: Date.now(), body });
    return { status: 200, body: await body };
  };
}
