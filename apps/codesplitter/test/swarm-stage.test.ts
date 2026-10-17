import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { SCENES } from "../src/swarm-story.ts";

setDefaultTimeout(60_000);

// The story, walked the way a person walks it: open the page and click Next through every scene. The stage is
// bundled and loaded in a real page (Bun.WebView), so this needs a browser; where there is none it skips.
const browser = typeof Bun.WebView === "function";
let server: ReturnType<typeof Bun.serve>;
let view: InstanceType<typeof Bun.WebView>;

beforeAll(async () => {
  if (!browser) return;
  const built = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/swarm-stage.js`], target: "browser", format: "esm" });
  const js = await built.outputs[0].text();
  server = Bun.serve({
    port: 0,
    fetch: (req) => new URL(req.url).pathname === "/stage.js"
      ? new Response(js, { headers: { "content-type": "text/javascript" } })
      : new Response(`<!doctype html><body><div id="app"></div><script type="module">import { mount } from "/stage.js"; mount(document.getElementById("app"), { mode: "story" }); window.ready = true;</script></body>`, { headers: { "content-type": "text/html" } }),
  });
  view = new Bun.WebView({ width: 1100, height: 800 });
  await view.navigate(`http://localhost:${server.port}/`);
});
afterAll(() => { if (browser) { view?.close(); server?.stop(true); } });

const ev = (js: string) => view.evaluate(js);
/** Wait for the caption's title to be `title` (it fades out and back in on a change). */
async function titled(title: string) {
  for (let i = 0; i < 100; i++) {
    if ((await ev(`document.querySelector(".sw-cap b").textContent`)) === title) return;
    await Bun.sleep(50);
  }
  throw new Error(`the caption never read "${title}": it reads "${await ev(`document.querySelector(".sw-cap b").textContent`)}"`);
}

test.skipIf(!browser)("Next walks every scene in order, then wraps to the start", async () => {
  await titled(SCENES[0].title);
  for (const s of SCENES.slice(1)) {
    await ev(`document.querySelector('[data-act="next"]').click()`);
    await titled(s.title);
    // the caption has its words under the title
    expect(await ev(`document.querySelector(".sw-cap span").textContent`)).toBe(s.caption);
  }
  await ev(`document.querySelector('[data-act="next"]').click()`);
  await titled(SCENES[0].title);
});

test.skipIf(!browser)("Back and the scene dots jump to a scene, and the keys step", async () => {
  await ev(`document.querySelector('[data-scene="${SCENES[3].id}"]').click()`);
  await titled(SCENES[3].title);
  await ev(`document.querySelector('[data-act="back"]').click()`);
  await titled(SCENES[2].title);
  await ev(`document.querySelector(".sw-stage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  await titled(SCENES[3].title);
});
