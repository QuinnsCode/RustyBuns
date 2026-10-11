// Pulse: a heartbeat per person and agent, the lines they landed each hour over
// the last week. It falls out of the feed's data: main's copy of each file writes
// a line event as edits land (line-events.ts), so a pulse beats while someone
// types; an open file beats faster still, off its own socket (client.html). A
// line landed is an insert or a change, not a delete. An event folds a stretch of
// work, so its lines spread evenly over the hours it spans.
//
// Private repos add nothing to a public pulse: only events in repos public right
// now count, so a repo going private takes its lines with it. Your own pulse, seen
// by you, counts everything. Anyone can turn their public pulse off
// (PUT /api/me {pulse: false}); then only they see it.
//
//   GET /api/users/:name/pulse       {name, hours: [168 counts, oldest first], from, total, live_at}
//   GET /api/users/:name/pulse.png   the pulse as a 1200x630 card (card.ts), for X and og:image
//   GET /api/users/:name/share       a page for link previews, sending people on to the profile
//   GET /api/pulse?names=a,b         many pulses at once, for crew lists (off ones left out)

import { json, type Env } from "./env.ts";
import { renderPulseCard } from "./card.ts";

const HOUR = 3_600_000;
export const HOURS = 7 * 24;

export interface Pulse { name: string; hours: number[]; from: number; total: number; live_at: number | null }

/** Whether `name`'s pulse is out of sight for `viewer`: they turned it off and aren't looking at their own. */
async function hidden(env: Env, name: string, viewer: string | null) {
  if (name === viewer) return false;
  const u = await env.DB.prepare("SELECT pulse FROM users WHERE name = ?").bind(name).first() as { pulse: number } | null;
  return u ? !u.pulse : false;   // an agent has no row: its pulse is public
}

/** Spread `n` lines over the hours from `first` to `last`, into `hours` (which starts at `from`); the remainder goes to the latest. */
export function spread(hours: number[], from: number, first: number, last: number, n: number) {
  const a = Math.floor((Math.max(first, from) - from) / HOUR), b = Math.floor((last - from) / HOUR);
  if (b < 0 || a >= hours.length || n <= 0) return;
  // Only the share of the stretch inside the week counts.
  const span = Math.floor(last / HOUR) - Math.floor(first / HOUR) + 1, inside = b - a + 1;
  const total = Math.round(n * inside / span), each = Math.floor(total / inside);
  for (let i = a; i <= b; i++) if (i < hours.length) hours[i]! += each;
  hours[Math.min(b, hours.length - 1)]! += total - each * inside;
}

/** The last week of `names`, as `viewer` may see them: their own pulse whole, everyone else's public repos only. */
export async function pulses(env: Env, names: string[], viewer: string | null, now = Date.now()): Promise<Pulse[]> {
  const from = now - (now % HOUR) - (HOURS - 1) * HOUR, out: Pulse[] = [];
  for (const name of names) {
    if (await hidden(env, name, viewer)) continue;
    const { results } = (await env.DB.prepare(name === viewer
      ? "SELECT first_at, last_at, sets + inserts AS n FROM line_events WHERE who = ? AND last_at >= ?"
      : `SELECT e.first_at, e.last_at, e.sets + e.inserts AS n FROM line_events e JOIN repos r ON r.owner = e.owner AND r.name = e.repo
         WHERE e.who = ? AND e.last_at >= ? AND r.visibility = 'public'`).bind(name, from).all()) as { results: { first_at: number; last_at: number; n: number }[] };
    const hours = new Array<number>(HOURS).fill(0);
    let live_at = 0;
    for (const e of results) {
      spread(hours, from, Number(e.first_at), Number(e.last_at), Number(e.n));
      if (e.n > 0) live_at = Math.max(live_at, Number(e.last_at));
    }
    out.push({ name, hours, from, total: hours.reduce((a, b) => a + b, 0), live_at: live_at || null });
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const lines = (n: number) => `${n.toLocaleString("en-US")} line${n === 1 ? "" : "s"}`;
export const pulseSummary = (p: Pulse) => p.total ? `${lines(p.total)} landed this week` : "quiet this week";

export async function pulseRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null): Promise<Response | null> {
  if (req.method !== "GET") return null;
  // GET /api/pulse?names=a,b
  if (p[1] === "pulse" && !p[2]) {
    const names = [...new Set((url.searchParams.get("names") ?? "").split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean))].slice(0, 50);
    return json({ pulses: await pulses(env, names, user) });
  }
  if (p[1] !== "users" || !p[2] || p[4]) return null;
  const route = p[3];
  if (route !== "pulse" && route !== "pulse.png" && route !== "share") return null;
  const name = p[2];
  const [pulse] = await pulses(env, [name], route === "pulse" ? user : null);
  if (route === "pulse") return pulse ? json(pulse) : json({ error: `@${name} keeps their pulse to themselves` }, 404);
  // The card and the share page are for the world: public repos only, whoever asks.
  if (route === "pulse.png") {
    if (!pulse) return json({ error: "no public pulse" }, 404);
    const png = await renderPulseCard({ title: `@${name}'s pulse`, hours: pulse.hours, from: pulse.from, status: pulseSummary(pulse), bot: name.startsWith("agent-") });
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });
  }
  // GET /api/users/:name/share  link previews read the meta tags; people go on to the profile
  const title = `@${name} on codeSplitters`, page = `#/u/${encodeURIComponent(name)}`;
  const desc = pulse ? `${pulseSummary(pulse)}. Line by line, live, with their crew of people and agents.` : "Line by line, live, with their crew of people and agents.";
  const image = pulse ? `${url.origin}/api/users/${encodeURIComponent(name)}/pulse.png?at=${Math.floor(Date.now() / HOUR)}` : null;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:type" content="profile"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta property="og:url" content="${esc(url.href)}">
<meta http-equiv="refresh" content="0; url=/${page}"></head><body><a href="/${page}">${esc(title)}</a></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
