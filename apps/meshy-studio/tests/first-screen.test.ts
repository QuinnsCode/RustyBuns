// A newcomer's first screen, through the running app: no key saved, the page shows a drawing and a 3D model they
// can turn by dragging, with the key box under it. The desktop host's routes answer from an empty data folder.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import host, { _reset } from "../desktop/host.ts";
import { chromePath, glFlags, launchChrome, load, openTab, startVite, waitFor, type Chrome } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000); // vite serves the app cold, then draws a 3D model in headless Chrome

type Sample = { loaded: boolean; error: string | null; turn: number };
const root = mkdtempSync(join(tmpdir(), "meshy-first-"));
const ctx = { env: {}, dataDir: root, identity: {}, reporter: { breadcrumb() {}, report() {}, escaped() {} } } as never;
let chrome: Chrome, vite: Awaited<ReturnType<typeof startVite>>, server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  if (!chromePath()) return;
  delete process.env.MESHY_API_KEY;
  _reset();
  [chrome, vite] = await Promise.all([launchChrome(glFlags()), startVite(new URL("..", import.meta.url).pathname)]);
  // The host's routes here, the page from vite: what the desktop window does in one process.
  server = Bun.serve({ port: 0, fetch: async (req) => (await host.fetch(req, ctx)) ?? fetch(new URL(new URL(req.url).pathname + new URL(req.url).search, vite.url), { headers: req.headers }) });
});
afterAll(() => { chrome?.stop(); vite?.stop(); server?.stop(true); _reset(); rmSync(root, { recursive: true, force: true }); });

test.skipIf(!chromePath())("with no key, a phone and a desktop show a model to turn, and the key box under it", async () => {
  for (const [w, h, mobile] of [[1280, 720, false], [390, 844, true]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile, true);
    await load(chrome.cdp, tab, `http://127.0.0.1:${server.port}/`, 1500);
    await waitFor(tab, "the sample loaded", "window.meshySample?.state().loaded", 20_000, "window.meshySample?.state() ?? null", 200);
    expect(await tab.eval<Sample>("window.meshySample.state()")).toMatchObject({ loaded: true, error: null });
    // The key box is there, under the example, and on a phone the whole first screen fits.
    const key = await tab.eval<{ top: number; below: boolean }>(`(() => {
      const k = document.querySelector("input[aria-label='Meshy API key']").getBoundingClientRect();
      return { top: k.top, below: k.top > document.querySelector("[aria-label='An example']").getBoundingClientRect().bottom };
    })()`);
    expect(key.below).toBe(true);
    if (mobile) expect(key.top).toBeLessThan(h);

    // A drag across the model turns it (and stops it turning on its own).
    const at = await tab.eval<{ x: number; y: number }>(`(() => { const b = document.querySelector(".spinner").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const mouse = (type: string, x: number, buttons = 1) => tab.call("Input.dispatchMouseEvent", { type, x, y: at.y, button: "left", buttons, clickCount: 1 });
    await mouse("mousePressed", at.x);
    const before = (await tab.eval<Sample>("window.meshySample.state()")).turn;
    for (let i = 1; i <= 5; i++) await mouse("mouseMoved", at.x + i * 20);
    await mouse("mouseReleased", at.x + 100, 0);
    const after = (await tab.eval<Sample>("window.meshySample.state()")).turn;
    expect(after - before).toBeCloseTo(100 * 0.012, 1);
    expect(tab.noise.filter((n) => !/favicon/.test(n))).toEqual([]);
    await tab.close();
  }
});
