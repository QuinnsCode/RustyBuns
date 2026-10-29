import { expect, test } from "bun:test";
import { heal, ignored, plan, worktreeWarning } from "../scripts/dev.ts";

test("a change rebuilds only the stages that read it, and restarts only for a server bundle", () => {
  expect(plan(["clock/time.ts"])).toEqual({ full: false, stages: ["pages"], restart: false });
  expect(plan(["ester/dexter.ts", "asks/index.ts"])).toEqual({ full: false, stages: ["pages"], restart: false });
  // the skin and the codeSplitter tiles share a chunk, so the skin takes the page scripts with it
  expect(plan(["druids/forest.ts"])).toEqual({ full: false, stages: ["skin", "pages"], restart: false });
  expect(plan(["live/env.ts"])).toEqual({ full: false, stages: ["live"], restart: true });
  expect(plan(["../excalibrawl/src/engine/match.ts"]).restart).toBe(true);
  expect(plan(["triage/server.ts"])).toEqual({ full: false, stages: ["pages", "live"], restart: true });
  expect(plan(["codesplitter/server.ts"]).stages).toEqual(["skin", "pages", "live"]);
  // the patches applied at unpack time need a clean build
  expect(plan(["scripts/floorguard.ts"])).toEqual({ full: true, stages: ["skin", "pages", "live"], restart: true });
  expect(plan(["README.md", "docs/x.md", "druids/readme.md"]).stages).toEqual([]);
  expect(plan(["clock/time.ts", "live/env.ts"]).stages).toEqual(["pages", "live"]);
});

test("the watcher skips our output, dependencies and tests", () => {
  expect(ignored("office/dist/public/index.html")).toBe(true);
  expect(ignored("test/dev.test.ts")).toBe(true);
  expect(ignored("README.md")).toBe(true);
  expect(ignored("live/env.ts")).toBe(false);
  expect(ignored("../excalibrawl/src/engine/match.ts")).toBe(false);
});

test("every failure maps to one line and a healing, and a second failure gives up", () => {
  const build = (text: string, attempt = 0) => heal({ kind: "build", text, attempt });
  expect(build("error: Cannot find module './x' from clock/index.ts")).toMatchObject({ action: "none" });
  expect(build("error: Cannot find module './x' from clock/index.ts").line).toContain("clock/index.ts");
  expect(build("Agent Office changed: patch target moved in floor.js").action).toBe("clean");
  expect(build("Agent Office changed: patch target moved in floor.js", 1).action).toBe("none");
  expect(build("something odd").action).toBe("retry");
  expect(build("something odd", 1).action).toBe("none");

  const start = (text: string, attempt = 0) => heal({ kind: "start", text, attempt });
  expect(start("agent-office: port 4710 is already in use (try --port)").action).toBe("retry");
  expect(start("agent-office: port 4710 is already in use (try --port)", 1).action).toBe("none");
  expect(start("ENOENT: no such file office/dist/server/cli.js").action).toBe("clean");
  expect(start("ptyhost protocol mismatch").action).toBe("retry");
  expect(start("").action).toBe("retry");
  expect(start("", 1).action).toBe("none");

  const held = heal({ kind: "port", text: "pid 123", attempt: 0 });
  expect(held.action).toBe("none");
  expect(held.line).toContain("--port");
  for (const h of [held, build("x"), start("")]) expect(h.line).not.toContain("\n");
});

test("an office started from a worker's worktree is warned about, the main checkout is not", () => {
  expect(worktreeWarning("/Users/q/agent-office/RustyBuns/.agent-office/worktrees/widget-d66a/apps/agent-office")).toContain("main checkout");
  expect(worktreeWarning("/Users/q/agent-office/RustyBuns/apps/agent-office")).toBeNull();
});
