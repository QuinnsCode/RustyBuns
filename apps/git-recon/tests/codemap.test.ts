import { describe, expect, test } from "bun:test";
import { loadRepo, LoadError, parseSlug } from "../src/levels/github.ts";
import { LEVELS } from "../src/levels/levels.ts";
import { checkHits, churnGuards, mapRepo, type RepoSnapshot } from "../src/sim/codemap.ts";
import { addWin, UNLOCKABLE as HEADS, unlocked, winKey } from "../src/sim/heads.ts";
import { HEADS as ALL_HEADS, isOpen } from "../src/ui/heads.ts";
import { folderLinks, importsOf, isAgentCommit, resolveImport, tally, workspacePackages } from "../src/sim/intel.ts";
import type { Terrain } from "../src/sim/terrain.ts";
import { headModel } from "../src/ui/characters.ts";

const flat: Terrain = { R: 80, height: () => 0 };
const base: RepoSnapshot = {
  name: "toy",
  ref: "abc123",
  files: [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `apps/web/src/f${i}.ts`, lines: 400 + i * 50 })),
    ...Array.from({ length: 5 }, (_, i) => ({ path: `packages/core/m${i}.ts`, lines: 300 })),
    ...Array.from({ length: 4 }, (_, i) => ({ path: `apps/api/r${i}.ts`, lines: 200 })),
    { path: "README.md", lines: 80 },
    { path: "scripts/x.ts", lines: 20 },
  ],
};
/** The same repo with what a snapshot learns besides sizes: churn and agents in apps/web, a road, a failing check. */
const rich: RepoSnapshot = {
  ...base,
  files: base.files.map((f) => (f.path.startsWith("apps/web/") ? { ...f, churn: 6, agent: 0.8 } : f.path.startsWith("apps/api/") ? { ...f, churn: 1, agent: 0 } : f)),
  links: [["apps/web", "packages/core", 5], ["apps/api", "packages/core", 2], ["apps/web", "nowhere", 1]],
  failing: ["apps (api)", "lint"],
};

describe("intel", () => {
  test("imports: relative and package specifiers, resolved against the importing file", () => {
    const text = `import a from "./a.ts";\nimport { b } from '../../packages/core/b';\nconst c = await import("@acme/core/sub");\nrequire("left-pad");\nexport * from "./d";`;
    expect(importsOf(text)).toEqual(["./a.ts", "../../packages/core/b", "@acme/core/sub", "left-pad", "./d"]);
    expect(resolveImport("apps/web/src/x.ts", "../../../packages/core/b")).toBe("packages/core/b");
    expect(resolveImport("x.ts", "../out")).toBeNull();
  });

  test("folder links count each importing file once, through workspace packages too", () => {
    const packages = workspacePackages([
      { path: "package.json", text: `{"name":"root"}` },
      { path: "packages/core/package.json", text: `{"name":"@acme/core"}` },
      { path: "apps/web/package.json", text: "not json" },
    ]);
    expect([...packages]).toEqual([["@acme/core", "packages/core"]]);
    const links = folderLinks([
      { path: "apps/web/a.ts", text: `import "@acme/core"; import "@acme/core/x"; import "../../scripts/s";` },
      { path: "apps/web/b.ts", text: `import "../../packages/core/y"; import "./c"; import "react";` },
      { path: "scripts/s.ts", text: `import "../packages/gone/z";` },
    ], packages, new Set(["apps/web", "packages/core", "scripts"]));
    expect(links).toEqual([["apps/web", "packages/core", 2], ["apps/web", "scripts", 1]]);
  });

  test("agent commits, churn and the agents' share of it", () => {
    expect(isAgentCommit("fix\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>")).toBe(true);
    expect(isAgentCommit("bump", "dependabot[bot]")).toBe(true);
    expect(isAgentCommit("fix: a typo", "ada")).toBe(false);
    const files = tally([{ path: "a.ts", lines: 10 }, { path: "b.ts", lines: 10 }], [
      { agent: true, paths: ["a.ts"] },
      { agent: false, paths: ["a.ts", "a.ts"] },
      { agent: true, paths: ["a.ts", "b.ts"] },
    ]);
    expect(files).toEqual([{ path: "a.ts", lines: 10, churn: 3, agent: 0.67 }, { path: "b.ts", lines: 10, churn: 1, agent: 1 }]);
  });
});

