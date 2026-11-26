import { expect, setDefaultTimeout, test } from "bun:test";
import { backoff, supervise } from "../src/supervise.ts";

setDefaultTimeout(15_000);

test("a child that keeps dying waits longer each time, up to 30s", () => {
  expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoff(n))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("a crashing child is started again with a growing wait; restart and stop end it, and a stubborn one is killed", async () => {
  // dies at once twice, then stays up ignoring SIGTERM, the way a hung office does
  const runs = `${process.env.TMPDIR ?? "/tmp"}/supervise-${process.pid}-${Date.now()}`;
  const script = `const f = ${JSON.stringify(runs)}; const fs = require("node:fs"); const n = fs.existsSync(f) ? +fs.readFileSync(f, "utf8") : 0;
    fs.writeFileSync(f, String(n + 1)); console.log("run " + (n + 1)); if (n < 2) process.exit(3);
    process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`;
  const exits: [number | null, number][] = [];
  let out = "";
  const sup = supervise(["bun", "-e", script], {
    output: "pipe", firstMs: 50, graceMs: 300, onOutput: (d) => { out += new TextDecoder().decode(d); },
    onExit: (code, _sig, wait) => exits.push([code, wait]),
  });

  sup.start();
  while (out.split("run ").length - 1 < 3) await Bun.sleep(20);
  expect(exits).toEqual([[3, 50], [3, 100]]);
  const third = sup.child!;
  await Bun.sleep(100);
  expect(sup.child).toBe(third);

  // the restart ignores SIGTERM, so it is killed after the grace, and a fresh one starts
  const fresh = await sup.restart();
  expect(third.signalCode).toBe("SIGKILL");
  expect(fresh.pid).not.toBe(third.pid);

  // stopped for good: no more starts
  expect(await sup.stop()).toBe(true);
  await Bun.sleep(200);
  expect(sup.child).toBeNull();
  expect(exits).toHaveLength(2);
});
