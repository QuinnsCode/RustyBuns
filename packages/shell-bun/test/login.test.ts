// A desktop app's eqosys sign-in (#5886): the page keeps it through its host, which holds it, and the DPoP key its
// refresh token is bound to, in the OS store. Here the store is the file one, so the test touches no keychain.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "../src/index.ts";
import { eqosysLogin, fileSecrets } from "../../util/src/secrets.ts";
import { checkDpop } from "../../util/src/token.ts";
import { hostVault } from "../../util/src/vault.ts";

const EQOSYS = "https://eqosys.example/oauth/token";
const dir = mkdtempSync(join(tmpdir(), "rb-login-"));
const secrets = fileSecrets(dir, "eqosys");

/** One launch of the desktop host, and its own page's vault (the launch cookie, its own Origin). */
async function launch(token: string) {
  const shell = serve({ token, login: eqosysLogin("park-hide-seek", { secrets }) });
  const cookie = (await fetch(`${shell.url}/?token=${token}`, { redirect: "manual" })).headers.get("set-cookie")!.split(";")[0]!;
  const page = (path: string, init: RequestInit = {}) =>
    fetch(shell.url + path, { ...init, headers: { ...init.headers as Record<string, string>, cookie, origin: shell.url } });
  const vault = hostVault({ marked: true, send: page })!;
  return { shell, page, vault };
}

test("signed in on a desktop host stays signed in after a restart, and signing out clears the OS store", async () => {
  expect(hostVault({ marked: false })).toBeNull();   // the web build keeps IndexedDB

  const first = await launch("one");
  await first.vault.save({ key: null, login: { name: "Zoë", email: "zoe@example.com", refresh: "r1" } });
  const bound = await checkDpop(await first.vault.prove!("POST", EQOSYS), "POST", EQOSYS);
  expect(bound).toBeString();
  await first.shell.stop();

  // A new launch: a new token and a new port, so a new origin for the page. Same person, same key.
  const second = await launch("two");
  expect(second.shell.port).not.toBe(first.shell.port);
  expect((await second.vault.load()).login).toEqual({ name: "Zoë", email: "zoe@example.com", refresh: "r1" });
  expect(await checkDpop(await second.vault.prove!("POST", EQOSYS), "POST", EQOSYS)).toBe(bound);

  // Only the host's own page: not another local page, not without the launch cookie, not a wrong body.
  const other = await fetch(second.shell.url + "/__rb/login", { headers: { cookie: `rb_token_${second.shell.port}=two`, origin: "http://127.0.0.1:1" } });
  expect(other.status).toBe(403);
  expect((await second.page("/__rb/login", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
  expect((await fetch(second.shell.url + "/__rb/login")).status).toBe(403);
  expect((await second.page("/__rb/login", { method: "PUT", body: JSON.stringify({ name: 1 }) })).status).toBe(400);
  expect((await second.page("/__rb/login/proof", { method: "POST", body: "{}" })).status).toBe(400);

  await second.vault.save({ key: null, login: null });
  expect((await second.vault.load()).login).toBeNull();
  expect(await secrets.get("park-hide-seek")).toBeNull();
  expect(await secrets.get("park-hide-seek.dpop")).toBeNull();
  await second.shell.stop();
});
