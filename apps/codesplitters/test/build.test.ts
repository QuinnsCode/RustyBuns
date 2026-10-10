import { expect, test } from "bun:test";

// The Worker bundle must resolve Better Auth as workerd does. Its browser build keeps
// request state in one slot every request shares, so on the live site overlapping
// requests cleared each other's and getSession threw "No request state found" (#216).
test("the Worker bundle gets Better Auth's real AsyncLocalStorage, not the one-slot stand-in", async () => {
  const p = Bun.spawn(["bun", "run", "build.ts"], { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  const out = await Bun.file(`${import.meta.dir}/../dist/worker/worker.js`).text();
  expect(out).toContain(`import("node:async_hooks")`);
  expect(out).not.toContain("AsyncLocalStoragePolyfill");
}, 60_000);
