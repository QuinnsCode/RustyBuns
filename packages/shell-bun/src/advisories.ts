// Known-bad releases. advisories.json at the repo root lists RustyBuns versions
// to move off (up or back). Every CLI command checks the installed version
// against it, at most once a day, and so does a built desktop app at launch
// (launchCheck, for the RustyBuns it was built with). The @rustybuns packages release in lockstep,
// so one version covers all four. The check never fails a command: offline, or
// a slow GitHub, just means no banner.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ADVISORIES_URL = "https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/advisories.json";
export const LATEST_URL = "https://registry.npmjs.org/@rustybuns/cli/latest";
const PACKUMENT_URL = "https://registry.npmjs.org/@rustybuns/cli";
const DAY = 24 * 60 * 60 * 1000;

export type Advisory = {
  /** A semver range (Bun.semver), e.g. "0.1.6" or ">=0.1.8 <0.1.10". */
  versions: string;
  do: "upgrade" | "downgrade";
  /** The version to install, or "latest". */
  to: string;
  why: string;
  /** A RustyBuns issue number, or for an app's own file a URL. */
  issue?: number | string;
};

/** `latestAt` is when `latest` was published (ms), to tell a release the age gate holds back from an old one. */
export type Facts = { advisories: Advisory[]; latest?: string; latestAt?: number; checkedAt: number };

// Bun.semver.satisfies treats a range it cannot parse as matching everything,
// so a typo in advisories.json would warn every user. Only plain comparators
// (`0.1.6`, `>=0.1.8 <0.1.10`, `a || b`) count.
const COMPARATOR = /^(?:[<>]=?|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const validRange = (range: unknown): range is string =>
  typeof range === "string" && range.split("||").every((part) => {
    const cs = part.trim().split(/\s+/);
    return cs.length > 0 && cs.every((c) => COMPARATOR.test(c));
  });

/** The advisories that name `version`. */
export function matching(version: string, advisories: Advisory[]): Advisory[] {
  return advisories.filter((a) => validRange(a.versions) && Bun.semver.satisfies(version, a.versions));
}

/** What to tell someone on `version`: a banner for a bad release, a line for an old one, or nothing. */
export function advise(version: string, facts: Pick<Facts, "advisories" | "latest" | "latestAt">, held: { gate?: number | null; now?: number } = {}): string | null {
  const bad = matching(version, facts.advisories);
  if (bad.length) {
    const lines = bad.map((a) => {
      const to = a.to === "latest" ? facts.latest ?? "latest" : a.to;
      const issue = a.issue ? ` (https://github.com/QuinnsCode/RustyBuns/issues/${a.issue})` : "";
      return `  ${a.why}${issue}\n  ${a.do === "downgrade" ? "go back" : "upgrade"}: bun add -d @rustybuns/cli@${to}`;
    });
    return `rustybuns ${version} is a known-bad release.\n${lines.join("\n")}`;
  }
  if (facts.latest && Bun.semver.order(version, facts.latest) < 0) {
    const age = facts.latestAt && (held.now ?? Date.now()) - facts.latestAt;
    if (held.gate && age && age < held.gate * 1000)
      return `rustybuns ${facts.latest} is out but your minimum release age (${duration(held.gate * 1000)}) is holding it back; it is ${duration(age)} old.\n  Wait, pin ${version} (bun add -d @rustybuns/cli@${version}), or exempt @rustybuns/* (see GETTING_STARTED.md).`;
    return `rustybuns ${facts.latest} is out (you have ${version}): bun add -d @rustybuns/cli@latest`;
  }
  return null;
}

const duration = (ms: number) => ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)}d` : ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.max(1, Math.round(ms / 60_000))}m`;

/** Whether `key`'s list in a bunfig.toml / pnpm-workspace.yaml names @rustybuns/cli (or the @rustybuns/* glob). */
function exempt(text: string, key: string): boolean {
  const m = new RegExp(`^\\s*${key}\\s*[=:][ \\t]*(\\[[^\\]]*\\]|(?:\\n[ \\t]*-.*)*)`, "m").exec(text);
  return !!m && /@rustybuns\/(cli|\*)/.test(m[1]!);
}

