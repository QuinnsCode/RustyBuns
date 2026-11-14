// The lobby end to end (#3706): two signed-in players in Chrome, eqosys's own Worker code and party Durable Object here
// in Bun, and the game's door checking their tokens. The host's "Walk together" mints a party, a friend opens its link,
// a first-timer with no account opens the copied link, signs up in the small eqosys window beside the game and is seated (#4418),
// says Ready, the host says Start, and both walk one world in the party's room, each seeing the other by name.
// It needs Chrome, which a GitHub runner has but whose GPU-less headless WebGL stalls, so CI skips it (as together.test.ts).
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { check, obj, str } from "@rustybuns/util/guard";
import { newKey } from "@rustybuns/util/token";
import { chromePath, freePort, launchChrome, load, openTab, startVite, type Tab } from "../../../scripts/chrome.ts";
import { APP } from "../src/account.ts";
import { serveEdge } from "../scripts/edge.ts";

setDefaultTimeout(150_000);
/** What eqosys's /api/exchange hands back that this test uses. */
const Exchanged = obj({ user: obj({ id: str(200) }), token: str(4096) });
const stops: (() => unknown)[] = [];
afterAll(async () => { for (const s of stops.reverse()) await s(); });

test.skipIf(!chromePath() || !!process.env.CI)("a party's lobby: Walk together, a friend opens the link (a stranger with the code alone is told to ask, a first-timer with the link signs up beside the game), Ready, Start, and both walk one room", async () => {
  // eqosys and its shell are loaded here, not at the top: CI installs only this app's packages, and skips this test.
  const { durableObject, serve } = await import("../../../packages/shell-bun/src/index.ts");
  const { handle } = await import("../../eqosys/src/handle.ts");
  const { Hub } = await import("../../eqosys/src/qollab/hub.ts");
  const { Party } = await import("../../eqosys/src/qollab/party.ts");
  const { asks, boot, codeIn, PASSWORD } = await import("../../eqosys/test/kit.ts");
  // A local eqosys on a port of its own, so the tokens it signs name the address the game's door fetches its keys from.
  const eqPort = await freePort(), eq = `http://127.0.0.1:${eqPort}`;
  const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), BETTER_AUTH_URL: eq, LOOPBACK_RETURNS: "1" });
  conf.PARTY = durableObject(Party as never, conf) as never;
  conf.HUB = durableObject(Hub as never, conf) as never;
  const shell = serve<unknown>({ hostname: "127.0.0.1", port: eqPort });
  shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
  stops.push(() => shell.stop());
  // The game's Worker and Region under workerd with the live door: every join to /ws carries a token eqosys signed.
  // (Not the Bun stand-in: eqosys's shell here installs its own WebSocketPair, which the stand-in's rooms can't share.)
  const port = await freePort();
  const edge = await serveEdge(port, { guests: false, eqosys: eq });
  stops.push(() => edge.stop());
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  stops.push(() => vite.stop());
  const chrome = await launchChrome();
  stops.push(() => chrome.stop());

  /** Sign up for Mythic Masters on the local eqosys, as its sign-in page does, and trade the code for a login. */
  const signUp = async (name: string) => {
    const a = await asks(APP, new URL(vite.url).origin);
    const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
    const got = check(Exchanged, await (await call("/api/exchange", { json: { app: APP, code: codeIn(up.to), verifier: a.verifier } })).res.json());
    if (!got) throw new Error(`no login for ${name}`);
    return { id: got.user.id, login: { name, email: `${name.toLowerCase()}@example.com`, token: got.token } };
  };
  const ada0 = await signUp("Ada"), bo0 = await signUp("Bo"), cy0 = await signUp("Cy");
  // A party the host makes admits the host's eqosys friends: Bo asks for Ada, and she says yes.
  const hub = async (token: string, body: unknown) => (await call("/api/hub", { json: body, bearer: token, origin: new URL(vite.url).origin })).res.status;
  expect(await hub(bo0.login.token, { op: "befriend", email: ada0.login.email })).toBe(200);
  expect(await hub(ada0.login.token, { op: "accept", id: bo0.id })).toBe(200);
  /** A tab of its own (its own storage), signed in on the local eqosys, opened at `query`. */
  const player = async (who: Awaited<ReturnType<typeof signUp>>, query: string) => {
    const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true);
    await load(chrome.cdp, t, vite.url, 500);
    await t.eval(`localStorage.setItem("mm.eqosys", ${JSON.stringify(eq)}); localStorage.setItem("mm.login", ${JSON.stringify(JSON.stringify(who.login))})`);
    await load(chrome.cdp, t, new URL(query, vite.url).href, 3000);
    return t;
  };
  const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000) => {
    const end = Date.now() + ms;
    for (let v = await get(); !ok(v); v = await get()) { if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(300); }
  };
  const lobby = (t: Tab) => t.eval<string>(`document.querySelector("#worldHud .lobby")?.textContent ?? ""`);
  const press = (t: Tab, text: string) => t.eval<boolean>(`(() => { const b = [...document.querySelectorAll("#worldHud button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);
  const search = (t: Tab) => t.eval<string>("location.search");

  // Ada, signed in and alone in the world, presses Walk together: she is in her party's lobby, its host.
  const ada = await player(ada0, "?world=1&a=hodag");
  await until(() => ada.eval<boolean>(`!!document.querySelector("#worldHud .together button")`), (on) => on);
  await ada.eval(`document.querySelector("#worldHud .together button").click()`);
  await until(() => search(ada), (s) => /party=[A-Z]+/.test(s));
  const code = /party=([A-Z]+)/.exec(await search(ada))![1]!;
  await until(() => lobby(ada), (l) => l.includes("Ada (host)"));
  // Bo opens the link she sent him: both see both, and he says he's ready.
  const bo = await player(bo0, `?world=1&party=${code}&a=jersey-devil`);
  await until(() => lobby(ada), (l) => l.includes("Bo"));
  // Cy, who isn't Ada's friend, opens the same link: the lobby says why they can't join, not that the code is wrong.
  const cy = await player(cy0, `?world=1&party=${code}&a=hodag`);
  await until(() => lobby(cy), (l) => l.includes("Only the host's friends can join with the code alone: ask someone in the party for its link."));
  expect(await lobby(ada)).not.toContain("Cy");
  // Ada copies the party link (it carries the invite key and her name). Dee, with no account, opens it in a browser of her own.
  await ada.eval(`navigator.clipboard.writeText = async (t) => { window.copied = t; }`);
  expect(await press(ada, "Copy link")).toBe(true);
  const sent = await ada.eval<string>("window.copied");
  expect(new URL(sent).searchParams.get("from")).toBe("Ada");
  const dee = await openTab(chrome.cdp, { w: 390, h: 760 }, true, true);
  await load(chrome.cdp, dee, vite.url, 500);
  await dee.eval(`localStorage.setItem("mm.eqosys", ${JSON.stringify(eq)})`);
  await load(chrome.cdp, dee, `${sent}&a=hodag`, 3000);
  await until(() => lobby(dee), (l) => l.includes("Sign in to join Ada's party"));
  // Sign in opens eqosys in a small window beside the game; she makes an account there and eqosys sends the window back.
  await dee.call("Runtime.evaluate", { expression: `[...document.querySelectorAll("#worldHud .lobby button")].find((b) => b.textContent.trim() === "Sign in").click()`, userGesture: true });
  const popup = async () => ((await chrome.cdp.send("Target.getTargets", {})).targetInfos as { url: string }[]).find((t) => t.url.startsWith(`${eq}/login?`))?.url ?? "";
  await until(popup, (u) => !!u);
  const ask = new URL(await popup()).searchParams;
  const up = await call("/do/signup", { form: { app: ask.get("app")!, return: ask.get("return")!, challenge: ask.get("challenge")!, state: ask.get("state")!, name: "Dee", email: "dee@example.com", password: PASSWORD } });
  await dee.call("Runtime.evaluate", { expression: `void window.open(${JSON.stringify(up.to)}, "eq-signin")`, userGesture: true });
  // The game never reloaded: the login came back to it, and she is in Ada's lobby, though they were never friends.
  await until(() => lobby(ada), (l) => l.includes("Dee"));
  await until(() => lobby(dee), (l) => l.includes("Ada (host)"));
  expect(await dee.eval<string>("location.search")).toContain(`party=${code}`);
  expect(await press(dee, "Ready")).toBe(true);
  await until(() => lobby(ada), (l) => l.includes("Dee ready"));
  expect(await press(bo, "Ready")).toBe(true);
  await until(() => lobby(ada), (l) => l.includes("Bo ready"));
  // Ada starts: both pages go to the room the party was given, through the door that checks their tokens, and each
  // sees the other walking there, by the name eqosys knows them by.
  expect(await press(ada, "Start")).toBe(true);
  await until(() => Promise.all([search(ada), search(bo)]), ([a, b]) => /room=/.test(a) && a === b);
  await until(() => Promise.all([ada, bo].map((t) => t.eval<boolean>(`typeof mythicMasters !== "undefined" && !!mythicMasters.world.online()`))), (up) => up.every(Boolean));
  const friends = (t: Tab) => t.eval<{ name: string }[]>(`mythicMasters.world.online()?.friends ?? []`);
  const walk = (t: Tab) => t.eval(`(async () => { const w = mythicMasters.world, s = w.state(); for (let i = 0; i < 4; i++) { w.teleport(s.x + 3 + i * 0.4, s.z - 6); await new Promise((r) => setTimeout(r, 200)); } })()`);
  await until(() => Promise.all([walk(ada), walk(bo)]).then(() => Promise.all([friends(ada), friends(bo)])), ([a, b]) => [a, b].map((f) => f.map((x) => x.name).sort().join()).join("|") === "Bo,Dee|Ada,Dee");
  expect([...ada.noise, ...bo.noise, ...cy.noise, ...dee.noise].filter((n) => !/favicon|api\/me|401/.test(n))).toEqual([]);
});
