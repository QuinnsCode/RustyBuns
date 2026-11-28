// Remake public/og.jpg, the link preview of the main page and of a world with no picture yet: the landing's neon
// AGENT WORLD sign over its rain city, 1200 by 630, shot in headless Chrome. Run it when the landing changes:
//
//   cd apps/effect-ui-page && bun scripts/og.ts            writes public/og.jpg
//   bun scripts/og.ts --out /tmp/og.jpg                    somewhere else, to look first
//
// CHROME=/path overrides which Chrome.
import { join } from "node:path";
import { launchChrome, load, openTab, waitFor } from "../../../scripts/chrome.ts";
import { help } from "../../../scripts/help.ts";

if (process.argv.includes("--help")) { help(import.meta.path); process.exit(0); }
const at = process.argv.indexOf("--out");
const out = at > 0 ? process.argv[at + 1]! : join(import.meta.dir, "../public/og.jpg");

/** The sign and the city alone: the buttons, the connect line and everything under the fold are no use in a preview. */
const SIGN_ONLY = `
  .l-stage > :not(.l-word, .l-line), .l-how, .l-deep, [class*="palette"], .rb-palette-button { display: none !important; }
  .landing, .l-stage { min-height: 100vh; }
  .l-stage { justify-items: center; align-content: center; text-align: center; gap: 36px; }
  .l-word { font-size: 150px !important; }
  .l-line { font-size: 30px !important; max-width: none !important; }
`;

// Any port: the server says which.
const server = Bun.spawn([process.execPath, join(import.meta.dir, "dev.ts"), "--port", "0"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "inherit" });
let chrome;
try {
  const first = await server.stdout.getReader().read();
  const url = new TextDecoder().decode(first.value).match(/http:\/\/[\d.]+:\d+/)?.[0];
  if (!url) throw new Error("the dev server didn't start");
  chrome = await launchChrome();
  const tab = await openTab(chrome.cdp, { w: 1200, h: 630 });
  await load(chrome.cdp, tab, `${url}/`);
  await waitFor(tab, "the landing", `document.querySelector(".l-word")`);
  await tab.eval(`(async () => {
    document.head.append(Object.assign(document.createElement("style"), { textContent: ${JSON.stringify(SIGN_ONLY)} }));
    // Whatever else floats over the page (the Cmd+K button) is out of the picture too.
    for (const el of document.body.children) if (!["city", "app"].includes(el.id)) el.style.display = "none";
    await document.fonts.ready;
  })()`);
  await Bun.sleep(3000); // the rain gets going
  const shot = await tab.call("Page.captureScreenshot", { format: "jpeg", quality: 82 });
  const bytes = Buffer.from(shot.data, "base64");
  await Bun.write(out, bytes);
  console.log(`${out}: ${Math.round(bytes.length / 1000)} KB${bytes.length > 300_000 ? " (over 300 KB: lower the quality)" : ""}`);
} finally {
  chrome?.stop();
  server.kill();
}