/**
 * The package manager's minimum release age for @rustybuns/cli, in seconds, read from
 * bunfig.toml (`minimumReleaseAge`, seconds) and pnpm-workspace.yaml (minutes) in `dir`,
 * then ~/.bunfig.toml. Null when none is set or @rustybuns/cli is exempt. Never throws.
 */
export function ageGate(dir = process.cwd(), home = homedir()): number | null {
  const files: [string, number, string][] = [[join(dir, "bunfig.toml"), 1, "minimumReleaseAgeExcludes"], [join(dir, "pnpm-workspace.yaml"), 60, "minimumReleaseAgeExclude"], [join(home, ".bunfig.toml"), 1, "minimumReleaseAgeExcludes"]];
  for (const [file, unit, excludes] of files) {
    try {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      const n = Number(/^\s*minimumReleaseAge\s*[=:]\s*(\d+)/m.exec(text)?.[1]);
      if (n > 0) return exempt(text, excludes) ? null : n * unit;
    } catch {}
  }
  return null;
}

export const cachePath = () => join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "rustybuns", "version-check.json");

function readCache(path: string): Facts | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as Facts; } catch { return null; }
}

async function getJson(url: string, fetcher: typeof fetch, ms: number): Promise<any> {
  const r = await fetcher(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Fetch the advisories and the latest version, keeping what was cached for any that fail. */
export async function refresh(opts: { fetcher?: typeof fetch; ms?: number; now?: number; cached?: Facts | null; version?: string } = {}): Promise<Facts> {
  const { fetcher = fetch, ms = 1500, now = Date.now(), cached = null } = opts;
  const [adv, latest] = await Promise.allSettled([getJson(ADVISORIES_URL, fetcher, ms), getJson(LATEST_URL, fetcher, ms)]);
  const version = latest.status === "fulfilled" && typeof latest.value?.version === "string" ? latest.value.version : undefined;
  // When it came out matters only to someone behind it, so the (larger) full document is fetched only then.
  let latestAt = version && version === cached?.latest ? cached?.latestAt : undefined;
  if (version && !latestAt && opts.version && Bun.semver.order(opts.version, version) < 0) {
    const t = Date.parse((await getJson(PACKUMENT_URL, fetcher, ms).catch(() => null))?.time?.[version]);
    if (t) latestAt = t;
  }
  return {
    advisories: adv.status === "fulfilled" && Array.isArray(adv.value?.advisories) ? adv.value.advisories : cached?.advisories ?? [],
    latest: version ?? cached?.latest,
    latestAt: version ? latestAt : cached?.latestAt,
    checkedAt: now,
  };
}

/** Off in CI and with RUSTYBUNS_NO_UPDATE_CHECK=1. */
export const checkDisabled = (env = process.env) => !!(env.CI || env.RUSTYBUNS_NO_UPDATE_CHECK);

/**
 * The advice for `version`, from a cache refreshed once a day (`force` refreshes
 * now). Never throws.
 */
export async function checkVersion(version: string, opts: { force?: boolean; path?: string; fetcher?: typeof fetch; now?: number; gate?: number | null; advise?: typeof advise } = {}): Promise<string | null> {
  try {
    const { path = cachePath(), now = Date.now() } = opts;
    const gate = "gate" in opts ? opts.gate : ageGate();
    let facts = readCache(path);
    if (opts.force || !facts || now - facts.checkedAt > DAY) {
      facts = await refresh({ fetcher: opts.fetcher, now, cached: facts, version: gate ? version : undefined });
      try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(facts)); } catch {}
    }
    return (opts.advise ?? advise)(version, facts, { gate, now });
  } catch {
    return null;
  }
}

/**
 * For an app built with RustyBuns `version`: a notice when that is a known-bad
 * release, else nothing. An old-but-fine RustyBuns is the app author's call.
 */
export function adviseBuilt(version: string, facts: Pick<Facts, "advisories" | "latest">): string | null {
  const bad = matching(version, facts.advisories);
  if (!bad.length) return null;
  const lines = bad.map((a) => {
    const to = a.to === "latest" ? facts.latest ?? "latest" : a.to;
    const issue = a.issue ? ` (https://github.com/QuinnsCode/RustyBuns/issues/${a.issue})` : "";
    return `  ${a.why}${issue}\n  rebuild with ${to}: bun add -d @rustybuns/cli@${to} && rustybuns build desktop`;
  });
  return `this app was built with RustyBuns ${version}, a known-bad release.\n${lines.join("\n")}`;
}

