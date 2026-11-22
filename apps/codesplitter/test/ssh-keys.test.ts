import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SshKeyOwner, SshKeyRow } from "../src/ssh-key.ts";
import { got } from "../src/local.ts";
import { local } from "./app-kit.ts";

// SSH keys for git over ssh:// (#5504): what a person adds, and what the ssh gate's lookup answers for it.
// The whole push through sshd is ssh/try.ts (it needs Docker).

/** A fresh ed25519 key, and its fingerprint as ssh-keygen prints it (what sshd hands the lookup as %f). */
function keygen(): { pub: string; fp: string } {
  const dir = mkdtempSync(join(tmpdir(), "cs-sshkey-"));
  try {
    Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "ada@laptop", "-f", join(dir, "k")]);
    const pub = readFileSync(join(dir, "k.pub"), "utf8").trim();
    const fp = Bun.spawnSync(["ssh-keygen", "-lf", join(dir, "k.pub")]).stdout.toString().split(" ")[1]!;
    return { pub, fp };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function app() {
  const call = await local({ GH_CLI: "off" });
  const send = (user: string | null, url: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) =>
    call(user, url, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
  for (const u of ["ada", "bo"]) await send(u, "/api/login", { name: u });
  const lookup = (fp: string) => call(null, `/api/ssh/key?fingerprint=${encodeURIComponent(fp)}`);
  return { call, send, lookup };
}

describe("ssh keys", () => {
  test("a key added is found by its fingerprint as whose it is, until it's removed", async () => {
    const { send, lookup } = await app();
    const { pub, fp } = keygen();
    const row = await got(send("ada", "/api/me/ssh-keys", { key: pub }), SshKeyRow, "add", (s) => s === 201);
    expect(row).toMatchObject({ fingerprint: fp, type: "ssh-ed25519", title: "ada@laptop" });

    const owner = await got(lookup(fp), SshKeyOwner);
    expect(owner).toEqual({ user: "ada", key: pub.split(" ").slice(0, 2).join(" ") });

    // One person's: not again, and not someone else's too.
    expect((await send("ada", "/api/me/ssh-keys", { key: pub })).status).toBe(409);
    expect((await send("bo", "/api/me/ssh-keys", { key: pub })).status).toBe(409);
    expect((await (await send("bo", "/api/me/ssh-keys", undefined, "GET")).json())).toEqual([]);

    // bo can't remove ada's key; ada can, and then the lookup knows it no more.
    expect((await send("bo", `/api/me/ssh-keys/${row.id}`, undefined, "DELETE")).status).toBe(404);
    expect((await send("ada", `/api/me/ssh-keys/${row.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await lookup(fp)).status).toBe(404);
  });

  // The page's journey (#5545): the profile's SSH keys box adds a pasted .pub line, lists it, says why a second add
  // can't, and removes it, each by the calls client.html's wireSshKeys makes; the audit log keeps both.
  test("the SSH keys box: add one, see it, the 409 says why, remove it", async () => {
    const { send } = await app();
    const page = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
    expect(page).toContain('boxTop(true, "sshkeys"');
    for (const c of ['api("/me/ssh-keys")', 'api("/me/ssh-keys", { key:', "api(`/me/ssh-keys/${b.dataset.unkey}`, undefined, \"DELETE\")"]) expect(page).toContain(c);

    const { pub, fp } = keygen();
    const added = await got(send("ada", "/api/me/ssh-keys", { key: `${pub}\n`, title: "work laptop" }), SshKeyRow, "add", (s) => s === 201);
    expect(added).toMatchObject({ title: "work laptop", fingerprint: fp });
    expect(await (await send("ada", "/api/me/ssh-keys", undefined, "GET")).json()).toEqual([added]);

    const again = await send("ada", "/api/me/ssh-keys", { key: pub, title: "" });
    expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([409, "you have added that key already"]);

    expect((await send("ada", `/api/me/ssh-keys/${added.id}`, undefined, "DELETE")).status).toBe(200);
    expect(await (await send("ada", "/api/me/ssh-keys", undefined, "GET")).json()).toEqual([]);
    const log = (await (await send("ada", "/api/tokens/audit", undefined, "GET")).json()) as { action: string }[];
    expect(log.map((a) => a.action)).toEqual(expect.arrayContaining(["ssh_key.add", "ssh_key.remove"]));
  });

  test("an API token can't add a key", async () => {
    const { send, call } = await app();
    const t = (await (await send("ada", "/api/tokens", { label: "agent", scope: "admin" })).json()) as { token: string };
    const res = await call(null, "/api/me/ssh-keys", { method: "POST", headers: { authorization: `Bearer ${t.token}` }, body: JSON.stringify({ key: keygen().pub }) });
    expect(res.status).toBe(403);
  });

  test("what isn't a public key is a 400", async () => {
    const { send } = await app();
    const { pub } = keygen();
    const b64 = pub.split(" ")[1]!;
    for (const key of ["", "-----BEGIN OPENSSH PRIVATE KEY-----", `ssh-dss ${b64}`, "ssh-ed25519 not*base64", `ssh-rsa ${b64}`])
      expect([key, (await send("ada", "/api/me/ssh-keys", { key })).status]).toEqual([key, 400]);
  });
});
