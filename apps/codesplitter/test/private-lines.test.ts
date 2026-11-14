import { expect, test } from "bun:test";
import { local as boot } from "./app-kit.ts";

// Privacy is kept by line id, and a move, a split or a merge makes a new id: the text stays the crew's anyway.

const SECRET = 'const key = "sk_live_hush";';

async function app() {
  const call = await boot({ GH_CLI: "off" });
  const send = (user: string, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: `one\n${SECRET}\nthree\n` });
  const file = async (user: string | null, q = "") => ((await (await call(user, `/api/repos/ryan/lab/do/file?path=a.ts${q}`)).json()) as any).lines as { id: string; text: string; rev: number }[];
  const secret = (await file("ryan"))[1]!;
  expect((await send("ryan", "/api/repos/ryan/lab/do/private?path=a.ts", { lines: [secret.id], private: true })).status).toBe(200);
  const ops = (ops: unknown[], q = "") => send("ryan", `/api/repos/ryan/lab/do/ops?path=a.ts${q}`, { ops });
  /** Everything a stranger can read of the file: its lines, its log, and search. */
  const outside = async (q = "") => {
    const log = await (await call(null, `/api/repos/ryan/lab/do/log?path=a.ts${q}`)).text();
    const search = await (await call(null, `/api/search?q=sk_live_hush`)).text();
    return JSON.stringify(await file(null, q)) + log + search;
  };
  return { call, send, file, secret, ops, outside };
}

test("a private line deleted and put back, or split with Enter, stays private", async () => {
  const { file, secret, ops, outside } = await app();
  // Delete it and insert the same text: a move by hand, in one batch.
  expect((await ops([{ kind: "delete", line: secret.id, base: secret.rev }, { kind: "insert", after: null, text: SECRET }])).status).toBe(200);
  expect(await outside()).not.toContain("sk_live");
  // Put back in a later batch than the delete: still the crew's.
  const moved = (await file("ryan"))[0]!;
  await ops([{ kind: "delete", line: moved.id, base: moved.rev }]);
  await ops([{ kind: "insert", after: null, text: SECRET }]);
  expect(await outside()).not.toContain("sk_live");
  // Enter in the middle: the first half keeps the id, the second is a new line.
  const now = (await file("ryan"))[0]!;
  expect((await ops([{ kind: "set", line: now.id, base: now.rev, text: 'const key = "sk_' }, { kind: "insert", after: now.id, text: 'live_hush";' }])).status).toBe(200);
  expect(await outside()).not.toContain("live_hush");
  expect((await file("ryan")).map((l) => l.text)).toContain('live_hush";');
});

test("a private line moved on a branch comes home private when it merges", async () => {
  const { call, send, file, secret, outside } = await app();
  await send("ryan", "/api/repos/ryan/lab/branches", { name: "tidy" });
  const onBranch = (await file("ryan", "&branch=tidy")).find((l) => l.id === secret.id)!;
  const one = (await file("ryan", "&branch=tidy"))[0]!;
  // Move the secret up, under "one", on the branch.
  expect((await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "delete", line: onBranch.id, base: onBranch.rev }, { kind: "insert", after: one.id, text: SECRET }] })).status).toBe(200);
  expect(await outside("&branch=tidy")).not.toContain("sk_live");
  expect((await send("ryan", "/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(200);
  const main = await file("ryan");
  expect(main.map((l) => l.text).slice(0, 3)).toEqual(["one", SECRET, "three"]);
  expect(main[1]!.id).not.toBe(secret.id);
  expect(await outside()).not.toContain("sk_live");
  expect(await (await call(null, "/api/repos/ryan/lab/do/at?path=a.ts&rev=999")).text()).not.toContain("sk_live");
});
