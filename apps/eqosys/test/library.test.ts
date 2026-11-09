// A studio's game, from draft to everyone's shelf and back off it (listings.ts, LIBRARY.md): its maker signs in from its real site
// while it is a draft and a stranger can't; a refusal comes back with a note; listed, anyone signs in and sees it with the studio's
// name on it; pulled, the maker's token stops at the door and the sign-in is refused.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { ADMIN, asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const GAME = "https://rocket-golf.example";

test("a studio's game: a draft for its studio, reviewed, listed for everyone, then pulled", async () => {
  const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
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
  expect((await run("eq_listing_review", {}, { cookie: boss })).result.queue.map((l: { id: string }) => l.id)).toEqual(["rocket-golf"]);
  expect((await run("eq_listing_review", { id: "rocket-golf", verdict: "refuse" }, { cookie: boss })).status).toBe(400);
  await run("eq_listing_review", { id: "rocket-golf", verdict: "refuse", note: "Add an erase URL: it keeps scores per account." }, { cookie: boss });
  const studios = (await run("eq_studios", {}, { cookie: maya })).result.studios;
  expect(studios[0].apps).toEqual([expect.objectContaining({ id: "rocket-golf", state: "refused", note: expect.stringContaining("erase URL") })]);
  await run("eq_listing_save", { ...draft, erase: `${GAME}/erase` }, { cookie: maya });
  await run("eq_listing_send", { id: "rocket-golf" }, { cookie: maya });
  expect((await run("eq_listing_review", { id: "rocket-golf", verdict: "list" }, { cookie: boss })).result.listing.state).toBe("listed");

  // Listed: the stranger signs in and finds it on the shelf, with the studio's name on it.
  expect((await signIn("sam@example.com")).token).toBeTruthy();
  expect(await shelf(sam)).toMatchObject({ studio: "Acme" });

  // Pulled by its studio: off the shelf, the maker's token stops at the door, and a sign-in for it is refused.
  expect((await run("eq_listing_pull", { id: "rocket-golf" }, { cookie: maya })).result.listing.state).toBe("pulled");
  expect((await run("eq_whoami", {}, { bearer: mine.token! })).status).toBe(401);
  expect(await shelf(sam)).toBeUndefined();
  expect((await signIn("maya@example.com")).to).toBe("/login?e=app");
});
