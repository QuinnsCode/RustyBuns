// The spaces panel a game mounts (@rustybuns/util/spaces), through a real page: a signed-in player makes a space, a friend
// joins by its invite from another Q app, they talk both ways in #general, the owner opens a voice channel and talks in
// it (Qlave's client stood in for by the page) while the friend sees them there, and the owner kicks the friend from their row.
// eqosys runs in-process with its Space DO and also serves the page; headless Chrome drives it over CDP (scripts/chrome.ts).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space } from "@rustybuns/util/eqosys";
import type { SpacesState } from "@rustybuns/util/spaces";
import { newKey } from "@rustybuns/util/token";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { handle } from "../src/handle.ts";
import { Space } from "../src/qollab/space.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(120_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "spaces-page.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), LOOPBACK_RETURNS: "1" });
conf.SPACE = durableObject(Space as never, conf) as never;
// Qlave's orders come back here, so nothing leaves the machine.
const orders: unknown[] = [];
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => {
  const path = new URL(req.url).pathname;
  if (path === "/panel") return new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/panel.js"></script>`, { headers: { "content-type": "text/html" } });
  if (path === "/panel.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
  if (path === "/qlave/eqosys") { orders.push(await req.json()); return Response.json({ ok: true }); }
  return (await handle(req, conf)) ?? new Response("no", { status: 404 });
} } as never, {});
const base = `http://127.0.0.1:${shell.port}`;
conf.QLAVE_URL = `${base}/qlave`;

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); shell.stop(); });

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  return (await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string }).token;
}
const until = async (what: string, f: () => Promise<unknown> | unknown, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await f()) return;
  throw new Error(`never saw ${what}`);
};

test("make a space in the panel, a friend joins by invite, they talk, the owner kicks", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK), bo = await signUp("Bo", "qcrm", QCRM);
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await load(chrome.cdp, tab, `${base}/panel?${new URLSearchParams({ token: ada, name: "Ada" })}`, 0);
  const state = () => tab.eval<SpacesState>("panel.state()").catch(() => null);
  const seen = async (what: string, ok: (s: SpacesState) => boolean) => {
    try { await until(what, async () => { const s = await state(); return s && ok(s); }); } catch (e) { throw new Error(`${(e as Error).message}: ${JSON.stringify(await state())}`); }
  };
  const type = (placeholder: string, text: string) => tab.eval(`(() => { const i = document.querySelector('#spaces input[placeholder=${JSON.stringify(placeholder)}]'); i.value = ${JSON.stringify(text)}; i.form.requestSubmit(); })()`);
  const press = (title: string) => tab.eval(`document.querySelector('#spaces button[title=${JSON.stringify(title)}]').click()`);

  await seen("an empty list", (s) => s.open === null && s.spaces.length === 0);
  await type("Name a new space", "Night ride");
  await seen("the new space open on #general", (s) => s.open === "Night ride" && s.channel === "general" && s.online.join() === "Ada");

  const friend = space({ url: () => base, token: () => bo });
  const invite = (await space({ url: () => base, token: () => ada }).mine())![0]!.invite!;
  const joined = (await friend.join(invite))!;
  const heard: string[] = [];
  let gone = "", friendSees: string[] = [];
  friend.open(joined.id, {
    said: (_, m) => heard.push(`${m.from.name}: ${m.text}`), gone: (w) => (gone = w),
    online: (m) => (friendSees = m.map((x) => (x.voice ? `${x.name} in voice` : x.name))),
  });
  await seen("Bo online", (s) => s.online.join() === "Ada,Bo");

  friend.say("general", "on my way");
  await seen("Bo's line", (s) => s.messages.includes("Bo: on my way"));
  await type("Message #general", "meet at the bowl");
  await until("Ada's line at Bo's end", () => heard.includes("Ada: meet at the bowl"));

  // Voice: the owner adds a channel, joins it with a fresh ticket, and the friend sees them in it.
  await type("new-voice-channel", "lounge");
  await seen("the lounge tab", (s) => s.voices.join() === "lounge");
  await tab.eval(`[...document.querySelectorAll('#spaces [role=tab]')].find((b) => b.textContent === "lounge").click()`);
  await press("Join lounge");
  await seen("Ada in the lounge", (s) => s.inVoice === "lounge" && s.speakers.join() === "Ada");
  expect(await tab.eval<string>("voice.tickets[0]")).toStartWith(`${base}/qlave ey`);
  await until("Bo seeing Ada in voice", () => friendSees.includes("Ada in voice"));
  await press("Mute yourself");
  await seen("Ada muted", (s) => s.speakers.join() === "Ada (muted)");
  // Qlave closing the room (here: the stand-in says the room ended) takes Ada out, and everyone sees it.
  await tab.eval(`voice.gone("ended")`);
  await seen("Ada out of voice", (s) => s.inVoice === null && s.note === "That voice channel ended.");
  await until("Bo seeing Ada leave voice", () => friendSees.join() === "Ada,Bo");

  await press("Kick Bo");
  await seen("Bo gone", (s) => s.online.join() === "Ada");
  await until("Bo closed out", () => gone);
  await until("the kick sent to Qlave", () => orders.some((o) => JSON.stringify(o).includes('"t":"kick"')));

  expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);
  await tab.close();
});
