import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLucide } from "../src/lucide-subset.ts";
import { SCENES } from "../src/swarm-story.ts";
import { local } from "./app-kit.ts";

setDefaultTimeout(60_000);

// The journey: open the landing page on #/demos, follow the link to "We got git problems with agent swarm", and
// the rush-hour station starts playing. The app is the real worker (local()); the static files the build copies
// into dist/client are served from source, so this needs a browser (Bun.WebView) and skips without one.
const browser = typeof Bun.WebView === "function";
const src = join(import.meta.dir, "../src");
let server: ReturnType<typeof Bun.serve>;
let view: InstanceType<typeof Bun.WebView>;
let scratch = "";

beforeAll(async () => {
  if (!browser) return;
  const call = await local();
  scratch = mkdtempSync(join(tmpdir(), "git-problems-"));
  await buildLucide(src, join(scratch, "lucide.min.js"), join(scratch, ".lucide"));
  const built = await Bun.build({ entrypoints: [join(src, "swarm-stage.js")], target: "browser", format: "esm" });
  const stage = await built.outputs[0].text();
  const file = (path: string, type: string) => new Response(Bun.file(path), { headers: { "content-type": type } });
  server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === "/") return file(join(src, "client.html"), "text/html");
      if (pathname === "/git-problems.html") return file(join(src, "git-problems.html"), "text/html");
      if (pathname === "/vendor/lucide.min.js") return file(join(scratch, "lucide.min.js"), "text/javascript");
      if (pathname === "/swarm-stage.js") return new Response(stage, { headers: { "content-type": "text/javascript" } });
      if (pathname.startsWith("/fonts/")) return file(join(src, pathname), "text/css");
      return call(null, pathname + new URL(req.url).search, { method: req.method, headers: req.headers, body: req.body });
    },
  });
  view = new Bun.WebView({ width: 1100, height: 800 });
  await view.navigate(`http://localhost:${server.port}/#/demos`);
});
afterAll(() => { if (browser) { view?.close(); server?.stop(true); rmSync(scratch, { recursive: true, force: true }); } });

const ev = (js: string) => view.evaluate(js);
async function until(js: string, what: string) {
  for (let i = 0; i < 100; i++) { if (await ev(js)) return; await Bun.sleep(100); }
  throw new Error(`never saw ${what}`);
}

test.skipIf(!browser)("the demos list links to the page, and its station animation starts", async () => {
  await until(`!!document.querySelector('a[href="/git-problems.html"]')`, "the link on #/demos");
  await ev(`document.querySelector('a[href="/git-problems.html"]').click()`);
  await until(`location.pathname === "/git-problems.html"`, "the page");
  expect(await ev(`document.title`)).toBe("We got git problems with agent swarm");
  expect(await ev(`document.querySelector("h1").textContent`)).toBe("We got git problems with agent swarm");
  // the station is playing its story: the caption names the first scene, and the dots are on the stage
  await until(`document.querySelector(".sw-cap b")?.textContent === ${JSON.stringify(SCENES[0].title)}`, "the first scene's caption");
  // the week replay is one click away
  expect(await ev(`document.querySelector("#open-week").getAttribute("href")`)).toBe("/swarm-watch.html");
});
