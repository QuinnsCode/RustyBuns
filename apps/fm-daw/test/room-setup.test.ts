// The room setup, asked once: on the front door (/jam.html) a new browser picks the studio its rooms are made in, makes a
// room and walks in; back at the front door it isn't asked again, and the next room is made in the same studio. Settings
// (the cog) changes it, and the room after that is made in the new one. Headless Chrome over CDP (scripts/chrome.ts).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

// walking into a room draws a 3D scene in software on CI's runners
setDefaultTimeout(240_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

test.skipIf(!hasChrome)("the studio is asked on the first room only, kept after, and Settings changes it", async () => {
  // its own browser context: a fresh browser's storage, not another test's
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
  const page = async <T>(expr: string): Promise<T> => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (expr: string) => {
    for (const end = Date.now() + 60_000; Date.now() < end; await Bun.sleep(100)) {
      try { if (await page<boolean>(expr)) return; } catch { /* mid-navigation */ }
    }
    throw new Error(`never: ${expr}`);
  };
  const frontDoor = async () => {
    await load(chrome.cdp, tab, `${vite.url}jam.html?quality=low`, 0);
    await until(`!!window.qjam && !document.getElementById("door-lobby").hidden`);
  };
  const door = () => page<{ asked: boolean; kept: string; setup: string | null }>(`({
    asked: document.getElementById("room-studio").offsetParent !== null,
    kept: document.getElementById("room-studio-kept").offsetParent !== null ? document.getElementById("room-studio-kept-name").textContent : "",
    setup: qjam.state().door.setup,
  })`);
  /** Make a room on the front door and walk in: the studio its link names. */
  const make = async (name: string) => {
    await page(`(() => { document.getElementById("room-name").value = ${JSON.stringify(name)}; document.getElementById("make").requestSubmit(); return 1; })()`);
    await until(`new URLSearchParams(location.search).has("room") && !!window.qjam`);
    return page<string>(`new URLSearchParams(location.search).get("studio")`);
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

    // Settings changes it: the front door says so, still without asking, and the next room is in the new one
    await frontDoor();
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
  } finally { await tab.close(); }
});
