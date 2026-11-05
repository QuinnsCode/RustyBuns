// Bakes the menus' art: starts the dev server, opens it in headless Chrome, runs src/ui/menu-art.ts there (the game's
// own three.js figure, seeded) and writes each image to public/menu/, with its size.
//
//   bun scripts/menu-art.ts
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

const app = join(import.meta.dir, ".."), server = await startVite(app), chrome = await launchChrome();
try {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  await load(chrome.cdp, tab, server.url, 2500);
  const out = await tab.eval(`(async () => (await import("/src/ui/menu-art.ts")).renderAll())()`);
  if (!out || typeof out !== "object") throw new Error(`no images: ${String(out)}`);
  for (const [name, url] of Object.entries(out)) {
    if (typeof url !== "string" || !url.startsWith("data:image/")) throw new Error(`${name}: not an image`);
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    await Bun.write(join(app, "public/menu", name), bytes);
    console.log(`${name.padEnd(18)} ${(bytes.length / 1024).toFixed(1)} KB`);
  }
} finally { chrome.stop(); server.stop(); }
