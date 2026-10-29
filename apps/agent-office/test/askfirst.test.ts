import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeCheck } from "../askfirst/ask.ts";
import { commandOf, MUSE_WRITE_HOOK, shellCommand, WRITE_HOOK } from "../askfirst/hook.ts";
import { writesOf } from "../askfirst/kinds.ts";
import { grantsRoute } from "../askfirst/server.ts";
import { asksRoute, pendingAsks } from "../live/floorguard.ts";
import { floorGuardCodex, floorGuardCursor, floorGuardGrok, floorGuardMuse } from "../scripts/floorguard.ts";

const dir = mkdtempSync(path.join(tmpdir(), "rb-askfirst-"));
const grants = grantsRoute(() => dir);

// The hook port as the patched office serves it: /office/workers/write asks, /__rb/asks and /__rb/grants are the person's side.
const office = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/office/workers/write") {
      const body: any = await req.json();
      const out = await writeCheck(dir, "a/b", "f", "Gizmo", { command: commandOf(body) }, () => {});
      return new Response(out.error ?? "ok", { status: out.allow ? 200 : 403 });
    }
    const r = asksRoute(req.method, url, req.headers.get("x-rb-ask") === "1") ?? grants(req.method, url, req.headers.get("x-rb-ask") === "1");
    return r ? Response.json(r.body, { status: r.status }) : new Response("no", { status: 404 });
  },
});
afterAll(() => office.stop(true));

/** Claude Code runs the hook with the tool call on stdin: what the worker's shell gets. `reach: false` is Muse's cleared environment. */
async function hook(command: string, url = `http://127.0.0.1:${office.port}`, script = WRITE_HOOK, input: object = { command }, reach = true) {
  const p = Bun.spawn(["sh", "-c", script], {
    stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Bash", tool_input: input, cwd: dir })),
    stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", ...(reach ? { AGENT_OFFICE_WORKER_ID: "w1", AGENT_OFFICE_HOOK_TOKEN: "t", AGENT_OFFICE_HOOK_URL: url } : {}) },
  });
  return { done: p.exited.then(async (code) => ({ code, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() })) };
}

/** The same, as Muse runs its hook: the shell tool's input says `cmd`, and the answer is JSON on stdout. */
const muse = (cmd: string, reach = true) => hook(cmd, undefined, MUSE_WRITE_HOOK, { cmd }, reach);
const deny = (out: string) => JSON.parse(out).hookSpecificOutput;

/** The person's side: wait for the card, answer it. */
async function answer(q: string) {
  while (!pendingAsks().length) await Bun.sleep(5);
  const [a] = pendingAsks();
  await fetch(`http://127.0.0.1:${office.port}/__rb/asks/${a!.id}?${q}`, { method: "POST", headers: { "x-rb-ask": "1" } });
  return a!;
}

const people = (q: string, trusted = true) =>
  fetch(`http://127.0.0.1:${office.port}/__rb/grants?${q}`, { method: "POST", headers: trusted ? { "x-rb-ask": "1" } : {} });

test.each([
  ["git push origin feature", ["push"]],
  ["cd x && gh pr create --fill", ["open"]],
  ["gh pr merge 5 --squash -R a/b", ["merge"]],
  ["gh issue comment 3 -b hi", ["comment"]],
  ["gh api repos/a/b/issues -X POST -f title=x", ["api"]],
  ["gh pr view 5 && git status && ls", []],
])("%s", (cmd, kinds) => expect(writesOf(cmd).kinds as string[]).toEqual(kinds));

test("a worker's push is read-only until the owner allows it; Always remembers it for the repo and the grants list shows it", async () => {
  // reading, and a command that isn't about GitHub at all, never ask
  expect((await (await hook("ls -la")).done).code).toBe(0);
  expect((await (await hook("gh pr view 1 && git status")).done).code).toBe(0);
  expect(pendingAsks()).toEqual([]);

  // a write waits for the card; Deny stops it with a reason the agent reads
  const denied = (await hook("git push origin feature")).done;
  const card = await answer("allow=0");
  expect(card.always).toBe("push on a/b");
  expect(card.detail).toContain("git push origin feature");
  const no = await denied;
  expect(no.code).toBe(2);
  expect(no.err).toContain("said no");

  // Allow with Always lets it through and saves the grant
  const allowed = (await hook("git push origin feature")).done;
  await answer("allow=1&always=1");
  expect((await allowed).code).toBe(0);
  const list: any = await (await fetch(`http://127.0.0.1:${office.port}/__rb/grants`)).json();
  expect(list.grants).toMatchObject([{ repo: "a/b", kind: "push", who: "*" }]);

  // no second question for that kind, a different kind still asks
  expect((await (await hook("git push")).done).code).toBe(0);
  expect(pendingAsks()).toEqual([]);
  const merge = (await hook("gh pr merge 3 --squash")).done;
  await answer("allow=0");
  expect((await merge).code).toBe(2);
});

