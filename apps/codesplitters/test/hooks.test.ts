import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { retryHooks, sign } from "../src/hooks.ts";
import worker from "../src/worker.ts";
import type { Runner } from "../src/preview.ts";

// These run the app end to end (real git, password hashes, in-process D1): fine alone,
// but a full run on a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const SECRET = "a-secret-of-sixteen-plus";

/** The app with an outbox: every webhook POST lands in `got`, answered with `status()`. */
async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const got: { url: string; headers: Headers; body: any; raw: string }[] = [];
  let status = 200;
  call.env.HOOK_FETCH = async (url: string, init: RequestInit) => {
    const raw = String(init.body);
    got.push({ url, headers: new Headers(init.headers), body: JSON.parse(raw), raw });
    return new Response("thanks", { status });
  };
  const send = (user: string, url: string, body: unknown, method = "POST") => call(user, url, { method, body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "private" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  return { call, send, got, answer: (s: number) => { status = s; } };
}

/** Deliveries go out after the response: wait for `n` of them. */
const arrived = async <T>(got: T[], n: number) => {
  for (const end = performance.now() + 15_000; performance.now() < end && got.length < n;) await Bun.sleep(10);
  return got;
};

test("only the owner manages hooks; the secret is shown once", async () => {
  const { call, send } = await app();
  await send("ana", "/api/login", { name: "ana" });
  expect((await call("ana", "/api/repos/ryan/lab/hooks")).status).toBe(403);
  expect((await send("ana", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook" })).status).toBe(403);
  expect((await send("ryan", "/api/repos/ryan/lab/hooks", { url: "ftp://ci.example/hook" })).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://u:p@ci.example/hook" })).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", events: ["push"] })).status).toBe(400);
  expect((await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", secret: "short" })).status).toBe(400);

  const made = await (await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook" })).json();
  expect(made.secret).toMatch(/^[0-9a-f]{48}$/);
  expect(made.events).toEqual(["commit", "branch.opened", "branch.merged", "deploy.finished"]);
  const list = await (await call("ryan", "/api/repos/ryan/lab/hooks")).json();
  expect(list.hooks).toHaveLength(1);
  expect(list.hooks[0].secret).toBeUndefined();

  expect((await call("ryan", `/api/repos/ryan/lab/hooks/${made.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await (await call("ryan", "/api/repos/ryan/lab/hooks")).json()).hooks).toHaveLength(0);
});

test("a commit sends a signed, push-shaped payload; branches open and merge", async () => {
  const { call, send, got } = await app();
  await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", secret: SECRET });
  await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://chat.example/hook", events: ["branch.merged"], secret: SECRET });

  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  const [push] = await arrived(got, 1);
  expect(push!.url).toBe("https://ci.example/hook");
  expect(push!.headers.get("x-codesplitters-event")).toBe("commit");
  expect(push!.headers.get("x-codesplitters-signature")).toBe(await sign(SECRET, push!.raw));
  expect(push!.body).toMatchObject({
    ref: "refs/heads/main", after: expect.stringMatching(/^[0-9a-f]{40}$/), pusher: { name: "ryan" },
    head_commit: { message: "first", added: ["a.ts"] },
    repository: { full_name: "ryan/lab", private: true }, sender: { login: "ryan" },
  });

  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  await arrived(got, 2);
  expect(got[1]!.body).toMatchObject({ ref: "tidy", ref_type: "branch" });

  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
  await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);
  await arrived(got, 4);
  const merged = got.slice(2).filter((g) => g.headers.get("x-codesplitters-event") === "branch.merged");
  expect(merged.map((g) => g.url).sort()).toEqual(["https://chat.example/hook", "https://ci.example/hook"]);
  expect(merged[0]!.body).toMatchObject({ pull_request: { merged: true, head: { ref: "tidy" }, base: { ref: "main" } }, files: ["a.ts"] });
});

test("a failed delivery is logged and retried by the cron; redeliver starts over", async () => {
  const { call, send, got, answer } = await app();
  const hook = await (await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", events: ["branch.opened"] })).json();
  answer(500);
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "one" });
  await arrived(got, 1);
  const log = async () => {
    for (const end = performance.now() + 15_000; performance.now() < end;) {
      const d = await (await call("ryan", `/api/repos/ryan/lab/hooks/${hook.id}/deliveries`)).json();
      if (d[0]?.attempts) return d;
      await Bun.sleep(10);
    }
  };
  let [d] = await log();
  expect(d).toMatchObject({ event: "branch.opened", status: "pending", attempts: 1, code: 500, response: "thanks" });

  // Not due yet: the sweep leaves it.
  await retryHooks(call.env);
  expect(got).toHaveLength(1);
  // Due: the cron's sweep tries again, and this time it lands.
  await call.env.DB.prepare("UPDATE webhook_deliveries SET next_at = 0").run();
  answer(204);
  await worker.scheduled({ cron: "*/5 * * * *" }, call.env, { waitUntil: () => {} });
  await arrived(got, 2);
  for (const end = performance.now() + 15_000; performance.now() < end && d.status !== "ok";) { [d] = await log(); await Bun.sleep(10); }
  expect(d).toMatchObject({ status: "ok", attempts: 2, code: 204 });
  expect((await (await call("ryan", "/api/repos/ryan/lab/hooks")).json()).hooks[0].last).toMatchObject({ status: "ok", code: 204 });

  expect((await call("ryan", `/api/repos/ryan/lab/hooks/${hook.id}/deliveries/${d.id}/redeliver`, { method: "POST" })).status).toBe(202);
  await arrived(got, 3);
  expect(got[2]!.headers.get("x-codesplitters-delivery")).toBe(d.id);
});

test("a finished deploy is announced as a deployment status", async () => {
  const runner: Runner = {
    exec: async (cmd, _cwd, out) => {
      const line = cmd.join(" ");
      if (line.includes("rev-parse")) out("0123456789abcdef0123456789abcdef01234567\n");
      if (line.includes("bun -e")) out(`RB ${JSON.stringify({ adopt: false, edge: true, box: false })}\n`);
      if (line.includes("rustybuns deploy")) out('url: "https://lab.ryan.workers.dev"\n');
      return 0;
    },
    fetch: async () => ({ status: 200 }),
  };
  const { send, got, call } = await app();
  call.env.PREVIEW_RUNNER = runner;
  await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook", events: ["deploy.finished"] });
  await send("ryan", "/api/repos/ryan/lab/deploy", {});
  await arrived(got, 1);
  expect(got[0]!.body).toMatchObject({
    deployment: { environment: "prod", task: "button", creator: { login: "ryan" } },
    deployment_status: { state: "success", environment_url: "https://lab.ryan.workers.dev" },
  });
});
