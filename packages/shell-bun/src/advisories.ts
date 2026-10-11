// Known-bad releases. advisories.json at the repo root lists RustyBuns versions
// to move off (up or back). Every CLI command checks the installed version
// against it, at most once a day, and so does a built desktop app at launch
// (launchCheck, for the RustyBuns it was built with). The @rustybuns packages release in lockstep,
// so one version covers all four. The check never fails a command: offline, or
// a slow GitHub, just means no banner.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ADVISORIES_URL = "https://raw.githubusercontent.com/QuinnsCode/RustyBuns/main/advisories.json";
export const LATEST_URL = "https://registry.npmjs.org/@rustybuns/cli/latest";
const DAY = 24 * 60 * 60 * 1000;

export type Advisory = {
  /** A semver range (Bun.semver), e.g. "0.1.6" or ">=0.1.8 <0.1.10". */
  versions: string;
  do: "upgrade" | "downgrade";
  /** The version to install, or "latest". */
  to: string;
  why: string;
  issue?: number;
};

export type Facts = { advisories: Advisory[]; latest?: string; checkedAt: number };

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
export function advise(version: string, facts: Pick<Facts, "advisories" | "latest">): string | null {
  const bad = matching(version, facts.advisories);
  if (bad.length) {
    const lines = bad.map((a) => {
      const to = a.to === "latest" ? facts.latest ?? "latest" : a.to;
      const issue = a.issue ? ` (https://github.com/QuinnsCode/RustyBuns/issues/${a.issue})` : "";
      return `  ${a.why}${issue}\n  ${a.do === "downgrade" ? "go back" : "upgrade"}: bun add -d @rustybuns/cli@${to}`;
    });
    return `rustybuns ${version} is a known-bad release.\n${lines.join("\n")}`;
  }
  if (facts.latest && Bun.semver.order(version, facts.latest) < 0)
    return `rustybuns ${facts.latest} is out (you have ${version}): bun add -d @rustybuns/cli@latest`;
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
export async function refresh(opts: { fetcher?: typeof fetch; ms?: number; now?: number; cached?: Facts | null } = {}): Promise<Facts> {
  const { fetcher = fetch, ms = 1500, now = Date.now(), cached = null } = opts;
  const [adv, latest] = await Promise.allSettled([getJson(ADVISORIES_URL, fetcher, ms), getJson(LATEST_URL, fetcher, ms)]);
  return {
    advisories: adv.status === "fulfilled" && Array.isArray(adv.value?.advisories) ? adv.value.advisories : cached?.advisories ?? [],
    latest: latest.status === "fulfilled" && typeof latest.value?.version === "string" ? latest.value.version : cached?.latest,
    checkedAt: now,
  };
}

/** Off in CI and with RUSTYBUNS_NO_UPDATE_CHECK=1. */
export const checkDisabled = (env = process.env) => !!(env.CI || env.RUSTYBUNS_NO_UPDATE_CHECK);

/**
 * The advice for `version`, from a cache refreshed once a day (`force` refreshes
 * now). Never throws.
 */
export async function checkVersion(version: string, opts: { force?: boolean; path?: string; fetcher?: typeof fetch; now?: number; advise?: typeof advise } = {}): Promise<string | null> {
  try {
    const { path = cachePath(), now = Date.now() } = opts;
    let facts = readCache(path);
    if (opts.force || !facts || now - facts.checkedAt > DAY) {
      facts = await refresh({ fetcher: opts.fetcher, now, cached: facts });
      try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(facts)); } catch {}
    }
    return (opts.advise ?? advise)(version, facts);
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
