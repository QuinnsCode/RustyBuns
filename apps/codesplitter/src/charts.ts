// Charts from code mode (#5402): a program draws with mpl (vendor/mpl, given to it as `mpl`) and saves the PNG or SVG
// here through the save_chart tool, since it has no network of its own. The file goes in the CHARTS bucket and the
// answer is a signed link that works for a week, for an artifact, a PR or a dashboard; the model only sees the link.
//   POST /api/charts               {name, png? (base64), svg?}: {url, expires, bytes}
//   GET  /charts/:day/:file?exp=&sig=  the file, while the link is good
// The hourly cron deletes each day's charts once they are past the week (`sweepCharts`), so the bucket holds a week at most.

import { fail, json, need, readBody, type Env, type R2Like } from "./env.ts";
import { hex, hmacHex, hmacSigned } from "./util.ts";
import { obj, opt, str } from "@rustybuns/util/guard";

/** A chart's file, decoded: about a 2,000 by 1,200 PNG at scale 2. Its base64 crosses the program's bridge as one tool argument. */
export const MAX_CHART = 300_000;
export const CHART_DAYS = 7;
const DAY = 86_400_000;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const FILE = /^[0-9a-f]{16}-[a-z0-9-]{1,40}\.(png|svg)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const Chart = obj({ name: str(80), png: opt(str(Math.ceil(MAX_CHART / 3) * 4 + 4)), svg: opt(str(MAX_CHART)) });

/** The key a link is signed with: from the site's auth secret, or one made per process where there is none (the desktop, the tests). */
let made: string | undefined;
const keyOf = (env: Env) => env.BETTER_AUTH_SECRET ? `charts:${env.BETTER_AUTH_SECRET}` : made ??= crypto.randomUUID();

const signed = (path: string, exp: number) => `${path}\n${exp}`;

const b64 = (s: string): Uint8Array | null => {
  try { return Uint8Array.from(atob(s.replace(/^data:image\/png;base64,/, "")), (c) => c.charCodeAt(0)); } catch { return null; }
};

export async function chartRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "charts" || p[2] || req.method !== "POST") return null;
  if (!user) return fail("SignInFirst", "sign in first");
  const bucket = env.CHARTS;
  if (!bucket) return fail("ChartsOff", "charts aren't kept on this site: it has no CHARTS bucket");
  const b = need(await readBody(req), Chart, "{name, png} with the PNG as base64 (fig.toPNGSync() through btoa), or {name, svg}");
  if (b instanceof Response) return b;
  if (!b.png === !b.svg) return fail("BadInput", "send one of png (base64) or svg");
  const bytes = b.png !== undefined ? b64(b.png) : new TextEncoder().encode(b.svg);
  if (!bytes) return fail("BadInput", "png isn't base64");
  if (bytes.length > MAX_CHART) return fail("TooBig", `a chart is up to ${MAX_CHART.toLocaleString("en")} bytes: draw it smaller or at scale 1`);
  if (b.png !== undefined ? !PNG.every((x, i) => bytes[i] === x) : !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(b.svg ?? ""))
    return fail("BadInput", b.png !== undefined ? "png isn't a PNG file" : "svg doesn't start with <svg");
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "chart";
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const path = `/charts/${day}/${id}-${slug}.${b.png !== undefined ? "png" : "svg"}`;
  await bucket.put(path.slice("/charts/".length), bytes);
  const expires = now + CHART_DAYS * DAY;
  const url = `${new URL(req.url).origin}${path}?exp=${expires}&sig=${await hmacHex(keyOf(env), signed(path, expires))}`;
  return json({ url, expires, bytes: bytes.length }, 201);
}

/** GET /charts/:day/:file: the file, if the link's signature is ours and it hasn't run out. */
export async function serveChart(req: Request, env: Env, url: URL): Promise<Response | null> {
  const [, top, day, file, more] = url.pathname.split("/");
  if (top !== "charts" || more !== undefined || req.method !== "GET") return null;
  const gone = () => new Response("no such chart, or its link ran out", { status: 404 });
  const exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig") ?? "";
  if (!env.CHARTS || !day || !file || !DATE.test(day) || !FILE.test(file) || !Number.isSafeInteger(exp) || exp < Date.now()) return gone();
  if (!await hmacSigned(keyOf(env), signed(url.pathname, exp), sig)) return gone();
  const o = await env.CHARTS.get(`${day}/${file}`);
  if (!o) return gone();
  const svg = file.endsWith(".svg");
  return new Response(await o.arrayBuffer(), { headers: {
    "content-type": svg ? "image/svg+xml" : "image/png",
    "cache-control": `private, max-age=${Math.max(0, Math.floor((exp - Date.now()) / 1000))}, immutable`,
    "x-content-type-options": "nosniff",
    // An SVG is a page that could carry script: opened on its own, it runs none and loads nothing.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  } });
}

/** Delete every chart from a day past the week a link lasts (hourly, from the cron). */
export async function sweepCharts(env: Env, now = Date.now()): Promise<number> {
  const bucket: R2Like | undefined = env.CHARTS;
  if (!bucket) return 0;
  const oldest = new Date(now - (CHART_DAYS + 1) * DAY).toISOString().slice(0, 10);
  let cursor: string | undefined, n = 0;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    const old = page.objects.map((o) => o.key).filter((k) => k.slice(0, 10) < oldest);
    if (old.length) { await bucket.delete(old); n += old.length; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}
