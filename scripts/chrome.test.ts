// Chrome over CDP (scripts/chrome.ts): it dies with whatever started it, and a stuck page fails at once with what was
// stuck, not minutes later at the test's timeout: a page whose image never arrives is LoadStalled naming that image,
// and a wait that never comes true is NeverTrue with the last value it saw.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chromePath, launchChrome, load, LoadStalled, NeverTrue, openTab, until } from "./chrome.ts";

setDefaultTimeout(90_000); // a Chrome left running a minute after its parent is killed, and Chrome's own start

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

const hasChrome = !!chromePath();
let chrome: Awaited<ReturnType<typeof launchChrome>>;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/never.png") return new Promise<Response>(() => {}); // answers nothing, ever
    const body = pathname === "/stuck" ? `<img src="/never.png">` : `<script>window.n = 1</script>`;
    return new Response(`<!doctype html><body>${body}</body>`, { headers: { "content-type": "text/html" } });
  },
});
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
beforeAll(async () => { if (hasChrome) chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); server.stop(true); });

test.skipIf(!hasChrome)("a page that never loads names what it waits on, and a wait that never comes true says what it saw", async () => {
  const tab = await openTab(chrome.cdp, { w: 800, h: 600 });
  try {
    const stalled = await load(chrome.cdp, tab, url("/stuck"), 0, 2000).then(() => null, (e: unknown) => e);
    expect(stalled).toBeInstanceOf(LoadStalled);
    expect(stalled instanceof LoadStalled && stalled.pending).toContain(url("/never.png"));
    // the time it says is the time it waited, which a busy runner overshoots by a tenth or two
    expect(String(stalled)).toMatch(/\/stuck never finished loading after 2\.\d s: still waiting on .*\/never\.png/);

    await load(chrome.cdp, tab, url("/fine"), 0, 5000);
    await until(tab, "window.n === 1", "the script", 2000);
    const t0 = Date.now();
    const never = await until(tab, "window.n + 1", "n to reach 3", 1000).then(() => null, (e: unknown) => e);
    expect(never).toBeInstanceOf(NeverTrue);
    expect(String(never)).toMatch(/n to reach 3 never came true in 1\.\d s \(last look: 2\)/);
    expect(Date.now() - t0).toBeLessThan(2000);
  } finally { await tab.close(); }
});
