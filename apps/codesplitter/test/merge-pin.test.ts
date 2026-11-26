import { expect, test } from "bun:test";
import { check, obj, str } from "@rustybuns/util/guard";
import { TreeReply } from "../src/archive.ts";
import { local } from "./app-kit.ts";

const Review = obj({ hash: str(64), status: str(16) });

// A merge lands the branch as the person read it (#5701): an edit since their read lands nothing until they read it again.
test("a merge with the hash the review showed lands it; one the branch moved past is a 409 and lands nothing", async () => {
  const call = await local({ GH_CLI: "off" });
  const send = async (url: string, body: unknown) => { const r = await call("ana", url, { method: "POST", body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const review = async () => check(Review, await (await call("ana", `${R}/branches/feat`)).json());
  const R = "/api/repos/ana/pub";
  await send("/api/login", { name: "ana" });
  await send("/api/repos", { name: "pub" });
  await send(`${R}/branches`, { name: "feat" });
  await send(`${R}/files`, { path: "a.md", content: "read", branch: "feat" });

  // Read, then a line nobody read goes on the branch.
  const read = (await review())!.hash;
  await send(`${R}/files`, { path: "b.md", content: "unread", branch: "feat" });
  for (const route of ["merge", "land"]) {
    const m = await send(`${R}/branches/feat/${route}`, { hash: read });
    expect([route, m.status, m.body.tag]).toEqual([route, 409, "BranchMoved"]);
  }
  expect((await review())?.status).toBe("open");
  const main = async () => check(TreeReply, await (await call("ana", `${R}/tree?path=`)).json())?.entries.map((e) => e.path);
  expect(await main()).toEqual([]);

  // Read again, and it merges.
  const now = (await review())!.hash;
  expect(now).not.toBe(read);
  expect((await send(`${R}/branches/feat/merge`, { hash: now })).status).toBe(200);
  expect([(await review())?.status, await main()]).toEqual(["merged", ["a.md", "b.md"]]);
});