describe("the richer map", () => {
  const plain = mapRepo(flat, base, 5), map = mapRepo(flat, rich, 5);
  const at = (m: typeof map, folder: string) => m.compounds.find((c) => c.folder === folder)!;

  test("same repo, same seed, same level", () => {
    expect(JSON.stringify(mapRepo(flat, rich, 5))).toBe(JSON.stringify(map));
    for (const l of LEVELS) expect(JSON.stringify(mapRepo(l.ground(), l.repo, l.seed))).toBe(JSON.stringify(mapRepo(l.ground(), l.repo, l.seed)));
  });

  test("what a snapshot adds doesn't move anything: the same compounds and blocks in the same places", () => {
    const where = (m: typeof map) => JSON.stringify({ c: m.compounds.map(({ folder, x, z, r }) => [folder, x, z, r]), b: m.blocks.map(({ path, x, z, h }) => [path, x, z, h]) });
    expect(where(map)).toBe(where(plain));
    // A snapshot without any of it keeps the old guard count.
    expect(plain.compounds.map((c) => c.guards)).toEqual(plain.compounds.map((c) => 2 + Math.min(3, Math.floor(c.lines / 6000))));
  });

  test("a folder that changed a lot holds more guards", () => {
    expect(churnGuards(0)).toBe(0), expect(churnGuards(0.1)).toBe(1), expect(churnGuards(0.5)).toBe(2);
    expect(at(map, "apps/web").churn).toBeGreaterThan(0.9);
    expect(at(map, "apps/web").guards).toBe(at(plain, "apps/web").guards + 2);
    expect(at(map, "packages/core").guards).toBe(at(plain, "packages/core").guards);
  });

  test("files agents mostly wrote are glass", () => {
    const web = map.blocks.filter((b) => b.path.startsWith("apps/web/"));
    expect(web.length).toBeGreaterThan(0);
    expect(web.every((b) => b.agent)).toBe(true);
    expect(map.blocks.filter((b) => !b.path.startsWith("apps/web/")).some((b) => b.agent)).toBe(false);
  });

  test("imports between compounds are roads; links to folders off the map are dropped", () => {
    const i = (f: string) => map.compounds.findIndex((c) => c.folder === f);
    const pair = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
    expect(map.roads!.map((r) => [r.a, r.b, r.weight])).toEqual(
      [[...pair(i("apps/web"), i("packages/core")), 5], [...pair(i("apps/api"), i("packages/core")), 2]].sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!),
    );
    expect(plain.roads).toEqual([]);
  });

  test("a failing check sets its folder's compound on fire", () => {
    expect(checkHits("apps/api", "apps (api)")).toBe(true);
    expect(checkHits("apps/api", "rapid deploy")).toBe(false);
    expect(checkHits(".", "lint")).toBe(false);
    expect(map.compounds.filter((c) => c.burning).map((c) => c.folder)).toEqual(["apps/api"]);
  });

  test("the Rusty Buns snapshot has roads and churn", () => {
    for (const l of LEVELS) {
      const m = mapRepo(l.ground(), l.repo, l.seed);
      expect(m.roads!.length).toBeGreaterThan(0);
      expect(m.compounds.some((c) => (c.churn ?? 0) > 0)).toBe(true);
    }
  });
});

