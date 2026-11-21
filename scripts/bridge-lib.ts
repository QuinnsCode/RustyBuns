// The bridge's pure half: which app an issue is about, what an app's config says it runs on and
// holds, and the tiers file. No git, gh or network here, so bridge.test.ts runs it as is; bridge.ts
// gathers the inputs and serves the page.
import { arr, int, obj, oneOf, or, str, type Of } from "../packages/util/src/guard.ts";

export const TIERS = ["S", "A", "B", "C", "D", "F"] as const;
export type Tier = (typeof TIERS)[number];

/** The tiers file (~/.rustybuns/tiers.json): app ids per tier, best first. An app in no tier is unranked. */
const Ids = or(arr(str(80, { min: 1 }), 300), []);
export const Tiers = obj({ S: Ids, A: Ids, B: Ids, C: Ids, D: Ids, F: Ids });
export type Tiers = Of<typeof Tiers>;
export const emptyTiers = (): Tiers => ({ S: [], A: [], B: [], C: [], D: [], F: [] });

/** One move from the page: put `app` in `tier` (or take it out with "-") at `index` in that row. */
export const Move = obj({ app: str(80, { min: 1 }), tier: oneOf([...TIERS, "-"] as const), index: or(int(-1, 300), -1) });
export type Move = Of<typeof Move>;

/** `tiers` with `m` applied: the app leaves whatever row it was in and lands at `index` (-1: the end). */
export function move(tiers: Tiers, m: Move): Tiers {
  const out = emptyTiers();
  for (const t of TIERS) out[t] = tiers[t].filter((id) => id !== m.app);
  if (m.tier !== "-") {
    const row = out[m.tier];
    row.splice(m.index < 0 || m.index > row.length ? row.length : m.index, 0, m.app);
  }
  return out;
}

/** The tier an app sits in, or null when it's unranked. */
export const tierOf = (tiers: Tiers, id: string): Tier | null => TIERS.find((t) => tiers[t].includes(id)) ?? null;

// ---- which app an issue is about -------------------------------------------------------------

// Issue titles name their app up front ("Skate Tech Park: ...", "MANUAL RUN: qCRM ..."), in the app's
// display name or its folder name. These are the other names the titles use for an app.
export const ALIASES: Record<string, string[]> = {
  codesplitter: ["codesplitters", "mervin", "ester", "dexter", "socialcode101"],
  "mythic-masters": ["mythic", "wildclash", "cutman"],
  "agent-office": ["office", "druids office"],
  "skate-tech-park": ["skate"],
  "fm-daw": ["fm groovebox"],
  "splat-spray": ["super spy splat shot", "splat shot"],
  "park-hide-seek": ["park hide and seek"],
  rustybuns: ["rustybuns", "init", "cli", "ci", "builder", "release rings", "desktop.server", "harness", "docs site", "docs audit", "shell-bun", "ui kit"],
};
// Labels that pin an issue to an app whatever its title says.
const LABELS: Record<string, string> = { codesplitter: "codesplitter", qcrm: "qcrm" };

const flat = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
// "MANUAL RUN:", "Spike:" and the like say what kind of issue it is, not which app.
const KIND = /^\s*(manual run|manual check|spike|flaky|ask first|bug|idea)\s*:\s*/i;

export type Named = { id: string; names: string[] };

