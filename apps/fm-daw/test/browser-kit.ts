// One headless Chrome (scripts/chrome.ts) and the app's vite dev server for a test file's page journeys: `useBrowser()`
// starts both before the file's tests and stops them after; `chrome` and `vite` fill in once it has. The linux-arm64 and
// Windows drop runners have no Chrome (#5553), so a page test runs `test.skipIf(!hasChrome)`, as the others do.
import { afterAll, beforeAll } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, startVite } from "../../../scripts/chrome.ts";
export { waitFor } from "../../../scripts/chrome.ts";

export const hasChrome = !!chromePath();
export let chrome: Awaited<ReturnType<typeof launchChrome>>;
export let vite: Awaited<ReturnType<typeof startVite>>;

/** Chrome (no sound card: real time with stand-in speakers, plus any `flags`) and vite, for this file's tests. */
export function useBrowser(...flags: string[]) {
  beforeAll(async () => {
    if (!hasChrome) return;
    const app = join(import.meta.dir, "..");
    // the dev server's config imports .rustybuns/vite.ts, which `rustybuns boundary` writes (as `bun run build` does)
    if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
      const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
      if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
    }
    [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", ...flags]), startVite(app)]);
  });
  afterAll(() => { chrome?.stop(); vite?.stop(); });
}

