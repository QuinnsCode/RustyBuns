// You sign for your land, and your scrawl is the sign standing on it. A signature is only its pen strokes, points on a
// 600 by 300 pad: never an image, never text. This is what goes over the wire and the server's side of it (galaxy.ts
// routes /api/galaxy/sign here, in the Worker and scripts/dev.ts alike); the pad is signPad.ts, the page's side
// signs.ts, the standing sign signBoard.ts.
// - A sign belongs to a signed-in person (`eq:<sub>`) and stands on their plot: `POST /api/galaxy/sign` writes only the
//   sender's own, and `GET` reads it back. Anyone reads a plot's sign by its public id (`GET /api/galaxy/sign/<id>`).
// - A plot says which version of its sign it has (`Plot.signed`, 0 for none), so a page reads the strokes once.
import { arr, Bad, check, type Guard, int, nul, obj, type Of } from "@rustybuns/util/guard";
import { json, parseJson } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import type { Kv } from "./galaxy.ts";

export const PAD = { w: 600, h: 300 };
/** Caps on one signature: pen strokes, and points in all of them together. Fewer than MIN_POINTS is not a signature. */
export const MAX_STROKES = 60, MAX_POINTS = 1500, MIN_POINTS = 6;
/** The biggest body a signature within the caps can be. */
const BODY_MAX = 40_000;

export const Point = obj({ x: int(0, PAD.w), y: int(0, PAD.h) });
export type Point = Of<typeof Point>;
const list = arr(arr(Point, MAX_POINTS, { min: 1 }), MAX_STROKES, { min: 1 });
export const points = (strokes: Point[][]) => strokes.reduce((n, s) => n + s.length, 0);
export const Strokes: Guard<Point[][]> = (v) => {
  const strokes = list(v), n = points(strokes);
  if (n < MIN_POINTS || n > MAX_POINTS) throw new Bad(`${MIN_POINTS} to ${MAX_POINTS} points in all`);
  return strokes;
};
/** POST /api/galaxy/sign's body. */
export const SignBody = obj({ strokes: Strokes });
/** A sign as read back: its strokes, or null where nobody has signed. */
export const SignReply = obj({ strokes: nul(Strokes) });
export type SignReply = Of<typeof SignReply>;

export const SIGN_FIRST = "Sign for your land first";

const strokesKey = (owner: string) => `s:${owner}`, versionKey = (owner: string) => `sv:${owner}`;

export class Signs {
  // Each person's own: a few redos at once, then one every twenty seconds. In memory, in the one Galaxy object.
  private buckets = new Map<string, TokenBucket>();
  constructor(private kv: Kv) {}

  async read(owner: string): Promise<Point[][] | null> {
    return check(Strokes, (await this.kv.get([strokesKey(owner)])).get(strokesKey(owner)));
  }

  /** Each owner's sign version, 0 for none. */
  async versions(owners: string[]): Promise<number[]> {
    const got = await this.kv.get(owners.map(versionKey));
    return owners.map((o) => { const v = got.get(versionKey(o)); return typeof v === "number" ? v : 0; });
  }

  private allow(owner: string) {
    if (this.buckets.size > 10_000) this.buckets.clear();
    const b = this.buckets.get(owner) ?? new TokenBucket(0.05, 5, Date.now());
    this.buckets.set(owner, b);
    return b.take(Date.now());
  }

  /** `/api/galaxy/sign` for the signed-in `owner`: GET reads theirs, POST writes it. */
  async http(req: Request, owner: string): Promise<Response> {
    if (req.method === "GET") return json({ strokes: await this.read(owner) } satisfies SignReply);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    if (!this.allow(owner)) return json({ error: "signing too often: wait a moment" }, 429);
    const tooBig = () => json({ error: "that signature is too long" }, 413);
    if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return tooBig();
    const text = await req.text();
    if (text.length > BODY_MAX) return tooBig();
    const body = check(SignBody, parseJson(text));
    if (!body) return json({ error: `send { strokes }: up to ${MAX_STROKES} pen strokes of { x, y } on a ${PAD.w} by ${PAD.h} pad, ${MIN_POINTS} to ${MAX_POINTS} points in all` }, 400);
    const [was = 0] = await this.versions([owner]);
    await this.kv.put({ [strokesKey(owner)]: body.strokes, [versionKey(owner)]: was + 1 });
    return json({ strokes: body.strokes } satisfies SignReply);
  }
}
