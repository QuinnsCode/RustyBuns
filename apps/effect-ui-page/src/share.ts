// What a room shows the outside world: its latest picture (`PUT` and `GET /api/r/<room>/picture`) and the link
// preview tags on its page. No platform here, as in relay.ts: the Worker (edge/worker.ts, the picture in the Room
// Durable Object's storage) and the local dev server (scripts/dev.ts, in memory) both use it.
import { esc } from "@rustybuns/util";
import { json } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import { fromPage } from "./relay.ts";
import { ROOM } from "./tools.ts";

export const PICTURE_MAX = 150_000;
/** The picture of a room that has none, and of the main page: `bun scripts/og.ts` makes it. */
export const DEFAULT_PICTURE = "/og.jpg";

/** Where one room's picture is kept. */
export interface Pictures {
  get(): Promise<Uint8Array<ArrayBuffer> | undefined>;
  put(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** One room's allowance of uploads: the page sends one per quiet write. */
export const pictureBucket = () => new TokenBucket(0.5, 10, Date.now());

export async function pictureHttp(req: Request, pictures: Pictures, bucket: TokenBucket): Promise<Response> {
  if (req.method === "GET" || req.method === "HEAD") {
    const bytes = await pictures.get();
    if (!bytes) return json({ error: "this world has no picture yet" }, 404);
    return new Response(req.method === "HEAD" ? null : bytes, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
  }
  if (req.method !== "PUT") return json({ error: "GET the picture, or PUT it" }, 405);
  if (!fromPage(req)) return json({ error: "only this site's page may set the picture" }, 403);
  if (!bucket.take(Date.now())) return json({ error: "too many pictures: wait a moment" }, 429);
  const tooBig = () => json({ error: `a picture is ${PICTURE_MAX / 1000} KB at most` }, 413);
  if (Number(req.headers.get("content-length")) > PICTURE_MAX) return tooBig();
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > PICTURE_MAX) return tooBig();
  if (req.headers.get("content-type") !== "image/jpeg" || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ error: "send a JPEG, as image/jpeg" }, 415);
  await pictures.put(bytes);
  return json({ ok: true });
}

/** The page served at `url` (`/` or `/r/<room>`) with its link preview in the head: that room's picture when it
 *  `has` one, else the default. Anything but HTML passes as it is. */
export async function withCard(page: Response, url: URL, has: (room: string) => Promise<boolean>): Promise<Response> {
  if (!page.headers.get("content-type")?.includes("text/html")) return page;
  const room = url.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
  const image = room && ROOM.test(room) && await has(room) ? `/api/r/${room}/picture` : DEFAULT_PICTURE;
  const meta = (key: "property" | "name", name: string, content: string) => `<meta ${key}="${name}" content="${esc(content)}">`;
  const tags = [
    meta("property", "og:title", "Agent Page"),
    meta("property", "og:description", "Your AI writes your world. You watch it light up."),
    meta("property", "og:image", `${url.origin}${image}`),
    meta("name", "twitter:card", "summary_large_image"),
  ].join("");
  const headers = new Headers(page.headers);
  // The tags change when the picture first arrives, so the file's own validator no longer holds.
  headers.delete("etag");
  headers.delete("content-length");
  return new HTMLRewriter().on("head", { element(head) { head.append(tags, { html: true }); } })
    .transform(new Response(page.body, { status: page.status, headers }));
}
