import { expect, test } from "bun:test";
import { hosted } from "./deploy-kit.ts";

const T = "/api/repos/ryan-quinn/lab/try";

/** The site's Build and Plan (#1400): clone, install, infra and plan in the deploy container, with no deploy key. */
test("Build and plan runs on the site with no deploy key, draws the map, and says what init can't do there", async () => {
  const { call, send, seen } = await hosted();
  const first = (await (await call("ryan-quinn", T)).json()) as any;
  expect(first).toMatchObject({ can_run: true, hosted: true, run: null });
  expect((await call("pat-person", T)).status).toBe(403);

  expect((await send("ryan-quinn", T, { save: true })).status).toBe(400);
  expect((await send("ryan-quinn", T, {})).status).toBe(202);
  let run: any;
  for (const end = performance.now() + 15_000; performance.now() < end;) {
    run = ((await (await call("ryan-quinn", T)).json()) as any).run;
    if (run?.done) break;
    await Bun.sleep(10);
  }
  expect(Object.fromEntries(run.steps.map((s: any) => [s.key, s.status]))).toEqual({ clone: "done", install: "done", init: "skipped", infra: "done", plan: "done" });
  expect(run.infra).toMatchObject({ app: "lab", nodes: [{ kind: "worker" }] });
  // Its container started with an empty env: no key was unsealed for it, and it was torn down after.
  expect(seen.env).toEqual([{ CI: "1" }]);
  expect(seen.ran.some((l) => l.includes("rustybuns plan --offline"))).toBe(true);
  expect(seen.ran.some((l) => l.includes("rustybuns deploy"))).toBe(false);
  expect(seen.destroyed).toBe(1);

  // A repo with no rustybuns.config.ts stops at init, and says why.
  seen.fails = (l) => l.startsWith("test -e") && l.endsWith("rustybuns.config.ts");
  expect((await send("ryan-quinn", T, {})).status).toBe(202);
  for (const end = performance.now() + 15_000; performance.now() < end;) {
    run = ((await (await call("ryan-quinn", T)).json()) as any).run;
    if (run?.done && run.note) break;
    await Bun.sleep(10);
  }
  expect(run.steps.find((s: any) => s.key === "init").status).toBe("failed");
  expect(run.note).toContain("desktop app");
});
