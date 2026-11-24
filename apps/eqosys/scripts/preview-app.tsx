// One app's page as eqosys draws it (its clips playing, the strip under them), served with the app's pictures and clips:
// `bun scripts/preview-app.tsx <app id> [out.png]` shoots it at a MacBook Pro's size, or `--serve` keeps it up.
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { AppPage } from "../src/app/pages.tsx";
import { APPS } from "../src/apps.ts";

const id = process.argv[2] ?? "git-recon", app = APPS.find((a) => a.id === id);
if (!app) throw new Error(`no app ${id} in APPS`);
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/app/trailers.client.ts")], format: "esm" });
const script = (await built.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?\s*$/, "") + "\nmountTiles(document); window.__reel = mountReel(document);";
const page = "<!doctype html>" + renderToStaticMarkup(<Document><AppPage app={app} mine={undefined} unlocks={new Map()} t0={90} /></Document>)
  .replace(/<script[^>]*commands\.client[^>]*><\/script>/, `<script>${script}</script>`);
const srv = Bun.serve({ port: 0, fetch: async (r) => {
  const p = new URL(r.url).pathname, file = Bun.file(join(import.meta.dir, "../public", p));
  if (p === "/") return new Response(page, { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });
if (process.argv.includes("--serve")) console.log(`http://127.0.0.1:${srv.port}/`);
else {
  const chrome = await launchChrome(["--autoplay-policy=no-user-gesture-required"]);
  const tab = await openTab(chrome.cdp, { w: 1512, h: 945 });
  await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/`, 2500);
  await Bun.write(process.argv[3] ?? "app.png", Buffer.from((await tab.call("Page.captureScreenshot", { format: "png" })).data, "base64"));
  console.log(JSON.stringify(await tab.eval("window.__reel?.state()")), tab.noise.join(" | "));
  chrome.stop(); srv.stop();
}
