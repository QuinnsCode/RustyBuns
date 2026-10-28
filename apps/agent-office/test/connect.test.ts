import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { connections, githubToken, type Deps, type State } from "../connect/github.ts";
import { fileSecrets } from "../connect/keychain.ts";
import { fakeGitHub } from "../demo/fake-github.ts";

setDefaultTimeout(10_000);

test("sign two GitHub accounts in with a code, read-only, then test and revoke one", async () => {
  const gh = fakeGitHub();
  const dir = mkdtempSync(`${tmpdir()}/connect-`);
  const deps: Deps = { dir, clientId: "Iv1.test", secrets: fileSecrets(dir), fetch: (u, i) => fetch(u, i), web: gh.base, api: gh.base, wait: () => Bun.sleep(5) };
  const route = connections(deps);
  const call = async (method: string, q = "") => (await route(method, new URL(`http://office/__rb/connections${q}`)))!.body as State;
  const until = async (f: (s: State) => boolean) => { for (let i = 0; i < 200; i++) { const s = await call("GET"); if (f(s)) return s; await Bun.sleep(10); } throw new Error("never happened"); };

  expect(await call("GET")).toEqual({ connections: [], pending: [], ready: true }); // empty state

  const first = await call("POST", "?do=github");
  expect(first.pending[0]).toMatchObject({ userCode: "ABCD-0001", uri: "https://github.com/login/device" });
  gh.type("dev1", "octo-work");
  let s = await until((s) => s.connections.length === 1);
  expect(s.connections).toEqual([{ id: "github:octo-work", kind: "github", account: "octo-work", status: "ok", access: "read" }]);
  expect(s.pending).toEqual([]);

  await call("POST", "?do=github");
  gh.type("dev2", "octo-home");
  s = await until((s) => s.connections.length === 2);
  expect(s.connections.map((c) => [c.account, c.access])).toEqual([["octo-work", "read"], ["octo-home", "read"]]); // every account starts read-only
  expect(await githubToken(dir, undefined, deps.secrets)).toBe("tok_dev1"); // the board's token: the first account
  expect(await githubToken(dir, "octo-home", deps.secrets)).toBe("tok_dev2");

  gh.expire("octo-home"); // revoked on GitHub's side: Test turns the light red
  s = await call("POST", "?do=test&id=github:octo-home");
  expect(s.connections.find((c) => c.account === "octo-home")?.status).toBe("down");

  s = await call("POST", "?do=revoke&id=github:octo-home");
  expect(s.connections.map((c) => c.account)).toEqual(["octo-work"]);
  expect(await deps.secrets.get("octo-home")).toBeNull(); // the token is gone too

  // a fresh office (restart) still knows the account, and looks its light up again
  expect((await (await connections(deps)("GET", new URL("http://office/__rb/connections")))!.body as State).connections[0]?.status).toBe("ok");
  gh.stop();
});

test("without the GitHub app's client ID, sign-in says how to set it up", async () => {
  const dir = mkdtempSync(`${tmpdir()}/connect-`);
  const route = connections({ dir, clientId: "", secrets: fileSecrets(dir), fetch: () => Promise.reject(new Error("offline")), web: "", api: "", wait: async () => {} });
  const r = (await route("POST", new URL("http://office/__rb/connections?do=github")))!;
  expect(r.status).toBe(400);
  expect(r.body).toMatchObject({ ready: false, error: expect.stringContaining("AGENT_OFFICE_GITHUB_CLIENT_ID") });
});

test("the boards use the office's own sign-in, and gh's only when there is none", async () => {
  const { boardToken } = await import("../live/github.ts");
  const dir = mkdtempSync(`${tmpdir()}/connect-`);
  const secrets = fileSecrets(dir);
  writeFileSync(`${dir}/connections.json`, JSON.stringify([{ account: "octo-work", access: "read" }]));
  await secrets.set("octo-work", "tok_office");
  expect(await boardToken(dir, dir, secrets)).toBe("tok_office");
  await secrets.remove("octo-work"); // nothing in the keychain: falls back to gh (which may or may not be signed in here)
  expect(await boardToken(dir, dir, secrets).catch(() => "gh")).not.toBe("tok_office");
});
