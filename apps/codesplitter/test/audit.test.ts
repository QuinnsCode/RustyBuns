import { describe, expect, test } from "bun:test";
import { applyD1Migrations, d1 } from "@rustybuns/shell-bun";
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "./app-kit.ts";
import { privateHost } from "../src/hooks.ts";

// #648: the security audit log, CI token expiry, the hashed-invite migration and webhook URLs.

async function app() {
  const call = await boot({ GH_CLI: "off" });
  call.env.HOOK_FETCH = async () => new Response("ok");
  const send = (user: string | null, url: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) =>
    call(user, url, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  for (const u of ["ryan", "sam"]) await send(u, "/api/login", { name: u });
  await send("ryan", "/api/repos", { name: "lab" });
  return { call, send };
}

const actions = (rows: { action: string }[]) => rows.map((r) => r.action).reverse();

describe("audit log", () => {
  test("logs who changed tokens, the crew, invites, visibility and hooks, for the owner and on your tokens page", async () => {
    const { call, send } = await app();
    const t = await (await send("ryan", "/api/tokens", { label: "ci", scope: "admin" }, "POST", { "cf-ipcountry": "NZ" })).json() as { id: string; token: string };
    // A token's calls are logged as the token's.
    expect((await send(null, "/api/repos/ryan/lab", { visibility: "private" }, "PUT", { authorization: `Bearer ${t.token}` })).status).toBe(200);
    await send("ryan", "/api/repos/ryan/lab/collaborators", { name: "sam" });
    await send("ryan", "/api/repos/ryan/lab/collaborators/sam", undefined, "DELETE");
    const inv = await (await send("ryan", "/api/repos/ryan/lab/invites", {})).json() as { id: string; token: string };
    await send(null, "/api/invites/claim", { invite: inv.token, as: "agent", name: "bot" });
    const ci = await (await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "jenkins" })).json() as { id: string };
    await send("ryan", `/api/repos/ryan/lab/checks/tokens/${ci.id}`, undefined, "DELETE");
    const hook = await (await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook" })).json() as { id: string };
    await send("ryan", `/api/repos/ryan/lab/hooks/${hook.id}`, undefined, "DELETE");
    await send("ryan", `/api/tokens/${t.id}`, undefined, "DELETE");

    const repo = await (await call("ryan", "/api/repos/ryan/lab/audit")).json() as any[];
    expect(actions(repo)).toEqual(["repo.visibility", "crew.add", "crew.remove", "invite.create", "invite.claim", "ci_token.create", "ci_token.revoke", "hook.create", "hook.delete"]);
    expect(repo.at(-1)).toMatchObject({ actor: "ryan", via: "token", action: "repo.visibility", detail: "private" });
    expect(repo.find((r) => r.action === "invite.claim")).toMatchObject({ actor: expect.stringMatching(/^agent-bot-/), via: "invite", target: inv.id });
    expect(repo.find((r) => r.action === "hook.create")).toMatchObject({ target: hook.id, detail: "ci.example" });
    expect(JSON.stringify(repo)).not.toContain(inv.token);
    // Only the owner sees it.
    expect((await call("sam", "/api/repos/ryan/lab/audit")).status).toBe(403);

    const mine = await (await call("ryan", "/api/tokens/audit")).json() as any[];
    expect(actions(mine)[0]).toBe("token.create");
    expect(mine.at(-1)).toMatchObject({ action: "token.create", target: t.id, via: "cookie", country: "NZ", detail: "admin: ci" });
    expect(mine[0]).toMatchObject({ action: "token.revoke", target: t.id });
    expect(await (await call("sam", "/api/tokens/audit")).json()).toEqual([]);

    // Append-only.
    await expect(call.env.DB.prepare("UPDATE audit SET actor = 'x'").run()).rejects.toThrow(/append-only/);
  });

  test("a deleted repo's trail stays for its owner; erasing the account takes it", async () => {
    const { call, send } = await app();
    await send("ryan", "/api/repos/ryan/lab?confirm=lab", undefined, "DELETE");
    expect(actions(await (await call("ryan", "/api/repos/ryan/lab/audit")).json() as any[])).toEqual(["repo.delete"]);
    const exp = await (await call("ryan", "/api/me/export")).json() as { audit: unknown[] };
    expect(exp.audit).toMatchObject([{ action: "repo.delete" }]);
  });

  test("deploy key changes are logged, without the key", async () => {
    const { call, send } = await app();
    const r = await send("ryan", "/api/repos/ryan/lab/deploy/key", undefined, "DELETE");
    expect(r.status).toBe(200);
    // Nothing was there to remove: nothing logged.
    expect(await (await call("ryan", "/api/repos/ryan/lab/audit")).json()).toEqual([]);
  });
});

describe("CI tokens expire", () => {
  test("90 days by default, days to choose, and an expired one is a 401", async () => {
    const { call, send } = await app();
    const made = await (await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "jenkins" })).json() as { id: string; token: string; expires_at: number; created_at: number };
    expect(made.expires_at - made.created_at).toBe(90 * 86_400_000);
    const short = await (await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "x", days: 7 })).json() as { expires_at: number; created_at: number };
    expect(short.expires_at - short.created_at).toBe(7 * 86_400_000);
    expect((await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "x", days: 0 })).status).toBe(400);
    expect((await send("ryan", "/api/repos/ryan/lab/checks/tokens", { label: "x", days: 366 })).status).toBe(400);
    const status = () => call(null, `/api/gh/v3/repos/ryan/lab/commits/${"b".repeat(40)}/status`, { headers: { authorization: `token ${made.token}` } });
    expect((await status()).status).toBe(200);
    await call.env.DB.prepare("UPDATE ci_tokens SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, made.id).run();
    expect((await status()).status).toBe(401);
    expect((await (await call("ryan", "/api/repos/ryan/lab/checks/tokens")).json() as any[]).find((t) => t.id === made.id)).toMatchObject({ expired: true });
  });
});

