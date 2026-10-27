// GET /__rb/podcast and /__rb/podcast/episodes?feed=<id>, behind the office's sign-in (http/router.js): the jukebox's
// podcast station (podcast/index.ts) asks which feeds you've set up and for one feed's episodes. The office fetches the
// RSS, not the page, so a feed that sends no CORS headers still works; it only ever fetches a feed from your own list.
//
// Your list is <XDG_CONFIG_HOME or ~/.config>/agent-office/podcasts.json, or AGENT_OFFICE_PODCASTS=path to another:
//   { "feeds": [{ "id": "hah", "title": "Half-Arsed History", "url": "https://feeds.acast.com/public/shows/65a4...", "order": "oldest" }] }
// `order` is the order the station goes through episodes in: "oldest" (the default, a show from the start) or "newest".
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface Feed { id: string; title: string; url: string; order: "oldest" | "newest" }
export interface Episode { id: string; title: string; url: string; seconds: number; published: number }

const FRESH_MS = 15 * 60_000;
const MAX_BYTES = 8_000_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function feeds(env: Record<string, string | undefined> = process.env): Feed[] {
  const file = env.AGENT_OFFICE_PODCASTS ?? path.join(env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? homedir(), ".config"), "agent-office", "podcasts.json");
  let conf: unknown;
  try { conf = JSON.parse(readFileSync(file, "utf8")); } catch { return []; }
  const list = isObject(conf) && Array.isArray(conf.feeds) ? conf.feeds : [];
  const out: Feed[] = [];
  for (const f of list) {
    if (!isObject(f) || typeof f.id !== "string" || typeof f.url !== "string" || !/^[\w-]+$/.test(f.id) || !/^https?:\/\//.test(f.url)) continue;
    out.push({ id: f.id, title: typeof f.title === "string" ? f.title : f.id, url: f.url, order: f.order === "newest" ? "newest" : "oldest" });
  }
  return out;
}

const unCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
const unEscape = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e.toLowerCase()] ?? "");
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? unEscape(unCdata(m[1]!)) : "";
};

/** "1:02:03", "42:10" or "2523" seconds. */
export function seconds(s: string): number {
  const parts = s.trim().split(":").map(Number);
  if (!parts.length || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

/** The show's title and its episodes, in the feed's order (newest first); items with no audio are left out. */
export function parseFeed(xml: string): { title: string; episodes: Episode[] } {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const episodes: Episode[] = [];
  for (const item of items) {
    const url = /<enclosure\b[^>]*\burl="([^"]+)"/i.exec(item)?.[1];
    const title = tag(item, "title");
    if (!url || !title) continue;
    const when = Date.parse(tag(item, "pubDate"));
    episodes.push({
      id: tag(item, "guid") || url, title, url: unEscape(url),
      seconds: seconds(tag(item, "itunes:duration")), published: Number.isFinite(when) ? when : 0,
    });
  }
  return { title: tag(xml.split(/<item[\s>]/i)[0] ?? "", "title"), episodes };
}

/** The routes; null for any other path. */
export function podcastRoute(list: () => Feed[] = feeds, get: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; body: Promise<{ title: string; episodes: Episode[] } | null> }>();
  const load = (f: Feed) => {
    const hit = cache.get(f.id);
    if (hit && now() - hit.at < FRESH_MS) return hit.body;
    const body = (async () => {
      try {
        const r = await get(f.url, { signal: AbortSignal.timeout(15_000) });
        const xml = r.ok ? await r.text() : "";
        return xml.length && xml.length <= MAX_BYTES ? parseFeed(xml) : null;
      } catch { return null; }
    })();
    cache.set(f.id, { at: now(), body });
    // a failed fetch shouldn't hide the show for 15 minutes
    void body.then((b) => { if (!b && cache.get(f.id)?.body === body) cache.delete(f.id); });
    return body;
  };
  return async (method: string, url: URL): Promise<{ status: number; body: unknown } | null> => {
    if (method !== "GET") return null;
    if (url.pathname === "/__rb/podcast") return { status: 200, body: { feeds: list().map(({ id, title, order }) => ({ id, title, order })) } };
    if (url.pathname !== "/__rb/podcast/episodes") return null;
    const f = list().find((x) => x.id === url.searchParams.get("feed"));
    if (!f) return { status: 404, body: { error: "No such feed in your podcasts.json" } };
    const parsed = await load(f);
    if (!parsed) return { status: 502, body: { error: `Couldn't read the feed for ${f.title}` } };
    return { status: 200, body: { title: f.title, order: f.order, episodes: parsed.episodes } };
  };
}
