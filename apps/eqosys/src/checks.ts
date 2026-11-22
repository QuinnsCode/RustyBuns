// The machine half of a studio game's review (LIBRARY.md, "In review"): when a game is sent, eqosys checks what it can from a
// Worker and keeps the answers on the listing, for the super admin's queue (eq_listing_review). Four checks:
//
//   https   each origin answers over https (2xx, after redirects, still on https)
//   loads   the first origin's page is HTML, and every script and stylesheet it names answers
//   signin  someone in the studio has signed in to it through eqosys (a `links` row: their sign-in came back to its origin)
//   state   the harness the starter ships, `window.<handle>`, is in its scripts (the handle `bun run new-game` gives this id)
//
// A Worker runs no page, so an error thrown while the page runs and what `state()` answers are not seen here: the `state` check's
// words carry the `bun run probe` line that asks it in headless Chrome. Each check is ok, or not with why, in a short line.
import { arr, bool, check as read, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import type { Env } from "./env.ts";
import type { Listing } from "./listings.ts";

export const NAMES = ["https", "loads", "signin", "state"] as const;
export type CheckName = (typeof NAMES)[number];
const Check = obj({ name: oneOf(NAMES), ok: bool(), says: str(4000, { min: 0 }) });
export type Check = Of<typeof Check>;
/** The checks a game got when it was last sent (or checked again), and when: what the listing keeps, read back through this guard. */
const Checks = obj({ at: num(0, Number.MAX_SAFE_INTEGER), list: arr(Check, NAMES.length) });
export type Checks = Of<typeof Checks>;

type Get = (url: string) => Promise<Response>;
/** How long one fetch gets. */
export const WAIT_MS = 8_000;
/** The most scripts and stylesheets a page's check fetches. */
export const MOST_FILES = 12;

/** `window.<handle>` for a game id, the name `bun run new-game` gives it (apps/codesplitter/src/starter.ts `starterNames`). */
export function handleOf(id: string) {
  const words = id.split("-");
  const camel = words[0] + words.slice(1).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return /^\d/.test(id) ? `game${camel}` : camel;
}

const getter = (conf: Env): Get => (url) =>
  (conf.OUTBOUND ? conf.OUTBOUND.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(WAIT_MS) }) : fetch(url, { redirect: "follow", signal: AbortSignal.timeout(WAIT_MS) }));
const answer = (get: Get, url: string) => get(url).then((res) => ({ res, error: "" }), (e: unknown) => ({ res: null, error: e instanceof Error && e.name === "TimeoutError" ? "no answer in 8 s" : "no answer" }));

/** The scripts and stylesheets a page names, as full URLs. */
async function filesIn(html: string, base: string): Promise<string[]> {
  const out = new Set<string>();
  const add = (v: string | null) => { if (!v) return; try { out.add(new URL(v, base).href); } catch { /* not a URL */ } };
  await new HTMLRewriter()
    .on("script[src]", { element(e) { add(e.getAttribute("src")); } })
    .on("link[href]", { element(e) { if (/\b(stylesheet|modulepreload)\b/.test(e.getAttribute("rel") ?? "")) add(e.getAttribute("href")); } })
    .transform(new Response(html)).text();
  return [...out].slice(0, MOST_FILES);
}

/** Runs the four checks on a game. `get` is the outside web (the global fetch, or `OUTBOUND` in tests). */
export async function check(conf: Env, l: Listing, now = Date.now()): Promise<Checks> {
  const get = getter(conf);
  const list: Check[] = [];

  const origins = await Promise.all(l.origins.map(async (o) => {
    const { res, error } = await answer(get, `${o}/`);
    if (!res) return `${o}: ${error}`;
    if (res.url && !res.url.startsWith("https://")) return `${o}: sent to ${new URL(res.url).origin}, not https`;
    if (!res.ok) return `${o}: ${res.status}`;
    return null;
  }));
  const bad = origins.filter((s): s is string => !!s);
  list.push({ name: "https", ok: !bad.length, says: bad.length ? bad.join("; ") : `${l.origins.length === 1 ? "its origin answers" : `all ${l.origins.length} origins answer`} over https` });

  // The page and what it names, on the first origin.
  const home = `${l.origins[0]}/`;
  const page = await answer(get, home);
  const html = page.res?.ok && /html/.test(page.res.headers.get("content-type") ?? "") ? await page.res.text() : null;
  let scripts = "";
  if (html === null) list.push({ name: "loads", ok: false, says: page.res ? (page.res.ok ? `${home} is not an HTML page` : `${home}: ${page.res.status}`) : `${home}: ${page.error}` });
  else {
    const files = await filesIn(html, page.res!.url || home);
    const got = await Promise.all(files.map(async (f) => {
      const { res, error } = await answer(get, f);
      if (!res?.ok) return { f, bad: res ? String(res.status) : error, text: "" };
      return { f, bad: "", text: /\.css(\?|$)/.test(f) ? "" : await res.text() };
    }));
    const broken = got.filter((g) => g.bad);
    scripts = html + got.map((g) => g.text).join("\n");
    list.push({ name: "loads", ok: !broken.length, says: broken.length ? broken.map((g) => `${g.f}: ${g.bad}`).join("; ") : `the page and the ${files.length} file${files.length === 1 ? "" : "s"} it names answer` });
  }

  const who = await conf.DB.prepare(`SELECT COALESCE(u.name, '') AS name FROM links k JOIN studio_members m ON m.user_id = k.user_id AND m.studio_id = ?
    LEFT JOIN "user" u ON u.id = k.user_id WHERE k.app = ? ORDER BY k.last_at DESC LIMIT 1`).bind(l.studio.id, l.id).first<{ name: string }>();
  list.push({ name: "signin", ok: !!who, says: who ? `${who.name || "someone in the studio"} signed in to it through eqosys` : "nobody in the studio has signed in to it through eqosys yet: sign in once from its own page" });

  const handle = handleOf(l.id), probe = `bun run probe --url ${home} --js "${handle}.state()"`;
  const has = new RegExp(`\\b${handle}\\b`).test(scripts);
  list.push({ name: "state", ok: has, says: has ? `window.${handle} is in its scripts; ask it live: ${probe}` : `no window.${handle} in its scripts (the starter's harness); ask it live: ${probe}` });

  return { at: now, list };
}

/** A listing's kept checks, or none. */
export function checksOf(json: string | null | undefined): Checks | undefined {
  if (!json) return undefined;
  try { return read(Checks, JSON.parse(json)) ?? undefined; } catch { return undefined; }
}
