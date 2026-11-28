// The journey through the running app: `bun run dev`'s server, the page open in headless Chrome, and an agent calling
// its tools over the relay's HTTP door. An edit changes the world in the sealed frame, an edit that matches twice is
// refused, and a world written with @world/kit runs there with no errors and hears where a visitor walks.
// The kit's three.js comes from esm.sh, as it does for a person.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { arr, bool, obj, opt, str } from "@rustybuns/util/guard";
import { join } from "node:path";
import { chromeStartMs, launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";
import { WORLD } from "./session.ts";

setDefaultTimeout(60_000);

const ROOM = "kitjourney0001";
const Reply = obj({ ok: opt(bool()), error: opt(str(2000)), said: opt(arr(str(600), 20)) });
let server: ReturnType<typeof Bun.spawn<"ignore", "pipe", "inherit">>, chrome: Awaited<ReturnType<typeof launchChrome>>, tab: Tab, origin = "";

const call = async (name: string, args: unknown = {}) =>
  Reply(await (await fetch(`${origin}/api/r/${ROOM}/tools/${name}`, { method: "POST", body: JSON.stringify(args) })).json());

/** page_read until the frame has said `line`, then everything it said. */
async function heard(line: string, ms = 45_000) {
  const end = Date.now() + ms;
  for (;;) {
    const said = (await call("page_read")).said ?? [];
    if (said.some((s) => s.includes(line))) return said;
    if (Date.now() > end) throw new Error(`the frame never said "${line}": it said ${said.join(" | ")}`);
    await Bun.sleep(200);
  }
}

beforeAll(async () => {
  server = Bun.spawn(["bun", "scripts/dev.ts", "--port", "0"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "inherit", stdin: "ignore" });
  const out = server.stdout.getReader();
  for (let text = ""; !origin;) {
    const { value, done } = await out.read();
    if (done) throw new Error(`the dev server stopped: ${text}`);
    text += new TextDecoder().decode(value);
    origin = text.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? "";
  }
  chrome = await launchChrome();
  tab = await openTab(chrome.cdp, { w: 1000, h: 700 });
  await load(chrome.cdp, tab, `${origin}/r/${ROOM}`, 500);
  // The relay answers 409 until the page's socket is up.
  for (const end = Date.now() + 30_000; (await call("page_read")).said === undefined; await Bun.sleep(200)) {
    if (Date.now() > end) throw new Error("the page never reached the relay");
  }
}, chromeStartMs + 60_000);
afterAll(() => { chrome?.stop(); server?.kill(); });

test("page_edit_file changes one place and the world reloads with it; two matches are refused with the count", async () => {
  expect(await call("page_edit_file", { path: "world.js", find: `sky("night");`, replace: `sky("night");\nconsole.error("edited");` })).toMatchObject({ ok: true });
  await heard("edited");
  const twice = await call("page_edit_file", { path: "world.js", find: "size: [", replace: "" });
  expect(twice.error).toContain("matches 2 places in world.js");
  // Undo takes an edit back like any other change.
  expect(await call("page_undo")).toMatchObject({ ok: true });
  await heard("no errors");
});

test("a world written with @world/kit runs in the sealed frame with no errors and hears a visitor walk", async () => {
  // Its own lines, plus two that report back: one after frames were drawn, one on a visitor.
  const probe = `\nimport { onPlayer, every } from "@world/kit";\nonPlayer((p, at) => console.error("visitor " + JSON.stringify([p, at && [at.x, at.z]])));\nlet n = 0;\nevery(() => { if (++n === 5) console.error("drew"); });\n`;
  expect(await call("page_write_file", { path: "world.js", text: WORLD + probe })).toMatchObject({ ok: true });
  expect(await heard("drew")).toEqual(["error: drew"]);
  await tab.eval(`document.querySelector("iframe.world").contentWindow.postMessage({ agent_page: true, player: { x: 0.75, z: 0.5 } }, "*")`);
  expect(await heard("visitor")).toEqual(["error: drew", `error: visitor [{"x":0.75,"z":0.5},[50,0]]`]);
});
