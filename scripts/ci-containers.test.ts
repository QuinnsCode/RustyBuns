import { expect, test } from "bun:test";
import type { ContainerBinding } from "../packages/cli/src/containers.ts";
import { delta, failedLine, summary, touched } from "./ci-containers.ts";

const b = (name: string, dockerfile: string): ContainerBinding => ({ name, className: name, dockerfile, context: dockerfile.slice(0, dockerfile.lastIndexOf("/")), maxInstances: 1, instanceType: "basic" });
const bindings = [b("AGENT", "sandbox/Dockerfile"), b("DEPLOY", "deploy-sandbox/Dockerfile"), b("CI", "deploy-sandbox/ci.Dockerfile")];

test("a change inside a context picks the bindings that build from it; the generator picks all; nothing picks none", () => {
  expect(touched(bindings, ["apps/x/deploy-sandbox/server.mjs"], "apps/x")).toEqual(["DEPLOY", "CI"]);
  expect(touched(bindings, ["apps/x/sandbox/Dockerfile"], "apps/x")).toEqual(["AGENT"]);
  expect(touched(bindings, ["packages/cli/src/gen/alchemy.ts"], "apps/x")).toEqual(["AGENT", "DEPLOY", "CI"]);
  expect(touched(bindings, ["apps/y/sandbox/Dockerfile", "README.md"], "apps/x")).toEqual([]);
});

test("the summary has a row per image, names the failing Dockerfile line, and says so when nothing was touched", () => {
  expect(failedLine("ERROR: failed to solve\n > [3/5] RUN apt-get instal gitt\nsandbox/Dockerfile:12")).toBe("sandbox/Dockerfile line 12");
  const md = summary([
    { name: "AGENT", dockerfile: "sandbox/Dockerfile", ok: true, build: "72s", size: "812 MB", boot: "0.9s" },
    { name: "CI", dockerfile: "deploy-sandbox/ci.Dockerfile", ok: false, build: "9s", fail: "Dockerfile:4\nboom" },
  ]);
  expect(md).toContain("| `AGENT` (sandbox/Dockerfile) | ✅ 72s | 812 MB | 0.9s |");
  expect(md).toContain("**CI** failed at Dockerfile line 4");
  expect(summary([])).toContain("No container images were touched");
});

test("a size is shown against main's build of the same image", () => {
  expect(delta(812e6, 800e6)).toBe("+12 MB");
  expect(delta(790e6, 800e6)).toBe("-10 MB");
  expect(delta(800.2e6, 800e6)).toBe("same");
  expect(delta(1e6)).toBe("new");
  expect(summary([{ name: "CI", dockerfile: "ci.Dockerfile", ok: true, size: "812 MB", delta: "+12 MB", boot: "1s" }])).toContain("812 MB (+12 MB vs main)");
});