describe("any repo from GitHub", () => {
  test("owner/repo from a slug or a URL", () => {
    expect(parseSlug(" oven-sh/bun ")).toBe("oven-sh/bun");
    expect(parseSlug("https://github.com/QuinnsCode/RustyBuns.git")).toBe("QuinnsCode/RustyBuns");
    expect(parseSlug("bun")).toBeNull();
  });

  /** A fake GitHub for one small repo; counts the API calls it takes. */
  function github(overrides: Record<string, Response> = {}) {
    let calls = 0;
    const json = (body: unknown) => new Response(JSON.stringify(body));
    const routes: Record<string, () => Response> = {
      "/repos/acme/app": () => json({ default_branch: "main", full_name: "acme/app" }),
      "/repos/acme/app/commits?sha=main&per_page=10": () => json([{ sha: "f00dcafe1234", commit: { message: "x" } }, { sha: "beef", commit: { message: "y" } }]),
      "/repos/acme/app/git/trees/f00dcafe1234?recursive=1": () => json({ tree: [
        { path: "apps/web/a.ts", type: "blob", size: 3200 },
        { path: "apps/web/b.ts", type: "blob", size: 640 },
        { path: "packages/core/c.ts", type: "blob", size: 1600 },
        { path: "packages/core/package.json", type: "blob", size: 30 },
        { path: "node_modules/x/index.js", type: "blob", size: 9999 },
        { path: "logo.png", type: "blob", size: 5000 },
        { path: "apps", type: "tree" },
      ] }),
      "/repos/acme/app/commits/f00dcafe1234": () => json({ sha: "f00dcafe1234", commit: { message: "feat\n\nCo-Authored-By: Claude <noreply@anthropic.com>" }, files: [{ filename: "apps/web/a.ts" }] }),
      "/repos/acme/app/commits/beef": () => json({ sha: "beef", commit: { message: "fix" }, author: { login: "ada" }, files: [{ filename: "apps/web/a.ts" }, { filename: "packages/core/c.ts" }] }),
      "/repos/acme/app/commits/f00dcafe1234/check-runs?per_page=100": () => json({ check_runs: [{ name: "test (web)", status: "completed", conclusion: "failure" }, { name: "lint", status: "completed", conclusion: "success" }] }),
    };
    const raw: Record<string, string> = {
      "apps/web/a.ts": "import { c } from '@acme/core';\n".repeat(3) + "export const a = c;\n",
      "apps/web/b.ts": "export const b = 1;\n",
      "packages/core/c.ts": "export const c = 1;\n",
      "packages/core/package.json": `{"name":"@acme/core"}`,
    };
    const get = async (url: string) => {
      if (url.startsWith("https://raw.githubusercontent.com/acme/app/f00dcafe1234/")) {
        const p = url.slice("https://raw.githubusercontent.com/acme/app/f00dcafe1234/".length);
        return p in raw ? new Response(raw[p]) : new Response("", { status: 404 });
      }
      calls++;
      const path = url.slice("https://api.github.com".length);
      return overrides[path] ?? routes[path]?.() ?? new Response("{}", { status: 404 });
    };
    return { get, calls: () => calls };
  }

  test("a public repo loads into a snapshot, in about a dozen API calls", async () => {
    const gh = github();
    const repo = await loadRepo("acme/app", gh.get);
    expect(gh.calls()).toBeLessThanOrEqual(15);
    expect(repo.name).toBe("acme/app");
    expect(repo.ref).toBe("f00dcaf");
    expect(repo.files.map((f) => f.path)).toEqual(["apps/web/a.ts", "apps/web/b.ts", "packages/core/c.ts"]);
    // Scripts it read have their real line counts; the rest are sized from bytes.
    expect(repo.files[0]).toEqual({ path: "apps/web/a.ts", lines: 5, churn: 2, agent: 0.5 });
    expect(repo.links).toEqual([["apps/web", "packages/core", 1]]);
    expect(repo.failing).toEqual(["test (web)"]);
    const map = mapRepo(flat, repo, 3);
    expect(map.compounds.find((c) => c.folder === "apps/web")!.burning).toBe(true);
    expect(JSON.stringify(mapRepo(flat, await loadRepo("acme/app", github().get), 3))).toBe(JSON.stringify(map));
  });

  test("a missing repo, or GitHub's hourly limit, says so", async () => {
    await expect(loadRepo("acme/nope", github().get)).rejects.toThrow("acme/nope isn't a public repo on GitHub");
    const limited = github({ "/repos/acme/app": new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }) });
    const err = await loadRepo("acme/app", limited.get).catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.message).toContain("hourly limit");
  });
});

describe("heads", () => {
  test("each level won unlocks the next head, once", () => {
    expect(unlocked([])).toEqual([]);
    let wins: string[] = [];
    const first = addWin(wins, winKey("el-capitan", "rustybuns"));
    expect(first.head).toBe(HEADS[0]!);
    wins = first.wins;
    expect(addWin(wins, winKey("el-capitan", "rustybuns")).head).toBeNull();
    const second = addWin(wins, winKey("el-capitan", "acme/app"));
    expect(second.head).toBe(HEADS[1]!);
    expect(unlocked(second.wins).map((h) => h.id)).toEqual([HEADS[0]!.id, HEADS[1]!.id]);
  });

  test("every head has a model and says what it nods to", () => {
    expect(new Set(HEADS.map((h) => h.id)).size).toBe(HEADS.length);
    for (const h of HEADS) {
      expect(h.nod.length).toBeGreaterThan(3);
      const m = headModel(h.id)!;
      expect(m.children.length).toBeGreaterThan(0);
    }
    expect(headModel(null)).toBeNull();
  });

  test("the head list keeps the plain and logo heads open and the toy heads locked until won", () => {
    expect(ALL_HEADS.filter((h) => isOpen(h, 0)).map((h) => h.id)).toEqual(["ball", "rustybuns", "codesplitter"]);
    expect(ALL_HEADS.filter((h) => h.toy && isOpen(h, 2)).map((h) => h.id)).toEqual([HEADS[0]!.id, HEADS[1]!.id]);
    expect(new Set(ALL_HEADS.map((h) => h.id)).size).toBe(ALL_HEADS.length);
  });
});
