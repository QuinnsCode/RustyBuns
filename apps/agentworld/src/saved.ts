// A room's world, kept on the server so someone walking the galaxy onto its plot can run it: the page sends its files
// after each change that lands (`PUT /api/r/<room>/world`) and anyone may read them back (`GET`, 404 when none). The
// body is checked with the same Page Schema and limits as an agent's write. One storage key per file, so no value is
// bigger than a file (100,000 characters). No platform here: the Room Durable Object and scripts/dev.ts hand it storage.
// `POST /api/r/<room>/made` saves the same way and marks the world made (an AI wrote it and it loaded clean, lock.ts),
// for good; `GET` there says whether it is. Agent Galaxy hands a plot only to a world that is made.
// With Artifacts (keep.ts), each change is also kept in the room's repo, and a `GET` reads it from there. A push waits
// a few seconds, so an agent writing several files in a row makes one; until it lands, storage is the newer copy.
import { arr, bool, check, obj, opt, str, type Of } from "@rustybuns/util/guard";
import { json } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import { Option, Schema } from "effect";
import { keepWorld, keptWorld, type Repos } from "./keep.ts";
import { FILES_MAX, Page, WORLD_MAX } from "./page.ts";
import type { Kv } from "./galaxy.ts";
import { fromPage } from "./relay.ts";

const INDEX = "w:index", MADE = "w:made";
/** How many writes there have been, how many of them the repo has, and the room's name (a timer has no request). */
const REV = "w:rev", KEPT = "w:kept", NAME = "w:room";
/** How long a change waits before it is pushed: the changes in between go in the same commit. */
export const KEEP_AFTER_MS = 10_000;
/** Where a room's world is kept for good: Artifacts, and a timer that calls `keep()` once, KEEP_AFTER_MS on. */
export interface Keeper { repos: Repos; later(): unknown }
/** GET /api/r/<room>/made: whether this room's world is made. */
export const Made = obj({ made: bool() });
export type Made = Of<typeof Made>;
const fileKey = (path: string) => `w:f:${path}`;
const Index = obj({ paths: arr(str(120), FILES_MAX), backdrop: opt(str(40)) });
const decodePage = Schema.decodeUnknownOption(Schema.fromJsonString(Page));
/** A world's JSON: its text, escaped (a quote or a newline is two characters), and the keys around it. */
const BODY_MAX = WORLD_MAX * 2 + 16_000;

export class Saved {
  // A page sends after each change, a second or so apart: room for an agent writing several files in a row.
  private bucket = new TokenBucket(0.5, 10, Date.now());
  constructor(private kv: Kv, private keeper: Keeper | null = null) {}

  /** The world as last sent, or null when none was: from the room's repo once it has every change. */
  async read(): Promise<Page | null> {
    if (this.keeper) {
      const s = await this.kv.get([REV, KEPT, NAME]), room = s.get(NAME);
      if (typeof room === "string" && s.get(REV) === s.get(KEPT)) {
        const page = await keptWorld(this.keeper.repos, room).catch((e: unknown) => { console.warn(`agentworld: reading ${room}'s repo: ${e}`); return null; });
        // Checked like a write: someone with a repo's token could have pushed anything.
        const ok = page && Option.getOrNull(Schema.decodeUnknownOption(Page)(page));
        if (ok) return ok;
      }
    }
    return this.stored();
  }

  private async stored(): Promise<Page | null> {
    const index = check(Index, (await this.kv.get([INDEX])).get(INDEX));
    if (!index) return null;
    const got = await this.kv.get(index.paths.map(fileKey));
    const files: Record<string, string> = {};
    for (const p of index.paths) { const t = got.get(fileKey(p)); if (typeof t === "string") files[p] = t; }
    return { files, ...(index.backdrop ? { backdrop: index.backdrop } : {}) };
  }

  /** Push what storage holds to the room's repo. A throw leaves it unpushed, to be tried again. */
  async keep() {
    if (!this.keeper) return;
    const s = await this.kv.get([REV, KEPT, NAME]), rev = s.get(REV), room = s.get(NAME);
    if (typeof room !== "string" || rev === s.get(KEPT)) return;
    const page = await this.stored();
    if (page) await keepWorld(this.keeper.repos, room, page);
    // The count read before the push: a change that came during it is still unpushed.
    await this.kv.put({ [KEPT]: rev });
  }

  /** Keep this world: the files it no longer has go. */
  async write(page: Page, room?: string) {
    const old = check(Index, (await this.kv.get([INDEX])).get(INDEX));
    const paths = Object.keys(page.files);
    const gone = (old?.paths ?? []).filter((p) => !(p in page.files)).map(fileKey);
    if (gone.length) await this.kv.delete(gone);
    await this.kv.put({ ...Object.fromEntries(paths.map((p) => [fileKey(p), page.files[p]!])), [INDEX]: { paths, ...(page.backdrop ? { backdrop: page.backdrop } : {}) } });
    if (!this.keeper || !room) return;
    const rev = (await this.kv.get([REV])).get(REV);
    await this.kv.put({ [REV]: typeof rev === "number" ? rev + 1 : 1, [NAME]: room });
    await this.keeper.later();
  }

  /** `/api/r/<room>/world` (PUT saves), or with `made` `/api/r/<room>/made` (POST saves and marks it made). */
  async http(req: Request, made = false): Promise<Response> {
    if (req.method === "GET" && made) return json({ made: (await this.kv.get([MADE])).get(MADE) === true } satisfies Made);
    if (req.method === "GET") {
      const page = await this.read();
      return page ? json(page satisfies Page) : json({ error: "this room hasn't saved its world" }, 404);
    }
    const write = made ? "POST" : "PUT";
    if (req.method !== write) return new Response(null, { status: 405, headers: { Allow: `GET, ${write}` } });
    if (!fromPage(req)) return json({ error: "only this site's page may save the room's world" }, 403);
    if (!this.bucket.take(Date.now())) return json({ error: "saving too often: wait a second" }, 429);
    if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return json({ error: "a world is 400,000 characters at most" }, 413);
    const text = await req.text();
    if (text.length > BODY_MAX) return json({ error: "a world is 400,000 characters at most" }, 413);
    const page = Option.getOrNull(decodePage(text));
    if (!page) return json({ error: "send the world as { files: { path: text } }, each path like world.js" }, 400);
    const files = Object.values(page.files);
    if (files.length > FILES_MAX || files.reduce((n, t) => n + t.length, 0) > WORLD_MAX) return json({ error: `a world is ${FILES_MAX} files and ${WORLD_MAX.toLocaleString("en")} characters at most` }, 413);
    await this.write(page, new URL(req.url).pathname.split("/")[3]);
    if (made) await this.kv.put({ [MADE]: true });
    return json({ ok: true, files: files.length });
  }
}
