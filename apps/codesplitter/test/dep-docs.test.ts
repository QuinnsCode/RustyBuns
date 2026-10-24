import { expect, test } from "bun:test";
import { Budget, detectDependencyFiles, mergeTable, npmDocs, proveMerge, settleDeps, type Docs, type Proof } from "../src/dep-docs.ts";

const pkg = (o: object) => JSON.stringify(o, null, 2) + "\n";

test("detects manifests in a polyglot repo and workspace members, with lockfiles following their manifests", () => {
  const files = detectDependencyFiles([
    "package.json", "bun.lock", "packages/a/package.json", "apps/web/package.json", "node_modules/x/package.json",
    "svc/Cargo.toml", "svc/Cargo.lock", "py/pyproject.toml", "py/uv.lock", "go.mod", "go.sum", "Gemfile", "Gemfile.lock", "README.md",
  ], pkg({ workspaces: ["packages/*"] }));
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  expect(files.map((f) => f.path)).not.toContain("node_modules/x/package.json");
  expect(by["packages/a/package.json"]!.member).toBe("package.json");
  expect(by["apps/web/package.json"]!.member).toBeUndefined();
  expect(by["svc/Cargo.lock"]).toMatchObject({ eco: "cargo", kind: "lock", follows: "svc/Cargo.toml" });
  expect(by["py/uv.lock"]!.follows).toBe("py/pyproject.toml");
  expect(by["go.sum"]!.follows).toBe("go.mod");
  expect(by["bun.lock"]!.follows).toBe("package.json");
  expect(by["Gemfile.lock"]!.eco).toBe("ruby");
  expect(by["README.md"]).toBeUndefined();
});

const base = pkg({ dependencies: { x: "^1.0.0", y: "^1.0.0" } });
const main = pkg({ dependencies: { x: "^1.3.0", y: "^1.1.0" } });
const branch = pkg({ dependencies: { x: "^2.0.0", y: "^1.2.0" } });

test("a minor bump needs no docs; a major the docs call safe is taken; a breaking one is a card with the finding", async () => {
  const calls: string[] = [];
  const breaks: Docs = async (_e, name, from, to) => { calls.push(name); return { breaking: ["renames `foo`"], fixes: [] }; };
  const card = await settleDeps(base, main, branch, breaks, new Budget(5), () => "src/a.ts:12");
  expect(calls).toEqual(["x"]);
  expect(card.text).toBeNull();
  expect(card.cards[0]!.why).toBe("x ^1.3.0 to ^2.0.0 renames `foo`; branch uses it at src/a.ts:12");
  const safe: Docs = async () => ({ breaking: [], fixes: ["GHSA-1"] });
  const ok = await settleDeps(base, main, branch, safe, new Budget(5));
  expect(JSON.parse(ok.text!).dependencies).toEqual({ x: "^2.0.0", y: "^1.2.0" });
});

test("no docs or a spent budget makes a major crossing a card, never a guess", async () => {
  expect((await settleDeps(base, main, branch, null, new Budget(5))).cards).toHaveLength(1);
  const b = new Budget(0);
  const r = await settleDeps(base, main, branch, async () => ({ breaking: [], fixes: [] }), b);
  expect(r.cards[0]!.why).toContain("budget spent");
});

test("Cargo.toml, pyproject.toml and go.mod merge by dependency", () => {
  const cargo = (a: string, b: string, extra = "") => `[package]\nname = "p"\n\n[dependencies]\nserde = "${a}"\ntokio = { version = "${b}", features = ["full"] }\n${extra}`;
  const m = mergeTable("Cargo.toml", cargo("1.0.0", "1.0.0"), cargo("1.1.0", "1.0.0"), cargo("1.0.0", "1.2.0", 'anyhow = "1.0"\n'));
  expect(m).toBe(cargo("1.1.0", "1.2.0", 'anyhow = "1.0"\n').replace('anyhow = "1.0"\n', '').replace(/\n$/, "") + '\nanyhow = "1.0"\n');
  const gomod = (a: string, b: string) => `module m\n\ngo 1.22\n\nrequire (\n\tgithub.com/a/a ${a}\n\tgithub.com/b/b ${b}\n)\n`;
  expect(mergeTable("go.mod", gomod("v1.0.0", "v1.0.0"), gomod("v1.1.0", "v1.0.0"), gomod("v1.0.0", "v1.4.0"))).toBe(gomod("v1.1.0", "v1.4.0"));
  expect(mergeTable("go.mod", gomod("v1.0.0", "v1.0.0"), gomod("v1.1.0", "v1.0.0"), gomod("v1.2.0", "v1.0.0"))).toBe(gomod("v1.2.0", "v1.0.0"));
  const py = (v: string) => `[project]\nname = "p"\ndependencies = []\n\n[tool.poetry.dependencies]\nrequests = "${v}"\n`;
  expect(mergeTable("pyproject.toml", py("1.0.0"), py("1.0.0"), py("2.0.0"))).toBe(py("2.0.0"));
});

test("the sandbox proof tears down on success, a failed build and a throw, and respects its budget", async () => {
  let destroyed = 0;
  const open = (run: Proof["run"]) => () => ({ run, destroy: async () => { destroyed++; } });
  const b = new Budget(3);
  expect(await proveMerge(open(async () => ({ ok: true, out: "" })), {}, b)).toEqual({ ok: true });
  const bad = await proveMerge(open(async () => ({ ok: false, out: "error: no foo" })), {}, b);
  expect(bad.ok === false && bad.card.why).toContain("error: no foo");
  const thrown = await proveMerge(open(async () => { throw new Error("boom"); }), {}, b);
  expect(thrown.ok === false && thrown.card.why).toContain("boom");
  expect(destroyed).toBe(3);
  expect(await proveMerge(open(async () => ({ ok: true, out: "" })), {}, b)).toEqual({ ok: null, skipped: "sandbox budget spent" });
  expect(destroyed).toBe(3);
});

test("the npm registry answering with the wrong shape is no docs, not a crash", async () => {
  for (const body of [null, [], "x", { versions: [], "dist-tags": 5, readme: 7 }, { versions: { "2.0.0": "deprecated" } }]) {
    const docs = npmDocs((async () => Response.json(body)) as unknown as typeof fetch);
    expect(await docs("npm", "left-pad", "1.0.0", "2.0.0")).toEqual({ breaking: [], fixes: [] });
  }
  const real = npmDocs((async () => Response.json({ versions: { "2.0.0": { deprecated: "use right-pad" } } })) as unknown as typeof fetch);
  expect((await real("npm", "left-pad", "1.0.0", "2.0.0"))?.breaking).toEqual(["is deprecated: use right-pad"]);
});
