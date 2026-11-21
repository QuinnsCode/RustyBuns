// Qollab posts and reactions, the everyday walk: one person posts a prompt, a visitor reads the feed signed out, another person
// flames it, both see the count (only the presser as theirs), the flame is taken back, and the author takes the post down.
// Then keeping it clean: a post is reported (a row on the game-report path), and the app's studio hides it, brings it back and deletes it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { Blocked, Counts, PostList, PostMade, Pressed } from "@rustybuns/util/board";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { house } from "../src/studios.ts";
import { ADMIN, asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), GITHUB_REPORT_TOKEN: "test-token" });
// The issue tracker, stood in for: what a report files.
const real = globalThis.fetch, filed: { title: string; body: string }[] = [];
beforeAll(() => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.github.com/")) return real(url as never, init);
    filed.push(check(obj({ title: str(500), body: str(5000) }), JSON.parse(String(init?.body)))!);
    return new Response(JSON.stringify({ number: 900 + filed.length }), { status: 201 });
  }) as never;
});
afterAll(() => { globalThis.fetch = real; });
const BRAWL = "https://excalibrawl.notryanquinn.workers.dev";

async function signUp(name: string, app: string, origin: string, email = `${name.toLowerCase()}@example.com`) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email, password: PASSWORD } });
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

test("a reported post reaches the report path; the studio hides it, brings it back and deletes it", async () => {
  const dee = await signUp("Dee", "excalibrawl", BRAWL), eli = await signUp("Eli", "excalibrawl", BRAWL);
  // The house studio holds Excalibrawl, with the super admin as its owner.
  const boss = await signUp("Boss", "excalibrawl", BRAWL, ADMIN);
  await house(conf, (await conf.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(ADMIN).first<string>("id"))!);
  const { post } = await read(await ask("POST", "/q/posts", dee, { kind: "prompt", text: "something rude" }), PostMade);
  const feed = async () => (await read(await ask("GET", "/q/posts?app=excalibrawl&kind=prompt"), PostList)).posts.map((p) => p.id);

  // Eli reports it: one issue, naming the post but not its words. Signed out, or on your own post, nothing is filed.
  expect((await ask("POST", `/q/posts/${post.id}/report`)).status).toBe(401);
  expect((await ask("POST", `/q/posts/${post.id}/report`, dee)).status).toBe(400);
  expect((await ask("POST", `/q/posts/${post.id}/report`, eli)).status).toBe(200);
  expect(filed.length).toBe(1);
  expect(filed[0]!.title).toContain("[excalibrawl]");
  expect(filed[0]!.body).toContain(post.id);
  expect(filed[0]!.body).not.toContain("something rude");

  // Only the studio hides: the post leaves both feeds, and comes back.
  expect((await ask("PUT", `/q/posts/${post.id}/hidden`, eli)).status).toBe(403);
  expect((await ask("PUT", `/q/posts/${post.id}/hidden`, boss)).status).toBe(200);
  expect(await feed()).toEqual([]);
  expect((await read(await ask("GET", "/q/posts?app=excalibrawl&kind=prompt&sort=top&since=0"), PostList)).posts).toEqual([]);
  expect((await ask("DELETE", `/q/posts/${post.id}/hidden`, boss)).status).toBe(200);
  expect(await feed()).toEqual([post.id]);

  // The studio deletes someone else's post; another player still can't.
  expect((await ask("DELETE", `/q/posts/${post.id}`, eli)).status).toBe(404);
  expect((await ask("DELETE", `/q/posts/${post.id}`, boss)).status).toBe(200);
  expect(await feed()).toEqual([]);
});

test("Ada blocks Bo: Bo's post leaves Ada's feed only, until she unblocks him", async () => {
  const ada = await signUp("Ada2", "excalibrawl", BRAWL), bo = await signUp("Bo2", "excalibrawl", BRAWL), cy = await signUp("Cy2", "excalibrawl", BRAWL);
  const { post: hers } = await read(await ask("POST", "/q/posts", ada, { kind: "prompt", text: "a duck in armour" }), PostMade);
  const { post } = await read(await ask("POST", "/q/posts", bo, { kind: "prompt", text: "a goose with a lance" }), PostMade);
  const feed = async (token?: string, top = false) =>
    (await read(await ask("GET", `/q/posts?app=excalibrawl&kind=prompt${top ? "&sort=top&since=0" : ""}`, token), PostList)).posts.map((p) => p.id);

  // Not your own, not signed out, not a post that isn't there; blocking twice is still one.
  expect((await ask("PUT", `/q/posts/${hers.id}/block`, ada)).status).toBe(400);
  expect((await ask("PUT", `/q/posts/${post.id}/block`)).status).toBe(401);
  expect((await ask("PUT", "/q/posts/nope/block", ada)).status).toBe(404);
  expect((await ask("PUT", `/q/posts/${post.id}/block`, ada)).status).toBe(200);
  expect((await ask("PUT", `/q/posts/${post.id}/block`, ada)).status).toBe(200);

  // Gone from Ada's feed, both sorts; still in Cy's, Bo's and the signed-out one.
  expect(await feed(ada)).not.toContain(post.id);
  expect(await feed(ada, true)).not.toContain(post.id);
  expect(await feed(ada)).toContain(hers.id);
  for (const who of [cy, bo, undefined]) expect(await feed(who)).toContain(post.id);

  // Ada's list names Bo by his id here, and that id unblocks him (only for her).
  const { blocked } = await read(await ask("GET", "/q/blocks", ada), Blocked);
  expect(blocked.map((b) => ({ id: b.id, name: b.name }))).toEqual([post.by]);
  expect((await ask("DELETE", `/q/blocks/${post.by.id}`, cy)).status).toBe(404);
  expect((await ask("DELETE", `/q/blocks/${post.by.id}`, ada)).status).toBe(200);
  expect(await feed(ada)).toContain(post.id);

  // Blocked again, then Bo deletes his account: the block goes with him.
  await ask("PUT", `/q/posts/${post.id}/block`, ada);
  expect((await call("/api/account/delete", { json: {}, bearer: bo, origin: BRAWL })).res.status).toBe(200);
  expect(await conf.DB.prepare("SELECT COUNT(*) AS n FROM blocks").first<number>("n")).toBe(0);
});
