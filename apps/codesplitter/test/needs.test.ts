import { expect, test } from "bun:test";
import { missingTool, needsText, scanNeeds } from "../src/needs.ts";

test("the scan finds Docker and Rust in a command, or in the package script it runs", () => {
  expect(scanNeeds("cargo test")).toEqual(["rust"]);
  expect(scanNeeds("docker build . && cargo build --release")).toEqual(["docker", "rust"]);
  expect(scanNeeds("bun run native", { native: "wasm-pack build" })).toEqual(["rust"]);
  expect(scanNeeds("bun test")).toEqual([]);
  expect(scanNeeds("echo cargo-culting; bun run docker-docs")).toEqual([]);
  expect(scanNeeds("cargo test", {}, { docker: false, rust: true })).toEqual([]);
  expect(needsText(["docker"])).toBe("Needs Docker. Hosted checks don't have it.");
});

test("the classifier reads the missing-tool signatures and nothing else", () => {
  expect(missingTool("sh: 1: docker: not found\nexit 127")).toBe("docker");
  expect(missingTool("Cannot connect to the Docker daemon at unix:///var/run/docker.sock")).toBe("docker");
  expect(missingTool("/bin/sh: cargo: command not found")).toBe("rust");
  expect(missingTool("exec format error")).toBe("rust");
  expect(missingTool("1 fail\nexit 1")).toBeNull();
});
