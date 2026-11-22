// A studio's game, from draft to everyone's shelf and back off it (listings.ts, LIBRARY.md): its maker signs in from its real site
// while it is a draft and a stranger can't; a refusal comes back with a note; listed, anyone signs in and sees it with the studio's
// name on it; pulled, the maker's token stops at the door and the sign-in is refused. The fix after a refusal goes through the Studio
// tab's form, a player's report lands with the studio (not on GitHub), and the shared achievements unlock there.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ADMIN, asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";
import { Studios } from "../src/app/Studio.tsx";
import type { Studio } from "../src/studios.ts";

setDefaultTimeout(30_000);
const GAME = "https://rocket-golf.example";

/** The outside web the review checks see (checks.ts): `site` answers by URL, anything else is no answer. */
const web = (site: Record<string, () => Response>) => ({
  fetch: async (url: string | Request) => {
    const u = typeof url === "string" ? url : url.url, r = site[u];
    if (!r) throw new TypeError("fetch failed");
    const res = r();
    Object.defineProperty(res, "url", { value: u });
    return res;
  },
});
/** Rocket Golf as the starter makes it: a page, its bundle with the harness on window, and its stylesheet. */
const ROCKET: Record<string, () => Response> = {
  [`${GAME}/`]: () => new Response('<!doctype html><link rel="stylesheet" href="/assets/main.css"><script type="module" src="/assets/main.js"></script>', { headers: { "content-type": "text/html; charset=utf-8" } }),
  [`${GAME}/assets/main.js`]: () => new Response("const h={state:()=>({})};window.rocketGolf=h;"),
  [`${GAME}/assets/main.css`]: () => new Response("body{margin:0}"),
};

/** The Studio tab as this person sees it, and what one of its forms posts as it stands: each field's name and value. */
async function formIn(studios: Studio[], label: string) {
  const html = renderToStaticMarkup(createElement(Studios, { studios, unlocks: new Map() }));
  const fields: Record<string, string> = {};
  let inside = false, text: string | null = null, select: string | null = null;
  const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" };
  const un = (v: string | null) => (v ?? "").replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, k: string) => ENTITY[k]!);
  await new HTMLRewriter()
    .on("form", { element(e) { inside = e.getAttribute("aria-label") === label; } })
    .on("input", { element(e) { if (inside) fields[e.getAttribute("name")!] = un(e.getAttribute("value")); } })
    .on("textarea", { element(e) { if (inside) fields[text = e.getAttribute("name")!] = ""; }, text(t) { if (inside && text) fields[text] += un(t.text); } })
    .on("select", { element(e) { select = inside ? e.getAttribute("name") : null; } })
    .on("option[selected]", { element(e) { if (select) fields[select] = un(e.getAttribute("value")); } })
    .transform(new Response(html)).text();
  return fields;
}

