import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { unsealState } from "../src/deploy-keys.ts";
import { review, textDiff } from "../src/deploy-review.ts";
import { type ContainerApi } from "../src/sandbox.ts";
import { CiRunner } from "../src/ci-runner.ts";
import { gated, gateExports } from "./fake-gate.ts";
// @ts-expect-error plain .mjs, no types: it is the server inside the deploy image
import { state } from "../deploy-sandbox/server.mjs";
import { type Call } from "../src/local.ts";
import { checked, TOKEN, ACCOUNT, hosted, K, settle, D } from "./deploy-kit.ts";

describe("code that isn't the owner's waits for them (#646)", () => {
  type Send = (u: string, url: string, b: unknown) => Promise<Response>;
  const edit = (send: Send, who: string, text: string, path = "rustybuns.config.ts") => send(who, "/api/repos/ryan-quinn/lab/files", { path, content: text });
  const commit = (send: Send, who: string, path = "rustybuns.config.ts") => send(who, `/api/repos/ryan-quinn/lab/do/commit?path=${path}`, { message: `${who}'s ${path}` });

  test("a crew commit holds the deploy, keys sealed, until the owner approves the diff at that tip", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await send("ryan-quinn", D, { on_commit: true }, "PUT");
    await edit(send, "pat-person", "export default { exfiltrate: true }");
    await commit(send, "pat-person");
    // Not even the owner's next commit ships it: the crew's is still under it.
    await send("ryan-quinn", "/api/repos/ryan-quinn/lab/do/commit?path=package.json", { message: "mine" });
    await Bun.sleep(30);
    expect(seen.env).toEqual([]);

    const pressed = await send("ryan-quinn", D, {});
    expect(pressed.status).toBe(409);
    const waiting = (await pressed.json()) as any;
    expect(waiting.error).toContain("waiting for you");
    expect(waiting.review.commits.map((c: any) => c.message)).toEqual(["pat-person's rustybuns.config.ts"]);
    expect(waiting.review.cleared).toBe(false);
    const d0 = (await (await call("ryan-quinn", D)).json()) as any;
    expect(d0.review).toMatchObject({ cleared: false, tip: waiting.review.tip });

    // The diff since the last approval (none yet: from the start), the crew's line in it.
    const r = (await (await call("ryan-quinn", `${D}/review`)).json()) as any;
    expect(r.diff.files.find((f: any) => f.path === "rustybuns.config.ts")).toMatchObject({ note: "new file", lines: expect.arrayContaining(["+ export default { exfiltrate: true }"]) });
    expect((await call("pat-person", `${D}/review`)).status).toBe(403);
    expect(seen.env).toEqual([]);

    // Approving a tip that isn't main's any more doesn't approve anything.
    expect((await send("ryan-quinn", D, { approve: "f".repeat(40) })).status).toBe(409);
    expect((await send("ryan-quinn", D, { approve: waiting.review.tip })).status).toBe(202);
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "done", commit_hash: waiting.review.tip });
    expect(seen.env).toHaveLength(1);

    // Cleared from there: the owner's own commit ships with no question.
    await edit(send, "ryan-quinn", "export const mine = 1", "src/app.ts");
    await commit(send, "ryan-quinn", "src/app.ts");
    expect((await settle(call, 2)).history[0]).toMatchObject({ trigger: "commit", status: "done" });
  });

  test("the owner's commit of a file someone else edited since its last commit waits too", async () => {
    const { send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await edit(send, "pat-person", "export default { theirs: true }");
    await commit(send, "ryan-quinn");
    const res = await send("ryan-quinn", D, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).review.commits).toHaveLength(1);
    expect(seen.env).toEqual([]);
  });

  test("a write token's commit doesn't clear a deploy: a prompt-injected agent may hold one, so only a person's does", async () => {
    const { call, send, seen } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    const made = (await (await send("ryan-quinn", "/api/tokens", { label: "agent", scope: "write" })).json()) as { token: string };
    const as = (url: string, body: unknown) => call(null, url, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${made.token}` } });
    await as("/api/repos/ryan-quinn/lab/files", { path: "rustybuns.config.ts", content: "export default { exfiltrate: true }" });
    expect((await as("/api/repos/ryan-quinn/lab/do/commit?path=rustybuns.config.ts", { message: "from a token" })).status).toBe(200);
    const pressed = await as(D, {});
    expect(pressed.status).toBe(409);
    expect(((await pressed.json()) as any).error).toContain("waiting for you");
    expect(seen.env).toEqual([]);
  });

  test("the runner checks again before it unseals the keys, and won't deploy a clone of another commit", async () => {
    const { call, send, seen, env } = await hosted();
    await send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    // A crew commit lands between the press and the run.
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab");
    const alarm = stub.alarm.bind(stub);
    stub.alarm = async () => { await edit(send, "pat-person", "x"); await commit(send, "pat-person"); stub.alarm = alarm; return alarm(); };
    await send("ryan-quinn", D, {});
    const d = await settle(call);
    expect(d.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("waiting for you") });
    expect(seen.env).toEqual([]);

    // Approved, but main moves before the clone: the clone isn't what was checked, so nothing runs.
    const tip = ((await (await call("ryan-quinn", D)).json()) as any).review.tip;
    seen.head = async () => "e".repeat(40);
    await send("ryan-quinn", D, { approve: tip });
    const d2 = await settle(call, 2);
    expect(d2.history[0]).toMatchObject({ status: "failed", note: expect.stringContaining("main moved") });
    expect(seen.ran.some((l) => l.includes("bun install"))).toBe(false);
  });
});

describe("the dependency doctor's preview on the site (#900)", () => {
  /** The owner's package.json with one dependency a major behind, the doctor's previews on, and a fake npm. */
  async function doctor() {
    const h = await hosted({}, undefined, undefined, `{\n  "dependencies": {\n    "kleur": "^3.0.0"\n  }\n}`);
    h.env.DEPS_REGISTRY = async (name: string) => name === "kleur"
      ? { versions: ["3.0.0", "4.1.5"], time: { "3.0.0": new Date(Date.now() - 900 * 86_400_000).toISOString(), "4.1.5": new Date(Date.now() - 30 * 86_400_000).toISOString() } } : null;
    h.env.DEPS_ADVISORIES = async () => new Map();
    await h.send("ryan-quinn", K, { token: TOKEN, account_id: ACCOUNT }, "PUT");
    await h.send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps", { max_level: "major", preview: true }, "PUT");
    return h;
  }
  const P = "/api/repos/ryan-quinn/lab/preview";

  test("it runs in the deploy container in an alarm of its own; the branch waits, and the next run picks up the result", async () => {
    const { call, send, seen } = await doctor();
    expect(await (await call("ryan-quinn", "/api/repos/ryan-quinn/lab/deps")).json()).toMatchObject({ can_preview: true });
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(first.branch).toBeUndefined();
    expect(first.waiting).toMatchObject({ stage: expect.stringMatching(/^preview-/), names: ["kleur"] });
    expect(first.note).toContain("the branch waits for it");
    const { id } = first.waiting, stage = `preview-${id}`;

    let h: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (h = await (await call("ryan-quinn", P)).json()).history[0]?.status === "running";) await Bun.sleep(10);
    expect(h.history[0]).toMatchObject({ id: id, by: "agent-deps", trigger: "preview", runner: "hosted", status: "done", key_last4: "…WXYZ" });
    // The doctor's package.json went over the clone through the container's /files, then up and down on its own stage.
    expect(seen.laid).toHaveLength(1);
    expect(seen.laid[0]!.cwd).toBe(`/work/${id}/repo`);
    expect(seen.laid[0]!.files["package.json"]).toContain(`"kleur": "^4.1.5"`);
    expect(seen.ran.filter((l) => /rustybuns (deploy|destroy)/.test(l))).toEqual([`bun x rustybuns deploy --yes --stage ${stage}`, `bun x rustybuns destroy --yes --stage ${stage}`]);
    expect(seen.destroyed).toBe(1);
    // A preview keeps no Alchemy state, and the deploy panel still shows no deploy.
    expect((await (await call("ryan-quinn", D)).json() as any).run).toBeNull();

    // The next run asks with the same files and gets the result: no second container, and the branch goes up.
    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.waiting).toBeUndefined();
    expect(second.previews).toEqual([{ id: id, stage: stage, ok: true, names: ["kleur"], url: "https://lab.ryan.workers.dev" }]);
    expect(second.branch).toMatch(/^deps-/);
    expect(seen.env).toHaveLength(1);
  });

  test("with the site's container minutes spent, it doesn't start, and nothing unchecked goes on a branch", async () => {
    const { send, seen, env } = await doctor();
    await env.DB.prepare("INSERT INTO limit_rules (name, max, window_s, enabled, on_fail) VALUES ('containers', 0, 86400, 1, 'reject')").run();
    const r = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(r.note).toContain("a preview deploy couldn't go (The site's container minutes");
    expect(r.branch).toBeUndefined();
    expect(seen.env).toEqual([]);
  });

  /** A CiRunner whose container answers each command with `code`, recording what it ran and what went over the clone. */
  function ciRunner(env: any, code = 0) {
    const seen = { ran: [] as string[], laid: [] as Record<string, string>[], env: [] as (Record<string, string> | undefined)[], internet: [] as (boolean | undefined)[], alarms: [] as Promise<void>[] };
    const data = new Map<string, unknown>();
    const obj: CiRunner = new CiRunner({
      container: gated<ContainerApi>({
        running: false,
        start(o) { seen.env.push(o?.env); seen.internet.push(o?.enableInternet); },
        async destroy() {},
        getTcpPort: () => ({
          async fetch(u, init) {
            const b = JSON.parse(String(init!.body));
            if (String(u).endsWith("/files")) { seen.laid.push(b.files); return Response.json({ files: Object.keys(b.files).length }); }
            seen.ran.push(b.cmd.join(" "));
            return Response.json({ code: b.cmd[0] === "sh" ? code : 0, out: b.cmd[0] === "sh" ? "1 fail\n" : "" });
          },
        }),
      }, []).container,
      exports: gateExports,
      storage: {
        get: async (k: string) => structuredClone(data.get(k)) as any,
        put: async (k: string, v: unknown) => { data.set(k, structuredClone(v)); },
        setAlarm: async () => { seen.alarms.push(Bun.sleep(0).then(() => obj.alarm())); },
      },
    }, env);
    env.CI_RUNNER = { idFromName: (n: string) => n, get: () => obj };
    return { seen, settled: async () => { for (let n = 0; n < seen.alarms.length; n++) await seen.alarms[n]; } };
  }
  const settlePreview = async (call: Call) => {
    let h: any;
    for (const end = performance.now() + 15_000; performance.now() < end && (h = await (await call("ryan-quinn", P)).json()).history[0]?.status === "running";) await Bun.sleep(10);
    return h;
  };

  test("with no tester, the repo's checks run on the same files alongside, in a container with no secrets; the branch waits for both (#1294)", async () => {
    const { call, send, env } = await doctor();
    const ci = ciRunner(env);
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(first.branch).toBeUndefined();
    expect(first.waiting).toMatchObject({ stage: expect.stringMatching(/^preview-/), checks: expect.any(String), names: ["kleur"] });
    expect(first.note).toContain("the repo's checks are running in its check container: the branch waits for them");
    await Promise.all([ci.settled(), settlePreview(call)]);
    expect(ci.seen.laid).toHaveLength(1);
    expect(ci.seen.laid[0]!["package.json"]).toContain(`"kleur": "^4.1.5"`);
    expect(ci.seen.ran[0]).toStartWith("git clone --quiet http");
    expect(ci.seen.ran.at(-1)).toBe("sh -c bun test");
    expect(ci.seen.env).toEqual([{ CI: "1" }]);
    expect(ci.seen.internet).toEqual([false]);

    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.waiting).toBeUndefined();
    expect(second.checks).toEqual([{ id: first.waiting.checks, ok: true, names: ["kleur"] }]);
    expect(second.previews).toMatchObject([{ ok: true, names: ["kleur"] }]);
    expect(second.branch).toMatch(/^deps-/);
    // Asked again with the same files, the kept result: no second container.
    expect(ci.seen.env).toHaveLength(1);
  });

  test("what fails the repo's checks doesn't deploy, and goes on no branch (#1294)", async () => {
    const { call, send, env, seen } = await doctor();
    const ci = ciRunner(env, 1);
    await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json();
    await Promise.all([ci.settled(), settlePreview(call)]);
    const deployed = seen.env.length;
    const second = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    expect(second.checks).toMatchObject([{ ok: false, failed: "test", names: ["kleur"] }]);
    expect(second.updates).toMatchObject([{ name: "kleur", status: "broke", out: expect.stringContaining("the repo's checks: test failed") }]);
    expect(second.branch).toBeUndefined();
    expect(second.waiting).toBeUndefined();
    expect(seen.env).toHaveLength(deployed);
  });

  test("a failed destroy keeps the stage's state sealed; a later alarm destroys it in a fresh container, then drops it (#1299)", async () => {
    const { call, send, seen, env } = await doctor();
    let destroys = 0;
    seen.fails = (l) => l.includes("rustybuns destroy") && destroys++ === 0;
    const first = await (await send("ryan-quinn", "/api/repos/ryan-quinn/lab/deps/run", {})).json() as any;
    const { id } = first.waiting, stage = `preview-${id}`;
    expect((await settlePreview(call)).history[0]).toMatchObject({ id, status: "failed", note: expect.stringContaining("state is kept, sealed") });
    const stub = env.DEPLOY_RUNNER.get("ryan-quinn/lab") as any;
    const stuck = await stub.ctx.storage.get(`stuck:${stage}`);
    expect(stuck).toMatchObject({ stage, tries: 0, files: { "package.json": expect.stringContaining(`"kleur": "^4.1.5"`) } });
    expect(await unsealState(env, "ryan-quinn", "lab", stuck.sealed)).toMatchObject({ "lab/prod/Worker.json": expect.stringContaining("lab-0") });
    expect(seen.destroyed).toBe(1);

    // The later alarm: a fresh container, the commit the preview ran with its files, its state back, destroyed.
    seen.ran.length = 0;
    await stub.alarm();
    expect(seen.ran[1]).toContain(`fetch --quiet --depth 1`);
    expect(seen.ran[1]).toEndWith(stuck.commit);
    expect(seen.ran.at(-1)).toBe(`bun x rustybuns destroy --yes --stage ${stage}`);
    expect(seen.laid.at(-1)!.files).toEqual(stuck.files);
    expect(seen.env).toHaveLength(2);
    expect(seen.destroyed).toBe(2);
    expect(await stub.ctx.storage.list({ prefix: "stuck:" })).toEqual(new Map());
    expect((await settlePreview(call)).history[0].note).toContain("a later try took stage");
    // Nothing left to destroy: the next alarm starts no container.
    await stub.alarm();
    expect(seen.env).toHaveLength(2);
  });
});

test("the review's diff: what goes, what comes, two lines of context, where each hunk starts", () => {
  const a = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n") + "\n";
  const b = ["1", "2", "3", "four", "5", "6", "7", "8", "9", "10"].join("\n") + "\n";
  expect(textDiff(a, b)).toEqual(["@@ 2", "  2", "  3", "- 4", "+ four", "  5", "  6", "@@ 8", "  8", "  9", "+ 10"]);
  expect(textDiff("", "x\n")).toEqual(["@@ 1", "+ x"]);
  expect(textDiff("same\n", "same\n")).toEqual([]);
});