test("0050_security_audit: CI tokens get an expiry, pending invites go, claimed ones stay without their token", async () => {
  const all = join(import.meta.dir, "../migrations"), dir = mkdtempSync(join(tmpdir(), "cs-migrations-"));
  try {
    const files = readdirSync(all).filter((f) => f.endsWith(".sql")).sort();
    const db = d1();
    for (const f of files.filter((f) => f < "0050")) copyFileSync(join(all, f), join(dir, f));
    await applyD1Migrations(db, dir);
    const DAY = 86_400_000, now = Date.now();
    const ci = db.sqlite.query("INSERT INTO ci_tokens (id, owner, repo, label, hash, last4, created_by, created_at) VALUES (?, 'ryan', 'lab', 'j', ?, 'abcd', 'ryan', ?)");
    ci.run("old", "h1", now - 200 * DAY);
    ci.run("new", "h2", now - DAY);
    const inv = db.sqlite.query("INSERT INTO invites (token, owner, repo, by, kind, target, created_at, expires_at, claimed_by) VALUES (?, 'ryan', 'lab', 'ryan', 'link', NULL, ?, ?, ?)");
    inv.run("csi_pendingWXYZ", now, now + DAY, null);
    inv.run("csi_claimedABCD", now, now + DAY, "sam");

    for (const f of files.filter((f) => f.startsWith("0050"))) copyFileSync(join(all, f), join(dir, f));
    expect(await applyD1Migrations(db, dir)).toContain("0050_security_audit.sql");
    const exp = Object.fromEntries((db.sqlite.query("SELECT id, expires_at FROM ci_tokens").all() as { id: string; expires_at: number }[]).map((r) => [r.id, r.expires_at]));
    expect(exp.old!).toBeGreaterThanOrEqual(now + 30 * DAY - 5000);    // at least 30 more days
    expect(exp.new!).toBe(now - DAY + 90 * DAY);                       // its 90
    const rows = db.sqlite.query("SELECT * FROM invites").all() as any[];
    expect(rows).toMatchObject([{ claimed_by: "sam", hash: null, last4: "ABCD", id: expect.stringMatching(/^[0-9a-f]{8}$/) }]);
    expect(JSON.stringify(rows)).not.toContain("csi_");
    expect(db.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("webhook URLs stay out of the private network", () => {
  test("private, loopback and link-local hosts are refused", async () => {
    const { send } = await app();
    for (const url of ["http://127.0.0.1:8080/x", "http://localhost/x", "http://10.0.0.5/x", "http://192.168.1.10/x", "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data", "http://[::1]/x", "http://[fe80::1]/x", "http://[fd12::1]/x", "http://[::ffff:127.0.0.1]/x", "http://2130706433/x", "http://box.local/x"])
      expect([url, (await send("ryan", "/api/repos/ryan/lab/hooks", { url })).status]).toEqual([url, 400]);
    expect((await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://8.8.8.8/x" })).status).toBe(201);
  });

  test("privateHost", () => {
    for (const h of ["0.0.0.0", "100.64.0.1", "172.31.255.255", "a.localhost", "metadata.internal", "[::]", "[ff02::1]", "[::7f00:1]", "[64:ff9b::7f00:1]", "[64:ff9b::a9fe:a9fe]", "[2002:7f00:1::]", "[2002:c0a8:101::1]"]) expect([h, privateHost(h)]).toEqual([h, true]);
    for (const h of ["172.32.0.1", "11.0.0.1", "ci.example", "[2606:4700::1111]", "[64:ff9b::808:808]", "[2002:808:808::1]", "192.169.0.1"]) expect([h, privateHost(h)]).toEqual([h, false]);
  });

  test("a delivery to a name that resolves inward isn't sent", async () => {
    const { call, send } = await app();
    const sent: string[] = [];
    call.env.HOOK_FETCH = async (url: string) => { sent.push(url); return new Response("ok"); };
    // A hook whose URL went private after it was added (a row edited here; a name re-pointed, in life): the delivery checks again.
    const hook = await (await send("ryan", "/api/repos/ryan/lab/hooks", { url: "https://ci.example/hook" })).json() as { id: string };
    await call.env.DB.prepare("UPDATE webhooks SET url = 'http://localhost:9/x' WHERE id = ?").bind(hook.id).run();
    await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one" });
    await send("ryan", "/api/repos/ryan/lab/do/commit?path=a.ts", { message: "one" });
    let d: any = null;
    for (const end = performance.now() + 5000; performance.now() < end && !d?.response;) {
      d = await call.env.DB.prepare("SELECT response FROM webhook_deliveries WHERE hook = ?").bind(hook.id).first();
      await Bun.sleep(20);
    }
    expect(d?.response).toContain("private address");
    expect(sent).toEqual([]);
  });
});