test("a studio's game: a draft for its studio, reviewed, listed for everyone, then pulled", async () => {
  const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), OUTBOUND: web(ROCKET) });
  const signUp = async (name: string, email: string) => (await call("/do/signup", { form: { ...(await asks("park-hide-seek", PARK)).form, name, email, password: PASSWORD } })).cookie;
  const [boss, maya, sam] = [await signUp("Boss", ADMIN), await signUp("Maya", "maya@example.com"), await signUp("Sam", "sam@example.com")];
  const run = async (name: string, args: unknown, who: { cookie?: string; bearer?: string }) => {
    const { res } = await call(`/api/tools/${name}`, { json: args, ...who });
    const body = await res.json() as { result?: any; error?: string };
    return { status: res.status, ...body };
  };
  /** Signing in to the game from its own page: where the browser lands, and the token the game trades the code for. */
  const signIn = async (email: string) => {
    const a = await asks("rocket-golf", GAME);
    const { to } = await call("/do/signin", { form: { ...a.form, email, password: PASSWORD } });
    if (!to.startsWith(GAME)) return { to, token: null };
    const { res } = await call("/api/exchange", { origin: GAME, json: { app: "rocket-golf", code: codeIn(to), verifier: a.verifier } });
    expect(res.headers.get("access-control-allow-origin")).toBe(GAME);
    return { to, token: (await res.json() as { token: string }).token };
  };
  const shelf = async (who: string) => ((await run("eq_apps", {}, { cookie: who })).result.apps as { id: string; studio?: string }[]).find((a) => a.id === "rocket-golf");

  const studio = (await run("eq_studio_make", { name: "Acme", kind: "team" }, { cookie: maya })).result.id;
  const draft = { studio, id: "rocket-golf", name: "Rocket Golf", genre: "Sports & Skate", origins: [GAME], blurb: "Golf, with rockets." };
  expect((await run("eq_listing_save", draft, { cookie: sam })).status).toBe(403);
  expect((await run("eq_listing_save", { ...draft, id: "park-hide-seek" }, { cookie: maya })).status).toBe(409);
  expect((await run("eq_listing_save", draft, { cookie: maya })).result.listing).toMatchObject({ state: "draft", maturity: "experimental", starts: ["play"] });

  // A draft: its maker signs in from the real site and its token opens the doors; a stranger is sent home, and nobody else sees it.
  const mine = await signIn("maya@example.com");
  expect((await run("eq_whoami", {}, { bearer: mine.token! })).result).toMatchObject({ name: "Maya", via: "token for rocket-golf" });
  expect(await signIn("sam@example.com")).toEqual({ to: "/?e=making", token: null });
  expect(await shelf(sam)).toBeUndefined();

  // Sent, refused with a note, fixed and sent again, then listed.
  expect((await run("eq_listing_send", { id: "rocket-golf" }, { cookie: maya })).result.listing.state).toBe("in review");
  expect((await run("eq_listing_review", {}, { cookie: maya })).status).toBe(403);
  // The queue shows what a machine checked on the way in: Maya signed in from the real site above, and its bundle has the harness.
  const [queued] = (await run("eq_listing_review", {}, { cookie: boss })).result.queue;
  expect(queued.id).toBe("rocket-golf");
  expect(queued.checks.list.map((c: { name: string; ok: boolean }) => [c.name, c.ok])).toEqual([["https", true], ["loads", true], ["signin", true], ["state", true]]);
  expect(queued.checks.list[3].says).toContain(`bun run probe --url ${GAME}/ --js "rocketGolf.state()"`);
  expect((await run("eq_apps", {}, { cookie: maya })).result.apps.find((a: { id: string }) => a.id === "rocket-golf")?.checks).toBeUndefined();
  expect((await run("eq_listing_review", { id: "rocket-golf", verdict: "refuse" }, { cookie: boss })).status).toBe(400);
  await run("eq_listing_review", { id: "rocket-golf", verdict: "refuse", note: "Add an erase URL: it keeps scores per account." }, { cookie: boss });
  const studios = (await run("eq_studios", {}, { cookie: maya })).result.studios;
  expect(studios[0].apps).toEqual([expect.objectContaining({ id: "rocket-golf", state: "refused", note: expect.stringContaining("erase URL") })]);
  // Fixed and sent again from the Studio tab's form: what it shows for the game, with the erase URL filled in.
  const form = { ...await formIn(studios, "Change Rocket Golf"), erase: `${GAME}/erase` };
  expect(form).toMatchObject({ studio, id: "rocket-golf", name: "Rocket Golf", genre: "Sports & Skate", origins: GAME, returns: "" });
  expect((await call("/do/listing-save", { form, cookie: sam })).to).toBe("/?tab=studio&e=gameowner");
  expect((await call("/do/listing-save", { form: { ...form, origins: "http://rocket-golf.example" }, cookie: maya })).to).toBe("/?tab=studio&e=game");
  expect((await call("/do/listing-save", { form, cookie: maya })).to).toBe("/?tab=studio");
  expect((await call("/do/listing-send", { form, cookie: maya })).to).toBe("/?tab=studio");
  expect((await call("/do/listing-send", { form, cookie: maya })).to).toBe("/?tab=studio&e=gamestep");
  expect((await run("eq_listing_review", { id: "rocket-golf", verdict: "list" }, { cookie: boss })).result.listing.state).toBe("listed");

  // Listed: the stranger signs in and finds it on the shelf, with the studio's name on it.
  expect((await signIn("sam@example.com")).token).toBeTruthy();
  expect(await shelf(sam)).toMatchObject({ studio: "Acme" });

  // A player's report goes to the studio, not to this repo's issues (no GitHub token here at all), under an opaque id.
  const stranger = (await signIn("sam@example.com")).token!;
  const report = (body: unknown) => call("/api/report", { json: body, bearer: stranger, origin: GAME }).then((r) => r.res.status);
  expect(await report({ kind: "bug", title: "Ball goes through the green", body: "Third hole, every time.", page: "/play?party=KX7Q" })).toBe(200);
  expect(await report({ kind: "rant", title: "no", body: "x" })).toBe(400);
  const theirs = (await run("eq_studios", {}, { cookie: maya })).result.studios, [inbox] = theirs[0].apps;
  expect(await formIn(theirs, "Change Rocket Golf")).toMatchObject({ erase: `${GAME}/erase` });
  expect(inbox.reports).toEqual([expect.objectContaining({ kind: "bug", title: "Ball goes through the green", text: "Third hole, every time.", page: "/play", from: expect.stringMatching(/^u_/) })]);
  expect(JSON.stringify(inbox.reports)).not.toContain("sam@example.com");

  // The shared achievements: played unlocks, alpha doesn't while it is experimental, its own list is none yet, and tutorial waits for its tutorial.
  const achieve = (id: string) => call("/q/achieve", { json: { id }, bearer: stranger, origin: GAME }).then((r) => r.res.status);
  expect([await achieve("played"), await achieve("alpha"), await achieve("first-basket")]).toEqual([200, 404, 404]);
  expect((await run("eq_achievements", { app: "rocket-golf" }, { cookie: sam })).result).toMatchObject({ unlocked: 1, total: 2 });

  // Pulled by its studio: off the shelf, the maker's token stops at the door, and a sign-in for it is refused.
  expect((await run("eq_listing_pull", { id: "rocket-golf" }, { cookie: maya })).result.listing.state).toBe("pulled");
  expect((await run("eq_whoami", {}, { bearer: mine.token! })).status).toBe(401);
  expect(await shelf(sam)).toBeUndefined();
  expect((await signIn("maya@example.com")).to).toBe("/login?e=app");
});

