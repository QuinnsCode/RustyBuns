// Bug reports, suggestions and errors from the games, filed as GitHub issues on the RustyBuns repo. A game sends the token
// /api/exchange gave it; the account is what's limited (a few an hour, a few a day), so one player can't flood the repo, and every
// issue is labelled `external` and `game:<id>` with a header that says who sent it from where. The reporter appears only as an
// opaque id, never an email: the repo is public. The GitHub token (GITHUB_REPORT_TOKEN) lives here and nowhere else.
// A studio's own game (listings.ts) never files on this repo: its reports stay in eqosys, under the same limits, and its studio
// reads them on the Studio tab and through eq_studios (`inboxOf`), with the reporter as the same opaque id.
import { check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import { sha256, type Env } from "./env.ts";
import type { QApp } from "./apps.ts";
import { isListing } from "./listings.ts";

export const REPO = "QuinnsCode/RustyBuns";
/** Per account: this many in the last hour, this many in the last day. */
export const PER_HOUR = 5, PER_DAY = 20, KEEP_MS = 365 * 86_400_000;

const KINDS = ["bug", "suggestion", "error"] as const;
export const Report = obj({
  kind: oneOf(KINDS),
  title: str(120, { min: 3 }),
  body: str(4000),
  /** The page or screen it happened on, and the build, as the game knows them. */
  page: opt(str(500)),
  build: opt(str(100)),
  /** An error's message and stack, or a log tail. */
  detail: opt(str(4000)),
});
export type Report = Of<typeof Report>;
const Created = obj({ number: int(1, 1e9) });

const KIND = { bug: "Bug", suggestion: "Suggestion", error: "Error" } as const;
const LABEL = { bug: "bug", suggestion: "enhancement", error: "bug" } as const;

/**
 * Anyone on the internet writes this text into a public repo: no pings, no auto-linked issue numbers (`#12`, `(#12)`,
 * `a/b#12`), and no github.com link, which GitHub turns into a cross-reference on the issue it names.
 */
const tame = (s: string) => s.replace(/@/g, "@\u200b").replace(/#(\d)/g, "#\u200b$1").replace(/github\.com/gi, "github\u200b.com");
const cell = (s: string) => tame(s).replace(/[|\r\n]+/g, " ");
const fence = (s: string) => "```\n" + s.replace(/```/g, "'''") + "\n```";

/** A short stable id for a reporter that doesn't give the account away. */
export const reporterId = async (userId: string) => "u_" + (await sha256(userId)).slice(0, 8);

export async function issueOf(app: QApp, r: Report, userId: string, userAgent: string) {
  const head = [
    `**External report** from ${app.name} (\`${app.id}\`): a ${KIND[r.kind].toLowerCase()} sent by a signed-in player (\`${await reporterId(userId)}\`).`,
    "",
    "| | |", "|---|---|",
    `| Game | ${app.name} (\`${app.id}\`) |`,
    `| Kind | ${KIND[r.kind]} |`,
    // The path only: a query or fragment can carry a party or invite code, and this issue is public.
    ...(r.page ? [`| Page | ${cell(r.page.split(/[?#]/)[0]!)} |`] : []),
    ...(r.build ? [`| Build | ${cell(r.build)} |`] : []),
    ...(userAgent ? [`| Browser | ${cell(userAgent.slice(0, 200))} |`] : []),
    "",
  ];
  return {
    title: `[external][${app.id}] ${KIND[r.kind]}: ${tame(r.title).replace(/\s+/g, " ")}`,
    body: [...head, tame(r.body), ...(r.detail ? ["", "<details><summary>Detail</summary>", "", fence(tame(r.detail)), "", "</details>"] : [])].join("\n"),
    labels: ["external", `game:${app.id}`, LABEL[r.kind]],
  };
}

export type Filed = { ok: true; issue: number | null } | { ok: false; status: number; error: string };

/** A report kept for a studio: what the player sent, the page's path only (a query can carry a party code). */
const Kept = obj({ text: str(4000), page: opt(str(500)), build: opt(str(100)), detail: opt(str(4000)) });
export interface Received { kind: Report["kind"]; title: string; text: string; page?: string; build?: string; detail?: string; from: string; at: number }
/** How many of a game's reports its studio sees: the newest. */
export const INBOX = 20;

/** A studio's game's newest reports, newest first. */
export async function inboxOf(conf: Env, app: string): Promise<Received[]> {
  const { results } = await conf.DB.prepare("SELECT user_id, kind, title, body, at FROM reports WHERE app = ? AND body IS NOT NULL ORDER BY at DESC LIMIT ?")
    .bind(app, INBOX).all<{ user_id: string; kind: string; title: string; body: string; at: number }>();
  return Promise.all(results.map(async (r) => {
    let kept: Of<typeof Kept> | null = null;
    try { kept = check(Kept, JSON.parse(r.body)); } catch { kept = null; }
    return { kind: check(oneOf(KINDS), r.kind) ?? "bug", title: r.title, text: kept?.text ?? "", ...(kept?.page ? { page: kept.page } : {}), ...(kept?.build ? { build: kept.build } : {}),
      ...(kept?.detail ? { detail: kept.detail } : {}), from: await reporterId(r.user_id), at: r.at };
  }));
}

/** Count this account's reports, refuse past the limits, then reserve a slot and file the issue. */
export async function file(conf: Env, app: QApp, userId: string, userAgent: string, raw: unknown, now = Date.now()): Promise<Filed> {
  const studio = isListing(app);
  if (!studio && !conf.GITHUB_REPORT_TOKEN) return { ok: false, status: 503, error: "reports aren't switched on here yet" };
  const r = check(Report, raw);
  if (!r) return { ok: false, status: 400, error: "send { kind: bug | suggestion | error, title (3-120 characters), body (up to 4000) }" };
  // A report's row is kept a year (privacy.ts): long enough to answer it, then the account and the issue part.
  await conf.DB.prepare(`DELETE FROM reports WHERE at < ?`).bind(now - KEEP_MS).run();
  // Reserve the slot before the call, the count and the insert in one statement, so a burst of requests can't all pass the count.
  const slot = await conf.DB.prepare(`INSERT INTO reports (user_id, app, at) SELECT ?1, ?2, ?3
    WHERE (SELECT COUNT(*) FROM reports WHERE user_id = ?1 AND at > ?3 - 3600000) < ?4 AND (SELECT COUNT(*) FROM reports WHERE user_id = ?1 AND at > ?3 - 86400000) < ?5 RETURNING id`)
    .bind(userId, app.id, now, PER_HOUR, PER_DAY).first<number>("id");
  if (slot === null) return { ok: false, status: 429, error: `that's enough reports for now (${PER_HOUR} an hour, ${PER_DAY} a day): try again later` };
  if (studio) {
    const kept = { text: r.body, ...(r.page ? { page: r.page.split(/[?#]/)[0]! } : {}), ...(r.build ? { build: r.build } : {}), ...(r.detail ? { detail: r.detail } : {}) };
    await conf.DB.prepare("UPDATE reports SET kind = ?, title = ?, body = ? WHERE id = ?").bind(r.kind, r.title.replace(/\s+/g, " ").trim(), JSON.stringify(kept), slot).run();
    return { ok: true, issue: null };
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${conf.GITHUB_REPORT_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "eqosys-reports", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify(await issueOf(app, r, userId, userAgent)),
  }).catch(() => null);
  if (!res?.ok) {
    console.error("eqosys reports: GitHub said", res?.status ?? "nothing");
    await conf.DB.prepare(`DELETE FROM reports WHERE id = ?`).bind(slot).run();
    return { ok: false, status: 502, error: "couldn't reach the issue tracker: try again in a minute" };
  }
  const issue = (await readJson(res, Created))?.number ?? null;
  if (issue !== null) await conf.DB.prepare(`UPDATE reports SET issue = ? WHERE id = ?`).bind(issue, slot).run();
  return { ok: true, issue };
}
