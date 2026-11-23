import { expect, test } from "bun:test";
import { check } from "@rustybuns/util/guard";
import { TreeReply } from "../src/archive.ts";
import { local } from "./app-kit.ts";

// A file and a folder by one name can't both be in git (#4800): the merge stops instead of losing a side.
test("a branch file where main has a folder, or a folder where main has a file, waits; renamed, it merges", async () => {
  const call = await local({ GH_CLI: "off" });
  const send = async (url: string, body: unknown) => { const r = await call("ana", url, { method: "POST", body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const R = "/api/repos/ana/pub";
  await send("/api/login", { name: "ana" });
  await send("/api/repos", { name: "pub" });
  await send(`${R}/files`, { path: "doc", content: "plain" });
  await send(`${R}/do/commit?path=doc`, { message: "doc" });

  for (const [branch, path, main] of [["as-file", "lib", "lib/x.ts"], ["as-folder", "doc/readme.md", null]] as const) {
    await send(`${R}/branches`, { name: branch });
    await send(`${R}/files`, { path, content: "branch", branch });
    if (main) { await send(`${R}/files`, { path: main, content: "main" }); await send(`${R}/do/commit?path=${encodeURIComponent(main)}`, { message: main }); }
    const m = await send(`${R}/branches/${branch}/merge`, {});
    expect([branch, m.status, m.body.tag, m.body.files]).toEqual([branch, 409, "FolderClash", [path]]);
  }

  // Main's files are still both there, and a branch with a name that fits merges.
  const tree = check(TreeReply, await (await call("ana", `${R}/tree?path=`)).json());
  expect(tree?.entries.map((e) => `${e.type} ${e.path}`).sort()).toEqual(["dir lib", "file doc"]);
  await send(`${R}/branches`, { name: "fits" });
  await send(`${R}/files`, { path: "lib.md", content: "about lib", branch: "fits" });
  expect((await send(`${R}/branches/fits/merge`, {})).status).toBe(200);
});
