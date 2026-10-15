import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import path from "node:path";
import { EXTERNAL_IMPORT, externalServer } from "../external/patch.ts";
import { EXTERNAL, external, mark } from "../external/server.ts";
import { read, unpackPinned } from "./pinned.ts";

setDefaultTimeout(60_000);

let pkg = "";
beforeAll(async () => { pkg = await unpackPinned(); });

const bug = { name: "bug", color: "#d73a4a" };

test("someone outside the team gets the orange label first; the team's own and unknown teams stay as they were", () => {
  const team = new Set(["ryan", "mervin"]);
  expect(mark([bug], "stranger", team)).toEqual([EXTERNAL, bug]);
  expect(mark([bug], "Ryan", team)).toEqual([bug]);
  expect(mark([bug], "stranger", undefined)).toEqual([bug]);
  expect(mark([EXTERNAL], "stranger", team)).toEqual([EXTERNAL]);
});

test("the team is asked of GitHub once, and flags arrive with its answer", async () => {
  let asked = 0;
  const ask = async () => (asked++, "Ryan\nmervin\n");
  const dir = "/repo-one";
  expect(external([], "stranger", dir, ask)).toEqual([]);
  await Promise.resolve();
  expect(external([], "stranger", dir, ask)).toEqual([EXTERNAL]);
  expect(external([], "ryan", dir, ask)).toEqual([]);
  expect(asked).toBe(1);
  // no push access: the ask fails and nobody is flagged
  expect(external([], "stranger", "/repo-two", async () => { throw new Error("403"); })).toEqual([]);
});

test("the pinned release's issue and PR lists run their labels through external()", () => {
  const file = path.join(pkg, "dist/server/server/github.js");
  const patched = EXTERNAL_IMPORT + externalServer(read(file));
  expect(patched.split("__rbExternal(labels(").length).toBe(3);
  expect(() => new Bun.Transpiler({ loader: "js" }).scan(patched)).not.toThrow();
  expect(() => externalServer(patched)).toThrow(/patch target moved/);
});