test("the machine checks say what is wrong: a dead origin, a missing file, no sign-in yet, no harness", async () => {
  const { call } = await boot({ OUTBOUND: web({ [`${GAME}/`]: ROCKET[`${GAME}/`]!, [`${GAME}/assets/main.css`]: ROCKET[`${GAME}/assets/main.css`]! }) });
  const signUp = async (name: string, email: string) => (await call("/do/signup", { form: { ...(await asks("park-hide-seek", PARK)).form, name, email, password: PASSWORD } })).cookie;
  const [boss, maya] = [await signUp("Boss", ADMIN), await signUp("Maya", "maya@example.com")];
  const run = async (name: string, args: unknown, cookie: string) => (await (await call(`/api/tools/${name}`, { json: args, cookie })).res.json() as { result?: any; error?: string });
  const studio = (await run("eq_studio_make", { name: "Acme", kind: "team" }, maya)).result.id;
  await run("eq_listing_save", { studio, id: "rocket-golf", name: "Rocket Golf", genre: "Sports & Skate", origins: [GAME, "https://www.rocket-golf.example"] }, maya);
  await run("eq_listing_send", { id: "rocket-golf" }, maya);
  const [queued] = (await run("eq_listing_review", {}, boss)).result.queue;
  const by = Object.fromEntries(queued.checks.list.map((c: { name: string }) => [c.name, c]));
  expect(by.https).toMatchObject({ ok: false, says: "https://www.rocket-golf.example: no answer" });
  expect(by.loads).toMatchObject({ ok: false, says: `${GAME}/assets/main.js: no answer` });
  expect(by.signin).toMatchObject({ ok: false, says: expect.stringContaining("nobody in the studio") });
  expect(by.state).toMatchObject({ ok: false, says: expect.stringContaining("no window.rocketGolf") });
  // Asked again after a fix: the checks run again and the queue keeps the new ones.
  expect((await run("eq_listing_review", { id: "rocket-golf", verdict: "check" }, boss)).result.checks.list).toHaveLength(4);
  expect((await run("eq_listing_review", { id: "park-hide-seek", verdict: "check" }, boss)).error).toContain("no game");
});
