// The bench through its Worker, with a stand-in Browser Run binding: Kitesurf and Chromium take turns,
// a failing engine shows its error instead of a time, and the Worker refuses pages off its list.
import { expect, test } from "bun:test";
import worker from "../src/worker.ts";
import { SITES, type Browser } from "../src/bench.ts";

test("a cell alternates the engines, keeps each one's time and browser ms, and shows a failure", async () => {
  const calls: string[] = [];
  const BROWSER: Browser = {
    async quickAction(action, { url, browser }) {
      calls.push(browser ?? "chromium");
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
