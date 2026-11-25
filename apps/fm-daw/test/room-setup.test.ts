// The room setup, asked once: on the front door (/jam.html) a new browser picks the studio its rooms are made in, makes a
// room and walks in; back at the front door it isn't asked again, and the next room is made in the same studio. Settings
// (the cog) changes it, and the room after that is made in the new one. Headless Chrome over CDP (scripts/chrome.ts).
// What's checked is the front door and the link it walks you to, so the room itself is never loaded: its navigation is
// stopped (CDP Fetch) and the link read off it, and the front door stays up. Each front-door load costs ~37 s in software
// GL on CI's runners, so the test loads it three times, not once per step (#5893).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(240_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const t = Date.now();
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
  console.log(`room-setup: chrome and vite up in ${Date.now() - t} ms`);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

test.skipIf(!hasChrome)("the studio is asked on the first room only, kept after, and Settings changes it", async () => {
  const t0 = Date.now();
  const step = (what: string) => console.log(`room-setup ${((Date.now() - t0) / 1000).toFixed(1)}s: ${what}`);
  // its own browser context: a fresh browser's storage, not another test's
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
  const page = async <T>(expr: string): Promise<T> => tab.eval<T>(`(async () => (${expr}))()`);
  // a room's page (jam.html?room=...) is never opened: the link is what's checked, and the front door stays where it is
  const links: string[] = [];
  const pending = new Map<string, string>();
  chrome.cdp.on((m) => {
    if (m.sessionId !== tab.sessionId) return;
    if (m.method === "Fetch.requestPaused") {
      links.push(m.params.request.url);
      void tab.call("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "Aborted" });
    } else if (m.method === "Network.requestWillBeSent") pending.set(m.params.requestId, m.params.request.url);
    else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") pending.delete(m.params.requestId);
  });
  await tab.call("Fetch.enable", { patterns: [{ urlPattern: "*jam.html?room=*", resourceType: "Document" }] });
  step("tab open, room loads caught");
  // each look has its own deadline: a busy main thread holds an evaluate back, and the step should say so
  const until = async (expr: string) => {
    for (const end = Date.now() + 60_000; Date.now() < end; await Bun.sleep(100)) {
      const look = page<boolean>(expr).catch(() => false); // mid-navigation
      const got = await Promise.race([look, Bun.sleep(5_000).then(() => "held" as const)]);
      if (got === true) return;
      if (got === "held") step(`a look held 5 s: ${expr.slice(0, 60)}`);
    }
    throw new Error(`never: ${expr}`);
  };
  const frontDoor = async () => {
    pending.clear();
    await load(chrome.cdp, tab, `${vite.url}jam.html?quality=low`, 0);
    step(`front door loaded, ${pending.size} requests open${pending.size ? `: ${[...pending.values()].slice(0, 8).map((u) => u.slice(0, 100)).join(" | ")}` : ""}`);
    await until(`!!window.qjam && !document.getElementById("door-lobby").hidden`);
    step("front door ready");
  };
  const door = () => page<{ asked: boolean; kept: string; setup: string | null }>(`({
    asked: document.getElementById("room-studio").offsetParent !== null,
    kept: document.getElementById("room-studio-kept").offsetParent !== null ? document.getElementById("room-studio-kept-name").textContent : "",
    setup: qjam.state().door.setup,
  })`);
  /** Make a room on the front door: the studio its link names (the walk in is stopped, so the front door stays up). */
  const make = async (name: string) => {
    const n = links.length;
    await page(`(() => { document.getElementById("room-name").value = ${JSON.stringify(name)}; document.getElementById("make").requestSubmit(); return 1; })()`);
    for (const end = Date.now() + 10_000; links.length === n && Date.now() < end;) await Bun.sleep(50);
    const link = links[n];
    if (!link) throw new Error(`${name}: the front door never walked to a room`);
    step(`made ${name}`);
    expect(new URL(link).searchParams.get("name")).toBe(name);
    return new URL(link).searchParams.get("studio");
  };
  try {
    // first visit: asked, and the pick is the room's studio
    await frontDoor();
    expect(await door()).toEqual({ asked: true, kept: "", setup: null });
    await page(`(document.querySelector('#room-studio [data-studio="console-room"][data-copy="0"]').click(), 1)`);
    expect(await make("first jam")).toBe("console-room");

    // back at the front door: not asked, and the next room is in the same studio
    await frontDoor();
    expect(await door()).toEqual({ asked: false, kept: "The console room", setup: "console-room" });
    expect(await make("second jam")).toBe("console-room");

    // Settings changes it: the front door says so, still without asking, and the next room (after a reload) is in the new one
    await page(`(() => {
      document.querySelector(".gc-cog").click();
      const sel = document.getElementById("setup-studio");
      sel.value = "desert-gathering";
      sel.dispatchEvent(new Event("change"));
      return 1;
    })()`);
    expect(await door()).toEqual({ asked: false, kept: "Desert Gathering", setup: "desert-gathering" });
    await frontDoor();
    expect(await page<string>(`document.getElementById("setup-studio").value`)).toBe("desert-gathering");
    expect(await make("third jam")).toBe("desert-gathering");
  } finally {
    if (tab.noise.length) console.log(`room-setup noise:\n  ${tab.noise.slice(0, 30).join("\n  ")}`);
    await tab.close();
  }
});
