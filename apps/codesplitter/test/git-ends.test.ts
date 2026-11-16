import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";

// A file worked on from a terminal through the desktop's push-back remote, and in the app (#4774).
setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-ends-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
const call = await boot();
afterAll(() => { call.close(); rmSync(root, { recursive: true, force: true }); });

const post = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
// Not spawnSync: git talks to this same process's server. Its own git config: CI runs test files side by side, sharing process.env.
const sh = async (cmd: string, cwd: string) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, "gitconfig") } });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).arrayBuffer().then((b) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b)), new Response(p.stderr).text()]);
  return { code, out: out + err };
};
type Doc = { lines: { id: string; rev: number; text: string }[] };
const doc = async (path: string) => (await (await call("ana", `/api/repos/ana/lab/do/file?path=${path}`)).json()) as Doc;
const set = async (user: string, path: string, n: number, text: string) => {
  const l = (await doc(path)).lines[n]!;
  expect((await post(user, `/api/repos/ana/lab/do/ops?path=${path}`, { ops: [{ kind: "set", line: l.id, base: l.rev, text }] })).status).toBe(200);
};

test("a file pushed from a terminal keeps its BOM and its missing final newline, and the remote won't take a forced push", async () => {
  await post("ana", "/api/login", { name: "ana" });
  await post("ana", "/api/repos", { name: "lab", visibility: "public" });
  await post("ana", "/api/repos/ana/lab/files", { path: "start.md", content: "hi" });
  expect((await post("ana", "/api/repos/ana/lab/do/commit?path=start.md", { message: "start" })).status).toBe(200);

  const repo = (await (await call("ana", "/api/repos/ana/lab")).json()) as { clone: string; push: string };
  const work = join(root, "work");
  expect((await sh(`git clone -q ${repo.clone.split(" ")[2]} ${work} && cd ${work} && ${repo.push}`, root)).code).toBe(0);
  writeFileSync(join(work, "a.txt"), "\uFEFFone\ntwo");
  expect((await sh(`git add -A && git commit -qm "from a terminal" && git push -q codesplitter main`, work)).code).toBe(0);
  for (let i = 0; i < 100 && (await call("ana", "/api/repos/ana/lab/do/file?path=a.txt")).status !== 200; i++) await Bun.sleep(20);

  // A one-line edit is a one-line change in git: the BOM stays, and no final newline turns up.
  await set("ana", "a.txt", 1, "TWO");
  expect((await post("ana", "/api/repos/ana/lab/do/commit?path=a.txt", { message: "shout" })).status).toBe(200);
  const bare = call.artifacts.path("ana--lab");
  expect((await sh("git diff --numstat main~1 main", bare)).out.trim()).toBe("1\t1\ta.txt");
  expect((await sh("git show main:a.txt", bare)).out).toBe("\uFEFFone\nTWO");

  // Rewriting main from the terminal is turned away; the app's lines and git still agree.
  await sh(`git fetch -q codesplitter && git reset -q --hard codesplitter/main`, work);
  writeFileSync(join(work, "a.txt"), "rewritten\n");
  expect((await sh(`git commit -q --amend -am "rewrite" && git push -q --force codesplitter main`, work)).code).not.toBe(0);
  expect((await sh("git show main:a.txt", bare)).out).toBe("\uFEFFone\nTWO");
  expect((await doc("a.txt")).lines.map((l) => l.text)).toEqual(["one", "TWO"]);
  expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("rewritten\n");
});

test("an agent's line written through the API, with no run on record, still gets a note saying who", async () => {
  await post("agent-claude", "/api/login", { name: "agent-claude" });
  expect((await post("ana", "/api/repos/ana/lab/collaborators", { name: "agent-claude" })).status).toBeLessThan(300);
  await set("agent-claude", "start.md", 0, "hi from an agent");
  expect((await post("ana", "/api/repos/ana/lab/do/commit?path=start.md", { message: "agent's line" })).status).toBe(200);
  const [tip] = await (await call.artifacts.get("ana--lab")).log({ ref: "main", limit: 1 });
  const { note } = (await (await call(null, `/api/repos/ana/lab/commits/${tip!.hash}/note`)).json()) as { note: string | null };
  expect(note).toBe("agent: agent-claude\nrun: none on record");
});
