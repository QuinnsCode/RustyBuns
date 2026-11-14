// A shopper on a phone puts a photo on the demo cap and sizes and turns it with two fingers, then pinches the empty
// space beside the cap to zoom the camera. Headless Chrome (scripts/chrome.ts) sends real touches over CDP, so the
// viewer's pointer handlers and OrbitControls both see them the way a phone's would.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { freePort, launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";

setDefaultTimeout(90_000);

// The demo shop as `bun run dev` serves it (the widget from source), on a port of its own.
let dev: ReturnType<typeof Bun.spawn>, chrome: Awaited<ReturnType<typeof launchChrome>>;
const page = { url: "" };
beforeAll(async () => {
  const port = await freePort();
  dev = Bun.spawn(["bun", "scripts/dev.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, QVIEW_PORT: String(port), MESHY_API_KEY: "" }, stdout: "ignore", stderr: "ignore" });
  page.url = `http://localhost:${port}/`;
  for (let i = 0; i < 120 && !(await fetch(page.url).then((r) => r.ok, () => false)); i++) await Bun.sleep(250);
  chrome = await launchChrome();
});
afterAll(() => { chrome?.stop(); dev?.kill(); });

type Pt = [number, number];
type Seen = { scale: number; rotation: number; distance: number };
const touch = (tab: Tab, type: "touchStart" | "touchMove" | "touchEnd", points: Pt[]) =>
  tab.call("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
// The second finger moves in steps, as a real one does.
async function pinch(tab: Tab, first: Pt, from: Pt, to: Pt) {
  await touch(tab, "touchStart", [first]);
  await touch(tab, "touchStart", [first, from]);
  for (let i = 1; i <= 8; i++) await touch(tab, "touchMove", [first, [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8]]);
  await touch(tab, "touchEnd", []);
}

test("two fingers on the picture size and turn it; two fingers beside the cap zoom the camera", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await load(chrome.cdp, tab, page.url, 0);
  // The viewer is private to the element; the page reaches it the way a console would.
  const seen = () => tab.eval<Seen>(`(() => { const v = document.querySelector("qview-3d").viewer, at = v.layer.at;
    return { scale: at.scale, rotation: at.rotation, distance: v.camera.position.distanceTo(v.controls.target) }; })()`);
  // A photo goes on the front, then the camera faces it; find the middle of where it shows and an empty corner.
  const place = () => tab.eval<{ on: Pt; off: Pt }>(`(async () => {
    const el = document.querySelector("qview-3d");
    el.scrollIntoView();
    const c = new OffscreenCanvas(256, 256), g = c.getContext("2d");
    g.fillStyle = "#e11d48"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#fde047"; g.fillRect(0, 0, 128, 256);
    await el.addImage(await c.convertToBlob({ type: "image/png" }), "front");
    el.view("front");
    await new Promise((ok) => setTimeout(ok, 1500));
    const v = el.viewer, r = v.canvas.getBoundingClientRect(), on = [];
    let off = null;
    for (let y = r.top + 8; y < r.bottom; y += 8) for (let x = r.left + 8; x < r.right; x += 8) {
      const spot = v.pick({ clientX: x, clientY: y });
      if (spot && v.under(spot)) on.push([x, y]);
      else if (!spot && !off && y > r.top + r.height * 0.75) off = [x, y];
    }
    on.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { on: on[on.length >> 1], off };
  })()`);
  // On a first visit Vite finds three.js, bundles it and reloads the page: start again once it has.
  let spots: { on: Pt; off: Pt } | undefined;
  for (let i = 0; i < 4 && !spots; i++) {
    spots = await place().catch(async (e: Error) => {
      if (!/navigated|context|null/i.test(e.message)) throw e;
      await Bun.sleep(3000);
      return undefined;
    });
  }
  if (!spots) throw new Error("the page kept reloading");
  expect(spots.on).toBeTruthy();
  expect(spots.off).toBeTruthy();

  const before = await seen();
  // Second finger 100px right of the first, then 50px below it: half as far apart, a quarter turn clockwise on screen.
  const [x, y] = spots.on;
  await pinch(tab, [x, y], [x + 100, y], [x, y + 50]);
  const after = await seen();
  expect(after.scale).toBeCloseTo(before.scale / 2, 2);
  expect(after.rotation).toBeCloseTo(before.rotation - Math.PI / 2, 2);

  // Beside the cap, the same spread zooms the camera in and leaves the picture alone.
  const [ox, oy] = spots.off;
  await pinch(tab, [ox, oy], [ox + 20, oy - 20], [ox + 120, oy - 120]);
  await Bun.sleep(800); // OrbitControls' damping settles
  const zoomed = await seen();
  expect(zoomed.distance).toBeLessThan(after.distance - 0.2);
  expect(zoomed.scale).toBe(after.scale);
  expect(tab.noise.filter((n) => n.startsWith("uncaught"))).toEqual([]);
});
