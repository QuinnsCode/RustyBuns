import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromePath } from "./chrome.ts";

setDefaultTimeout(90_000);

const running = (dir: string) => Bun.spawnSync(["pgrep", "-f", "--", dir]).stdout.toString().trim().split("\n").filter(Boolean).length;

// #4905: a probe or test killed by a timeout left its Chrome running for days; 37 of them filled the office Mac's swap.
test.skipIf(!chromePath())("Chrome dies with the script that started it, even on kill -9", async () => {
  const child = Bun.spawn(["bun", "-e", `const c = await (await import(${JSON.stringify(`${import.meta.dir}/chrome.ts`)})).launchChrome(); console.log(c.dir); await Bun.sleep(120_000);`], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  let said = "";
  while (!said.includes("\n")) {
    const r = await reader.read();
    if (r.done) break;
    said += new TextDecoder().decode(r.value);
  }
  const dir = said.trim();
  expect(dir).toContain("chrome-cdp-");
  expect(running(dir)).toBeGreaterThan(0);
  child.kill(9);
  const t0 = Date.now();
  while ((running(dir) || existsSync(dir)) && Date.now() - t0 < 15_000) await Bun.sleep(250);
  expect(running(dir)).toBe(0);
  expect(existsSync(dir)).toBe(false);
});
