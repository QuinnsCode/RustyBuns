// The gear turntable (#5021): every gear id close up under one soft studio light, from three angles (front
// three-quarter, side, and the back with its jacks), on a neutral floor at a fixed picture size. The shots land
// beside the reference photos in docs/gear-refs/, so a judge sees model and photo side by side.
//
//   bun packages/models/scripts/turntable.ts --label round-2                every id, the material kit, into docs/gear-refs/shots/round-2/
//   bun packages/models/scripts/turntable.ts --label round-0 --plain     the flat colours (`gearLook()`, the `low` quality look)
//   bun packages/models/scripts/turntable.ts --only sub-18,wedge-12       just these ids
//   bun packages/models/scripts/turntable.ts --size 1024 --out /tmp/x     bigger, somewhere else
//
// One headless Chrome (scripts/chrome.ts, on the Mac's GPU) and a tiny server for the page and the kit's textures.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { help } from "../../../scripts/help.ts";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";

help(import.meta.path);
const argv = process.argv.slice(2), flag = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const pkg = resolve(import.meta.dir, ".."), label = flag("--label") ?? "now", size = Number(flag("--size") ?? 768);
const out = resolve(flag("--out") ?? join(pkg, "docs", "gear-refs", "shots", label)), only = flag("--only")?.split(",");
const plain = argv.includes("--plain");

const page = await Bun.build({ entrypoints: [join(import.meta.dir, "turntable-page.ts")], target: "browser", minify: false });
if (!page.success) throw new Error(page.logs.join("\n"));
const js = await page.outputs[0].text();
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/page.js"></script>`, { headers: { "content-type": "text/html" } });
    if (path === "/page.js") return new Response(js, { headers: { "content-type": "text/javascript" } });
    if (path.startsWith("/textures/") && !path.includes("..")) return new Response(Bun.file(join(pkg, path)));
    return new Response("not found", { status: 404 });
  },
});

const chrome = await launchChrome();
try {
  const tab = await openTab(chrome.cdp, { w: size, h: size });
  await load(chrome.cdp, tab, `http://127.0.0.1:${server.port}/?size=${size}${plain ? "&plain=1" : ""}`, 1500);
  const { ids, angles } = await tab.eval<{ ids: string[]; angles: string[] }>("({ ids: turntable.ids, angles: turntable.angles })");
  mkdirSync(out, { recursive: true });
  for (const id of ids.filter((i) => !only || only.includes(i))) {
    let tris = 0, calls = 0;
    for (const angle of angles) {
      const r = await tab.eval<{ triangles: number; calls: number }>(`turntable.show(${JSON.stringify(id)}, ${JSON.stringify(angle)})`);
      ({ triangles: tris, calls } = r);
      const { data } = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      await Bun.write(join(out, `${id}-${angle}.jpg`), Buffer.from(data, "base64"));
    }
    console.log(`${id}: ${tris} triangles, ${calls} draws (floor included)`);
  }
  if (tab.noise.length) console.warn(tab.noise.join("\n"));
  console.log(`shots in ${out}`);
} finally {
  chrome.stop();
  server.stop(true);
}
