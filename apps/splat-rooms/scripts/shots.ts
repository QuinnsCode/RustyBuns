// Every screen of the lab, desk (1280x800) and phone (390x844), for a look climb's before/now set (#3623):
//   RB_NO_BROWSER=1 RB_TOKEN=x bun run desktop:dev        (in apps/splat-rooms; it serves a built client, so rebuild after a change)
//   bun scripts/shots.ts --url http://127.0.0.1:<port>/?token=x --out docs/shots-<date> --tag now [--room built_kitchen_3]
// Writes <tag>-<screen>-<desk|phone>.jpg: menu, eqosys (signed in, report form open), rooms, howto, browser, hunt,
// paused, win, controls. Scenes come from the desktop host, so the hunt and the browser need it running.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";

const { values: o } = parseArgs({ options: { url: { type: "string" }, out: { type: "string", default: "docs/shots" }, tag: { type: "string", default: "now" }, room: { type: "string", default: "built_kitchen_3" }, only: { type: "string" } } });
if (!o.url) throw new Error("--url <the desktop host's printed url> is required");
mkdirSync(o.out, { recursive: true });

const click = (text: string) => `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error("no button " + ${JSON.stringify(text)}); b.click(); })()`;
const key = (k: string, code = k, shift = false) => `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, code: ${JSON.stringify(code)}, shiftKey: ${shift} }))`;
const until = async (tab: Tab, expr: string, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) if (await tab.eval<boolean>(expr).catch(() => false)) return;
  throw new Error(`timed out waiting for ${expr}`);
};

const chrome = await launchChrome();
try {
  for (const [size, dim, mobile] of [["desk", { w: 1280, h: 800 }, false], ["phone", { w: 390, h: 844 }, true]] as const) {
    const tab = await openTab(chrome.cdp, dim, mobile);
    const shot = async (name: string, settle = 600) => {
      if (o.only && !o.only.split(",").includes(name)) return;
      await Bun.sleep(settle);
      const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      const file = join(o.out, `${o.tag}-${name}-${size}.jpg`);
      await Bun.write(file, Buffer.from(data, "base64"));
      console.log(file);
    };
    await load(chrome.cdp, tab, o.url, 2500);
    await until(tab, `!!document.querySelector(".uplink") && !/searching/.test(document.querySelector(".uplink").textContent)`);
    await shot("menu");

    // The eqosys chip signed in, and the report form open: a local eqosys setting makes this page one that can sign in.
    await tab.eval(`localStorage.setItem("splat-rooms.eqosys", "https://eqosys.qntbr.com"); localStorage.setItem("splat-rooms.login", JSON.stringify({ name: "Agent Brass Heron", email: "agent@example.com", token: "x" }))`);
    await load(chrome.cdp, tab, o.url, 2500);
    await tab.eval(click("Report"));
    await shot("eqosys");
    await tab.eval(`localStorage.removeItem("splat-rooms.eqosys"); localStorage.removeItem("splat-rooms.login")`);
    await load(chrome.cdp, tab, o.url, 2500);

    await tab.eval(click("Choose a room"));
    await shot("rooms");
    await tab.eval(click("← Menu"));
    await tab.eval(click("How to play"));
    await shot("howto");
    await tab.eval(click("← Menu"));

    await tab.eval(click("Room browser"));
    await until(tab, `!!window.splatRooms`);
    await tab.eval(`splatRooms.open(${JSON.stringify(o.room)})`);
    await shot("browser", 4000);
    await tab.eval(click("← Menu"));

    await tab.eval(click("Choose a room"));
    await tab.eval(`[...document.querySelectorAll(".room-card")].find((b) => b.textContent.includes(${JSON.stringify(o.room)})).click()`);
    await until(tab, `window.splatHunt?.state().phase === "hunting"`);
    for (let i = 0; i < 4; i++) { await tab.eval(key(" ", "Space")); await Bun.sleep(150); }
    await tab.eval(key(" ", "Space", true));
    await shot("hunt", 1200);
    await tab.eval(`splatHunt.pause()`);
    await shot("paused");
    await tab.eval(key("Escape"));
    await tab.eval(`splatHunt.find()`);
    await shot("win", 1500);

    await tab.eval(`document.querySelector(".gc-cog").click()`);
    await shot("controls");
    if (tab.noise.length) console.warn(`${size}:\n  ${tab.noise.join("\n  ")}`);
    await tab.close();
  }
} finally { chrome.stop(); }