test("the owner revokes a grant from the list, and a bad request to the list is turned away", async () => {
  expect((await people("do=revoke&repo=a/b&kind=push")).status).toBe(200);
  const again = (await hook("git push")).done;
  await answer("allow=0");
  expect((await again).code).toBe(2);

  expect((await people("do=grant&repo=a/b&kind=push&who=Byte", false)).status).toBe(403); // no header: a form on another site
  expect((await people("do=grant&repo=not-a-repo&kind=push")).status).toBe(400);
  expect((await people("do=grant&repo=a/b&kind=rm-rf")).status).toBe(400);
  expect((await people("do=grant&repo=a/b&kind=comment&who=Byte")).status).toBe(200);

  // a grant for Byte is Byte's: Gizmo still asks, until it has one of its own
  const other = (await hook("gh issue comment 3 -b hi")).done;
  await answer("allow=0");
  expect((await other).code).toBe(2);
  expect((await people("do=grant&repo=a/b&kind=comment&who=Gizmo")).status).toBe(200);
  expect((await (await hook("gh issue comment 3 -b hi")).done).code).toBe(0);
});

test("while the office is down (a restart) reads still go ahead and only a write is held", async () => {
  const dead = "http://127.0.0.1:1"; // nothing listens there
  for (const read of ["git status", "git diff", "gh pr view 5", "gh api repos/a/b/pulls"]) expect((await (await hook(read, dead)).done).code).toBe(0);
  for (const write of ["git push origin x", "git -C /tmp/x push", "gh pr merge 5 --squash", "gh issue comment 3 -b hi", "gh api repos/a/b/issues -X POST"]) {
    const r = await (await hook(write, dead)).done;
    expect(r.code).toBe(2);
    expect(r.err).toContain("did not answer");
  }
});

test("a Muse worker is stopped by a JSON deny, and a write is held when Muse's cleared environment hides the office", async () => {
  expect(await (await muse("git status")).done).toMatchObject({ code: 0, out: "" });

  const denied = (await muse("gh pr merge 5 --squash")).done;
  expect((await answer("allow=0")).detail).toContain("gh pr merge 5");
  const no = await denied;
  expect(no.code).toBe(0);
  expect(deny(no.out)).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  expect(deny(no.out).permissionDecisionReason).toContain("said no");

  const allowed = (await muse("gh pr merge 5 --squash")).done;
  await answer("allow=1");
  expect(await allowed).toMatchObject({ code: 0, out: "" });

  // no AGENT_OFFICE_* at all: reads go ahead, a write is held with a reason that doesn't send the agent round again
  expect(await (await muse("gh pr view 5", false)).done).toMatchObject({ code: 0, out: "" });
  expect(deny((await (await muse("git push origin x", false)).done).out).permissionDecisionReason).toContain("can't reach the office");
  expect(pendingAsks()).toEqual([]);
});

test("Codex, Cursor, Grok and Muse workers get the hook, as each upstream file writes its settings", () => {
  const codex = floorGuardCodex("const config = `hooks.${event}=[{hooks=[{type=\"command\",command=${JSON.stringify(command)},timeout=3}]}]`;");
  expect(codex).toContain("event === 'PreToolUse'");
  const grok = floorGuardGrok("        hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];\n");
  expect(grok).toContain("event === 'PreToolUse'");
  const cursor = floorGuardCursor("        config.hooks[event] = [...entries, { command, timeout: HOOK_TIMEOUT_S }];\n");
  expect(cursor).toContain("event === 'preToolUse'");
  expect(floorGuardMuse("        hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];\n")).toContain("event === 'PreToolUse'");
  // upstream moving its code fails loudly rather than leaving a worker unasked
  expect(() => floorGuardGrok("nothing")).toThrow("Agent Office changed");
});

test("the command is read from each agent's payload, and runs through sh -c with the worker's id as $1", async () => {
  expect(commandOf({ tool_input: { command: "git push" } })).toBe("git push");
  expect(commandOf({ toolInput: { command: "gh pr merge 1" } })).toBe("gh pr merge 1");
  expect(commandOf({ tool_input: { cmd: "gh pr merge 1" } })).toBe("gh pr merge 1");
  expect(commandOf({ command: "git push" })).toBe("git push");
  expect(commandOf({ tool_input: { file_path: "x" } })).toBeUndefined();
  const run = Bun.spawn(["sh", "-c", shellCommand("echo \"it's $1\"", "name", "w 1")], { stdout: "pipe" });
  expect((await new Response(run.stdout).text()).trim()).toBe("it's w 1");
});

test("a connection's access flag settles a write before any card: write goes through, read is refused, none still asks", async () => {
  const conn = (access: string) => writeFileSync(path.join(dir, "connections.json"), JSON.stringify([{ account: "a", access }]));
  const push = "git push origin feature";
  try {
    conn("read");
    const refused = await (await hook(push)).done;
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("read-only");
    expect(pendingAsks()).toEqual([]);
    expect((await (await hook("gh pr view 1")).done).code).toBe(0); // reads are never held

    conn("write");
    expect((await (await hook(push)).done).code).toBe(0);
    expect(pendingAsks()).toEqual([]);

    rmSync(path.join(dir, "connections.json"));
    const asked = (await hook(push)).done;
    await answer("allow=0");
    expect((await asked).code).toBe(2);
  } finally {
    rmSync(path.join(dir, "connections.json"), { force: true });
  }
});
