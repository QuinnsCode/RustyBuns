// A room's world and files in its Artifacts repo: the saved world (saved.ts) pushing to a real git remote (the local
// Artifacts), and a later open reading it back from there.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitHttp, LocalArtifacts } from "../../../packages/shell-bun/src/bindings/artifacts.ts";
import { fileBucket, filesHttp } from "../src/files.ts";
import { memoryKv } from "../src/galaxy.ts";
import type { Page } from "../src/page.ts";
import { Saved } from "../src/saved.ts";

setDefaultTimeout(30_000);

const dir = mkdtempSync(join(tmpdir(), "agentworld-keep-test-"));
const repos = new LocalArtifacts(dir, "agentworld");
const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [repos]) });
repos.remoteBase = `http://127.0.0.1:${git.port}`;
afterAll(() => { git.stop(true); rmSync(dir, { recursive: true, force: true }); });

const ROOM = "testroom0001", API = `http://localhost/api/r/${ROOM}`;
const kv = memoryKv();
let timers = 0;
const saved = new Saved(kv, { repos, later: () => { timers++; } });
const send = (page: Page) => saved.http(new Request(`${API}/world`, { method: "PUT", headers: { origin: "http://localhost" }, body: JSON.stringify(page) }));
const open = async () => (await saved.http(new Request(`${API}/world`))).json();
const commits = async () => (await (await repos.get(ROOM)).log({ ref: "main" })).length;

describe("a room's world", () => {
  const first: Page = { files: { "index.html": "<p>one</p>", "lib/noise.js": "// n" }, backdrop: "ada" };
  const second: Page = { files: { "index.html": "<p>two</p>" } };

  test("is pushed to the room's repo, and an open reads it from there", async () => {
    expect((await send(first)).status).toBe(200);
    expect(timers).toBe(1);
    // Not pushed yet: storage is the newer copy.
    expect(await open()).toEqual(first);
    await saved.keep();
    // Storage changed behind its back, so what an open answers can only be the repo's.
    await kv.put({ "w:f:index.html": "stale" });
    expect(await open()).toEqual(first);
  });

  test("loses the files it lost, and an unchanged one makes no commit", async () => {
    await send(second);
    expect(await open()).toEqual(second);
    await saved.keep();
    expect(await open()).toEqual(second);
    await send(second);
    await saved.keep();
    expect(await commits()).toBe(2);
  });

  test("keeps a player's model beside it, through later changes", async () => {
    const bucket = fileBucket();
    const files = (rest: string, init?: RequestInit) => filesHttp(new Request(API + rest, init), repos, bucket, ROOM, rest);
    const glb = new Uint8Array([...new TextEncoder().encode("glTF"), 2, 0, 0, 0, 0, 255, 128]);
    expect((await files("/files/hero.glb", { method: "PUT", body: "not a model" })).status).toBe(400);
    expect(await (await files("/files/hero.glb", { method: "PUT", body: glb })).json()).toEqual({ ok: true, name: "hero.glb", bytes: glb.length });
    await send(first);
    await saved.keep();
    expect(await (await files("/files")).json()).toEqual({ files: ["hero.glb"] });
    expect(new Uint8Array(await (await files("/files/hero.glb")).arrayBuffer())).toEqual(glb);
    expect(await open()).toEqual(first);
    expect((await files("/files/hero.glb", { method: "DELETE" })).status).toBe(200);
    expect((await files("/files/hero.glb")).status).toBe(404);
  });
});
