// eqosys's New game: POST /api/github/starter digs the starter folder up from GitHub as a repo of the maker's own,
// renamed to the new game, kept (not a day's dig) and with no upstream to pull the old names back from.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirs, fakeGitHub, git, local } from "./tarball-kit.ts";
import { STARTER } from "../src/starter.ts";

/** A GitHub repo "o/big" with a small starter folder in it, and its tarball. */
function upstream() {
  const dir = mkdtempSync(join(tmpdir(), "cs-starter-"));
  dirs.push(dir);
  const files = {
    "README.md": "the whole repo\n",
    "game/package.json": '{ "name": "starter-game" }\n',
    "game/src/main.ts": "// Starter Game\nwindow.starterGame = harness;\n",
    "game/logo.bin": "starter-game",
  };
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "the tip");
  const sha = git(dir, "rev-parse", "HEAD"), tgz = join(dir, "..", `${sha}.tgz`);
  dirs.push(tgz);
  git(dir, "archive", "--format=tar.gz", `--prefix=o-big-${sha.slice(0, 7)}/`, "-o", tgz, "HEAD");
  return { sha, tgz };
}

test("New game: the starter, renamed, as a repo of yours that stays", async () => {
  const { sha, tgz } = upstream();
  const call = await local({ GH_CLI: "off" });
  call.artifacts.import = async () => { throw new Error("a folder comes from the tarball"); };
  const restore = fakeGitHub(sha, tgz, { limited: true }), was = { ...STARTER };
  Object.assign(STARTER, { repo: "o/big", folder: "game" });
  try {
    const make = (body: unknown) => call("ana", "/api/github/starter", { method: "POST", body: JSON.stringify(body) });
    await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
    expect((await make({ name: "Rocket Golf" })).status).toBe(400);

    const res = await make({ name: "rocket-golf", title: "Rocket Golf!" });
    expect(res.status).toBe(201);
    const got: unknown = await res.json();
    expect(got).toMatchObject({ owner: "ana", name: "rocket-golf", upstream: null });
    expect(got).not.toHaveProperty("expires_at");
    const repo = await call.artifacts.get("ana--rocket-golf"), read = async (path: string) => (await repo.readFile({ ref: "main", path }))!.text();
    expect(await read("src/main.ts")).toBe("// Rocket Golf!\nwindow.rocketGolf = harness;\n");
    expect(JSON.parse(await read("package.json")).name).toBe("rocket-golf");
    expect(await read("logo.bin")).toBe("starter-game");
    expect(await repo.readFile({ ref: "main", path: "README.md" })).toBeNull();

    expect((await make({ name: "rocket-golf" })).status).toBe(409);
  } finally { restore(); Object.assign(STARTER, was); }
});
