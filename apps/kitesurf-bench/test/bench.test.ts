// The bench through its Worker, with a stand-in Browser Run binding: Kitesurf and Chromium take turns,
// a failing engine shows its error instead of a time, and the Worker refuses pages off its list.
import { expect, test } from "bun:test";
import worker from "../src/worker.ts";
import { SITES, type Browser } from "../src/bench.ts";

test("a cell alternates the engines, keeps each one's time and browser ms, and shows a failure", async () => {
  const calls: string[] = [];
  const BROWSER: Browser = {
    async quickAction(action, { url, browser, cacheTTL }) {
      calls.push(browser ?? "chromium");
      expect(cacheTTL).toBe(0); // every turn is a fresh render, not the first one cached
      if (browser === "kitesurf" && action === "screenshot") return new Response("WebGL is not supported", { status: 422 });
      return new Response(JSON.stringify({ success: true, result: url }), { headers: { "x-browser-ms-used": browser ? "40" : "90" } });
    },
  };
  const get = (path: string) => worker.fetch(new Request("https://bench.test" + path), { BROWSER });

  const ok = await (await get("/cell?site=0&action=markdown&reps=2")).json() as any;
  expect(calls).toEqual(["kitesurf", "chromium", "chromium", "kitesurf"]);
  expect(ok.site).toBe(SITES[0].name);
  expect(ok.kitesurf.runs).toHaveLength(2);
  expect(ok.kitesurf.medianBrowserMs).toBe(40);
  expect(ok.chromium.medianBrowserMs).toBe(90);
  expect(ok.kitesurf.failed).toBe(0);

  const shot = await (await get("/cell?site=6&action=screenshot&reps=1")).json() as any;
  expect(shot.kitesurf).toMatchObject({ failed: 1, medianMs: null, error: "WebGL is not supported" });
  expect(shot.chromium.failed).toBe(0);

  expect((await get("/cell?site=99&action=markdown")).status).toBe(400);
  expect((await get("/cell?site=0&action=pdf")).status).toBe(400);
  expect((await get("/")).headers.get("content-type")).toContain("text/html");
});

test("a burst sends every call at once, one engine after the other, and a screenshot comes back as the picture", async () => {
  let inFlight = 0, peak = 0;
  const seen: string[] = [];
  const BROWSER: Browser = {
    async quickAction(action, { browser, cacheTTL }) {
      expect(cacheTTL).toBe(0);
      seen.push(browser ?? "chromium");
      peak = Math.max(peak, ++inFlight);
      await Bun.sleep(5);
      inFlight--;
      if (action === "screenshot") return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      return new Response("ok", { headers: { "x-browser-ms-used": browser ? "40" : "90" } });
    },
  };
  const get = (path: string) => worker.fetch(new Request("https://bench.test" + path), { BROWSER });

  const b = await (await get("/burst?site=5&action=markdown&n=4")).json() as any;
  expect(peak).toBe(4);   // all four at once, and never the two engines together
  expect(seen).toEqual(["kitesurf", "kitesurf", "kitesurf", "kitesurf", "chromium", "chromium", "chromium", "chromium"]);
  expect(b.kitesurf).toMatchObject({ engine: "kitesurf", n: 4, side: { failed: 0, medianBrowserMs: 40 } });
  expect(b.chromium.side.medianBrowserMs).toBe(90);
  expect((await get("/burst?site=5&action=markdown&n=500")).ok).toBe(true);   // capped at 20, not refused
  expect(seen.length).toBe(8 + 40);

  const shot = await get("/shot?site=6&engine=kitesurf");
  expect(shot.headers.get("content-type")).toBe("image/png");
  expect([...new Uint8Array(await shot.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  expect((await get("/shot?site=6&engine=firefox")).status).toBe(400);
});
