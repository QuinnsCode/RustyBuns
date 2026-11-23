import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local, post } from "./app-kit.ts";

// The ssh gate's remote lookup (#5541): what git-serve.sh (ssh/) asks once per connection, and what git does with
// the two lines it gets back. The whole push through sshd is ssh/try.ts (it needs Docker).

const SECRET = "gate-secret";

async function sh(cmd: string[], cwd: string) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`${cmd.join(" ")}: ${err || out}`);
  return out.trim();
}

describe("ssh remote lookup", () => {
  test("read for whoever may see it, write for the owner, a push lands in the files, and the reason for each no", async () => {
    const call = await local({ GH_CLI: "off", SSH_GATE_SECRET: SECRET });
    for (const u of ["ana", "bo", "cy"]) await post(call, u, "/api/login", { name: u });
    expect((await post(call, "ana", "/api/repos", { name: "lab", visibility: "public" })).status).toBe(201);
    await post(call, "ana", "/api/repos/ana/lab/files", { path: "README", content: "hello" });
    expect((await post(call, "ana", "/api/repos/ana/lab/do/commit?path=README", { message: "add README" })).status).toBe(200);
    await post(call, "ana", "/api/repos/ana/lab/collaborators", { name: "bo" });

    const lookup = async (user: string, repo: string, mode: string, secret = SECRET) => {
      const res = await call(null, `/api/ssh/remote?${new URLSearchParams({ user, repo, mode })}`, { headers: { authorization: `Bearer ${secret}` } });
      return { status: res.status, text: (await res.text()).trim() };
    };
    // git-serve.sh's own steps: the token in the repo's config, never the URL.
    const withToken = async (dir: string, user: string, mode: string) => {
      const [remote, token] = (await lookup(user, "ana/lab", mode)).text.split("\n");
      await sh(["git", "init", "-q", "-b", "main"], dir);
      await sh(["git", "config", "remote.origin.url", remote!], dir);
      await sh(["git", "config", "http.extraHeader", `Authorization: Bearer ${token}`], dir);
      return remote!;
    };

    // Only the gate opens it.
    expect((await lookup("ana", "ana/lab", "read", "nope")).status).toBe(404);
    expect((await lookup("ana", "ana/lab;rm", "read")).status).toBe(400);

    // bo is crew and reads it as git does: fetch with the token handed back.
    const bo = mkdtempSync(join(tmpdir(), "cs-ssh-bo-"));
    expect(await withToken(bo, "bo", "read")).toMatch(/^https?:\/\//);
    await sh(["git", "fetch", "-q", "origin", "main"], bo);
    expect(await sh(["git", "show", "FETCH_HEAD:README"], bo)).toBe("hello");

    // Write is the owner's alone: a crew member is pointed at a branch, a stranger can only read.
    expect(await lookup("bo", "ana/lab", "write")).toEqual({ status: 403, text: "only the owner pushes over ssh: the crew's changes go on a branch" });
    expect(await lookup("cy", "ana/lab", "write")).toEqual({ status: 403, text: "you can read it but not push to it" });

    // ana pushes, and the push comes into the file here as her edit.
    const ana = mkdtempSync(join(tmpdir(), "cs-ssh-ana-"));
    await withToken(ana, "ana", "write");
    await sh(["git", "fetch", "-q", "origin", "main"], ana);
    await sh(["git", "checkout", "-q", "-B", "main", "FETCH_HEAD"], ana);
    writeFileSync(join(ana, "README"), "hello over ssh\n");
    await sh(["git", "-c", "user.name=Ana", "-c", "user.email=ana@example.com", "commit", "-qam", "over ssh"], ana);
    await sh(["git", "push", "-q", "origin", "main"], ana);
    const lines = async () => ((await (await call("ana", "/api/repos/ana/lab/do/file?path=README")).json()) as { lines: { text: string }[] }).lines.map((l) => l.text);
    for (let i = 0; i < 50 && (await lines())[0] !== "hello over ssh"; i++) await Bun.sleep(100);
    expect(await lines()).toEqual(["hello over ssh"]);

    // Gone private, a stranger's lookup finds nothing there, as the API's does.
    expect((await call("ana", "/api/repos/ana/lab", { method: "PUT", body: JSON.stringify({ visibility: "private" }) })).status).toBe(200);
    expect(await lookup("cy", "ana/lab", "read")).toEqual({ status: 404, text: "not found" });
    expect((await lookup("cy", "ana/nothing", "read")).status).toBe(404);
  });
});
