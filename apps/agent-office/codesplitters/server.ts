// GET /__rb/codesplitters?repo=owner/name, behind the office's sign-in (http/router.js): what's new on that
// codeSplitters repo for each board (news.ts). The office asks, not the page, so the token stays on this machine
// and codeSplitters needn't allow another origin.
//
// Where and as whom: CODESPLITTERS_URL and CODESPLITTERS_TOKEN (a cst_ token from your profile page), else what
// `codesplitters login` saved, else the desktop app if it's running, else the live site, signed out. The desktop
// takes a cst_ token too, but sits behind its own launch token: a URL like http://127.0.0.1:5199/?token=<it> (what
// RB_NO_BROWSER=1 prints, or what the running app leaves in ~/.codesplitters/desktop.json) hands that over as the
// cookie the desktop expects, and the token never reaches the page.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { summarize, type AgentRun, type Branch, type CheckRun, type Summary } from "./news.ts";

export const LIVE = "https://codesplitters.notryanquinn.workers.dev";
const REPO = /^[\w.-]+\/[\w.-]+$/;
const FRESH_MS = 15_000;

export interface Site { url: string; token?: string; cookie?: string }

export function site(env: Record<string, string | undefined> = process.env): Site {
  let conf: { url?: string; token?: string } = {};
  try {
    conf = JSON.parse(readFileSync(path.join(env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? homedir(), ".config"), "codesplitters/config.json"), "utf8"));
  } catch {}
  const u = new URL(env.CODESPLITTERS_URL ?? conf.url ?? desktop(env.HOME ?? homedir()) ?? LIVE);
  const launch = u.searchParams.get("token");
  u.search = "";
  return {
    url: u.toString().replace(/\/$/, ""),
    token: env.CODESPLITTERS_TOKEN ?? conf.token,
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
export function codesplittersRoute(s: Site = site(), get: typeof fetch = fetch) {
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
  const look = async (repo: string): Promise<{ site: string; repo: string; boards: Summary | null }> => {
    const [branches, checks, runs] = await Promise.all([
      api<Branch[]>(`/repos/${repo}/branches`),
      api<{ runs: CheckRun[] }>(`/repos/${repo}/checks?ref=main`),
      api<AgentRun[]>(`/repos/${repo}/agents`), // the owner's only; anyone else sees no runs
    ]);
    const none = !branches && !checks && !runs;
    return { site: s.url, repo, boards: none ? null : summarize(branches, checks?.runs ?? null, runs) };
  };
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (url.pathname !== "/__rb/codesplitters") return null;
    if (method !== "GET") return { status: 405, body: { error: `GET ${url.pathname}` } };
    const repo = url.searchParams.get("repo") ?? "";
    if (!repo) return { status: 200, body: { site: s.url, repo: null, boards: null } };
    if (!REPO.test(repo)) return { status: 400, body: { error: "repo is owner/name" } };
    const hit = cache.get(repo);
    if (hit && Date.now() - hit.at < FRESH_MS) return { status: 200, body: await hit.body };
    const body = look(repo);
    cache.set(repo, { at: Date.now(), body });
    return { status: 200, body: await body };
  };
}
