// The no-wifi demo: the committed tape replays against a fresh app and every call answers as it did when recorded.
import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(120_000);

test("demo/tape.json replays clean", async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = Bun.spawn(["bun", "scripts/live-demo.ts", "--port", String(port), "--wait", "0", "--play", "demo/tape.json"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  expect(await p.exited, out).toBe(0);
  expect(out).toContain("every call answered as recorded");
});
