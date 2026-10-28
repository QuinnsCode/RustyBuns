import { expect, test } from "bun:test";
import { mine } from "./builder-nightly.ts";

const job = (app: string, runner: string, target: string) => ({ app, runner, target, prep: "", build: "true" });

test("the builder takes its own Mac jobs and the cross-compile-everything ones, and nothing else", () => {
  const matrix = { include: [job("a", "ubuntu-latest", "all"), job("b", "macos-latest", "darwin-arm64"), job("b", "windows-latest", "windows-x64"), job("b", "macos-15-intel", "darwin-x64")] };
  expect(mine(matrix).map((j) => `${j.app} ${j.target}`)).toEqual(["a all", "b darwin-arm64"]);
  expect(mine(matrix, ["b"]).map((j) => j.target)).toEqual(["darwin-arm64"]);
  expect(mine("nonsense")).toEqual([]);
});