/**
 * The generated host calls this after it starts serving, without awaiting it.
 * A dev build (`run desktop`, `build desktop --dev`) prints the notice; a
 * release build logs one line, so the app's users never see a framework
 * notice they can't act on. Off when `version` is unknown, in CI and with
 * RUSTYBUNS_NO_UPDATE_CHECK=1. Never throws.
 */
export async function launchCheck(version: string | undefined, opts: { dev: boolean; path?: string; fetcher?: typeof fetch; now?: number; env?: Record<string, string | undefined> }): Promise<string | null> {
  if (!version || checkDisabled(opts.env)) return null;
  const notice = await checkVersion(version, { ...opts, advise: adviseBuilt });
  if (!notice) return null;
  const out = opts.dev ? `[rustybuns] ${notice}\n` : `[rustybuns] ${notice.split("\n").map((l) => l.trim()).join(" · ")}`;
  console.warn(out);
  return out;
}

/**
 * An app's own advisories (`targets.desktop.advisories`): the same shape as
 * RustyBuns' file, plus where to get the app.
 *   { "latest": "1.4.0", "download": "https://example.com/app",
 *     "advisories": [{ "versions": "1.3.0", "do": "upgrade", "to": "latest", "why": "saves are lost on quit" }] }
 * `latest` is what `to: "latest"` means. `issue` here is a full URL, if any.
 */
export type AppFacts = { advisories: Advisory[]; latest?: string; download?: string; checkedAt: number };

/** For the app's users on `version` of `app`: a notice when it is a known-bad release, else nothing. */
export function adviseApp(app: string, version: string, facts: Pick<AppFacts, "advisories" | "latest" | "download">): string | null {
  const bad = matching(version, facts.advisories);
  if (!bad.length) return null;
  const where = facts.download ? ` from ${facts.download}` : "";
  const lines = bad.map((a) => {
    const to = a.to === "latest" ? facts.latest ?? "the latest version" : a.to;
    const issue = typeof a.issue === "string" ? ` (${a.issue})` : "";
    return `  ${a.why}${issue}\n  ${a.do === "downgrade" ? "go back to" : "update to"} ${to}${where}`;
  });
  return `${app} ${version} is a known-bad release.\n${lines.join("\n")}`;
}

/**
 * The generated host calls this after it starts serving, without awaiting it,
 * when the config sets `targets.desktop.advisories`. Unlike launchCheck the
 * notice is for the app's users, so a release build shows it too: one log
 * line, and the desktop's /__rb/info carries the notice it returns as
 * `update` for the page to show.
 * Cached once a day per app (build metadata after `+` is ignored). Off in CI
 * and with RUSTYBUNS_NO_UPDATE_CHECK=1. Never throws.
 */
export async function appLaunchCheck(app: string, version: string | undefined, url: string, opts: { path?: string; fetcher?: typeof fetch; now?: number; ms?: number; env?: Record<string, string | undefined> } = {}): Promise<string | null> {
  const v = version?.split("+")[0];
  if (!v || checkDisabled(opts.env)) return null;
  try {
    const { path = join(dirname(cachePath()), `app-${app.replace(/[^\w.-]/g, "_")}.json`), now = Date.now(), fetcher = fetch, ms = 1500 } = opts;
    let facts = readCache(path) as AppFacts | null;
    if (!facts || now - facts.checkedAt > DAY) {
      const got = await getJson(url, fetcher, ms).catch(() => null);
      facts = {
        advisories: Array.isArray(got?.advisories) ? got.advisories : facts?.advisories ?? [],
        latest: typeof got?.latest === "string" ? got.latest : facts?.latest,
        download: typeof got?.download === "string" ? got.download : facts?.download,
        checkedAt: now,
      };
      try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(facts)); } catch {}
    }
    const notice = adviseApp(app, v, facts);
    if (!notice) return null;
    console.warn(`[${app}] ${notice.split("\n").map((l) => l.trim()).join(" · ")}`);
    return notice;
  } catch {
    return null;
  }
}
