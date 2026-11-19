// Qollab posts and reactions, the everyday walk: one person posts a prompt, a visitor reads the feed signed out, another person
// flames it, both see the count (only the presser as theirs), the flame is taken back, and the author takes the post down.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Counts, PostList, PostMade, Pressed } from "@rustybuns/util/board";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
const BRAWL = "https://excalibrawl.notryanquinn.workers.dev";

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  return check(PostToken, await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json())!.token;
}
const PostToken = obj({ token: str(4000) });

const ask = (method: string, path: string, token?: string, body?: unknown) =>
  handle(new Request(`${ORIGIN}${path}`, { method, headers: { origin: BRAWL, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), conf).then((r) => r!);
const read = async <T>(r: Response, g: (v: unknown) => T) => { expect(r.status).toBe(200); return check(g, await r.json())!; };

test("post, read signed out, react, both see the count, take it back, take the post down", async () => {
  const ada = await signUp("Ada", "excalibrawl", BRAWL), bo = await signUp("Bo", "excalibrawl", BRAWL);

  // Signed out may read but not write.
  expect((await ask("POST", "/q/posts", undefined, { kind: "prompt", text: "a cat" })).status).toBe(401);
  const { post } = await read(await ask("POST", "/q/posts", ada, { kind: "prompt", text: "  a knight fighting a toaster  " }), PostMade);
  expect(post).toMatchObject({ app: "excalibrawl", kind: "prompt", text: "a knight fighting a toaster", reacts: 0, by: { name: "Ada" } });

  const feed = await ask("GET", "/q/posts?app=excalibrawl&kind=prompt");
  expect(feed.headers.get("cache-control")).toBe("public, max-age=30");
  expect((await read(feed, PostList)).posts.map((p) => p.id)).toEqual([post.id]);

  // Bo flames it; pressing twice is still one.
  const ref = `post:${post.id}`;
  await ask("PUT", "/q/reactions", bo, { ref, icon: "flame" });
  expect(await read(await ask("PUT", "/q/reactions", bo, { ref, icon: "flame" }), Pressed)).toEqual({ ref, counts: { flame: 1 }, mine: ["flame"] });
  expect(await read(await ask("GET", `/q/reactions?ref=${ref}&ref=fight:K3X9`, ada), Counts)).toEqual({ counts: { [ref]: { flame: 1 }, "fight:K3X9": {} }, mine: { [ref]: [], "fight:K3X9": [] } });
  expect((await read(await ask("GET", "/q/posts?app=excalibrawl&kind=prompt&sort=top&since=0"), PostList)).posts[0]!.reacts).toBe(1);

  // A word for an icon, another app's kind, or an app with no board are refused.
  expect((await ask("PUT", "/q/reactions", bo, { ref, icon: "you stink" })).status).toBe(400);
  expect((await ask("POST", "/q/posts", ada, { kind: "review", text: "hm" })).status).toBe(400);
  const park = await signUp("Cy", "park-hide-seek", PARK);
  expect((await ask("POST", "/q/posts", park, { kind: "prompt", text: "hi" })).status).toBe(404);

  // Taken back, the count is gone for both.
  expect(await read(await ask("DELETE", "/q/reactions", bo, { ref, icon: "flame" }), Pressed)).toEqual({ ref, counts: {}, mine: [] });

  // Only the author takes the post down.
  expect((await ask("DELETE", `/q/posts/${post.id}`, bo)).status).toBe(404);
  expect((await ask("DELETE", `/q/posts/${post.id}`, ada)).status).toBe(200);
  expect((await read(await ask("GET", "/q/posts?app=excalibrawl&kind=prompt"), PostList)).posts).toEqual([]);
});
