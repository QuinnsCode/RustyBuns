// The files beside a room's world, kept in its Artifacts repo (keep.ts): a player's .glb first. An agent puts one
// with curl (`PUT /api/r/<room>/files/hero.glb`) and anyone with the room's link may list and read them; the link is
// the key, as for the tools. Small on purpose: git keeps every version, and Artifacts bills what is stored.
import { json } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import { keepFile, keptFile, keptFiles, type Repos } from "./keep.ts";

export const FILE_BYTES = 4 * 1024 * 1024, ROOM_FILES = 8;
const NAME = /^[a-z0-9][a-z0-9_-]{0,40}\.glb$/;

/** A room's uploads: a few in a row, then one every half minute. */
export const fileBucket = () => new TokenBucket(1 / 30, 5, Date.now());

/** A request to `/api/r/<room>/files<rest>`; `repos` is null where there is no Artifacts. */
export async function filesHttp(req: Request, repos: Repos | null, bucket: TokenBucket, room: string, rest: string): Promise<Response> {
  if (!repos) return json({ error: "this server keeps no files" }, 501);
  const name = rest.slice("/files/".length);
  if (!name) {
    if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    return json({ files: await keptFiles(repos, room) });
  }
  if (!NAME.test(name)) return json({ error: "a file is a .glb model with a plain lowercase name, like hero.glb" }, 400);
  if (req.method === "GET") {
    const file = await keptFile(repos, room, name);
    return file
      ? new Response(file, { headers: { "content-type": "model/gltf-binary", "x-content-type-options": "nosniff", "cache-control": "no-store" } })
      : json({ error: `the room keeps no ${name}` }, 404);
  }
  if (req.method !== "PUT" && req.method !== "DELETE") return new Response(null, { status: 405, headers: { Allow: "GET, PUT, DELETE" } });
  if (!bucket.take(Date.now())) return json({ error: "too many uploads: wait half a minute" }, 429);
  const had = await keptFiles(repos, room);
  if (req.method === "DELETE") {
    if (!had.includes(name)) return json({ error: `the room keeps no ${name}` }, 404);
    await keepFile(repos, room, name, null);
    return json({ ok: true });
  }
  const tooBig = () => json({ error: `a file is ${FILE_BYTES / 1024 / 1024} MB at most` }, 413);
  if (Number(req.headers.get("content-length") ?? 0) > FILE_BYTES) return tooBig();
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > FILE_BYTES) return tooBig();
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF") return json({ error: "that isn't a binary glTF (.glb): send its bytes with --data-binary @file.glb" }, 400);
  if (!had.includes(name) && had.length >= ROOM_FILES) return json({ error: `a room keeps ${ROOM_FILES} files at most: DELETE one first` }, 413);
  await keepFile(repos, room, name, bytes);
  return json({ ok: true, name, bytes: bytes.length });
}