/** A matcher from issue to app id: the longest app name the title starts with (after its kind), else a label's app, else null. */
export function issueMatcher(apps: Named[]): (title: string, labels?: string[]) => string | null {
  const keys = apps.flatMap((a) => [a.id, ...a.names, ...(ALIASES[a.id] ?? [])].map((n) => ({ key: flat(n), id: a.id })))
    .filter((k) => k.key.length >= 2)
    .sort((x, y) => y.key.length - x.key.length);
  const ids = new Set(apps.map((a) => a.id));
  return (title, labels = []) => {
    const head = flat(title.replace(KIND, "").split(/[(—]/)[0] ?? "");
    // A short name ("ci", "cli") only counts when the whole lead word is that name, not "circuit" or "climb".
    const lead = flat(title.replace(KIND, "").split(/[\s:,]/)[0] ?? "");
    for (const k of keys) if (head.startsWith(k.key) && (k.key.length > 4 || lead === k.key)) return k.id;
    for (const l of labels) { const id = LABELS[l]; if (id && ids.has(id)) return id; }
    return null;
  };
}

// ---- what an app's config says -------------------------------------------------------------------

export type Platforms = {
  /** 2: CI builds and ships the binary, 1: the app has a target for it, 0: no. */
  mac: number; windows: number; linux: number;
  /** An iOS shell (apps/<app>/ios). */
  ios: number;
  /** Installable on Android as a web app (the page has a manifest and service worker). */
  android: number;
  /** A Bun server of its own: a `box` target, a desktop host in Worker mode, or a plain Bun server. */
  server: number;
  /** Deploys to Cloudflare (an `edge` target, or a wrangler config of its own). */
  cloudflare: number;
};

export type ConfigFacts = { platforms: Platforms; resources: Record<string, number>; domain: string | null };

/** What `rustybuns.config.ts` (read as text: importing it would run the app's code) and the folder say. */
export function readConfig(text: string | null, has: { wrangler: boolean; ios: boolean; installable: boolean; drops: boolean; bunServer: boolean }): ConfigFacts {
  const t = text ?? "";
  const desktop = /\bdesktop\s*:\s*\{/.test(t);
  const bin = has.drops ? 2 : desktop ? 1 : 0;
  const resources: Record<string, number> = {};
  for (const m of t.matchAll(/\btype\s*:\s*"([a-z0-9_]+)"/g)) {
    const kind = m[1] ?? "";
    if (kind === "var" || kind === "secret") continue;
    resources[kind] = (resources[kind] ?? 0) + 1;
  }
  const domain = /\bedge\s*:\s*\{[^}]*?domain\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? null;
  return {
    platforms: {
      mac: bin, windows: bin, linux: bin,
      ios: has.ios ? 1 : 0,
      android: has.installable ? 1 : 0,
      server: /\bbox\s*:\s*\{/.test(t) || /mode\s*:\s*"worker"/.test(t) || has.bunServer ? 1 : 0,
      cloudflare: /\bedge\s*:\s*\{/.test(t) || has.wrangler ? 1 : 0,
    },
    resources,
    domain,
  };
}

// ---- how an app is doing ---------------------------------------------------------------------

export type Light = "green" | "amber" | "red" | "off";

/** One light for an app: red when its hourly tests failed or its live page is down, amber when nothing has checked it lately or its last release failed. */
export function healthOf(h: { test: string | null; live: { ok: boolean } | null; releaseOk: boolean | null }): Light {
  if (h.test === "failure" || (h.live && !h.live.ok)) return "red";
  if (h.releaseOk === false) return "amber";
  if (h.test === "success" || h.live?.ok) return "green";
  return h.test === null && h.live === null ? "off" : "amber";
}

// ---- deploys and PRs -----------------------------------------------------------------------------

/** One line of ~/.rustybuns/deploys.jsonl, as `rustybuns deploy` writes it (packages/cli/src/report-deploy.ts). */
const DeployLine = obj({ app: str(64), stage: str(32), version: str(64), at: int(0, 1e15), dir: str(200, { min: 0, dflt: "" }) });
export type Deploy = { stage: string; version: string; at: string };

/** Each app's newest deploy in the log, keyed by its folder (or its config name when that is an app id). Bad lines are skipped. */
export function lastDeploys(text: string | null, ids: string[]): Map<string, Deploy> {
  const known = new Set(ids), out = new Map<string, Deploy & { ms: number }>();
  for (const line of (text ?? "").split("\n")) {
    let d;
    try { d = DeployLine(JSON.parse(line)); } catch { continue; }
    const id = known.has(d.dir) ? d.dir : known.has(d.app) ? d.app : null;
    if (!id || (out.get(id)?.ms ?? -1) > d.at) continue;
    out.set(id, { stage: d.stage, version: d.version, at: new Date(d.at).toISOString(), ms: d.at });
  }
  return new Map([...out].map(([id, { ms: _, ...d }]) => [id, d]));
}

/** The PR a squash commit came from: GitHub ends its subject with (#N). */
export const prOf = (subject: string): number | null => Number(/\(#(\d+)\)\s*$/.exec(subject)?.[1] ?? NaN) || null;
