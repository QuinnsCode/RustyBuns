// A room's repo in Cloudflare Artifacts: where its world and the files beside it are kept for good. One repo per
// room, named by the room: `world/<path>` is each of the world's files, `world.json` the rest of the Page, and
// `files/<name>` what an agent put beside it (a player's .glb). The binding only reads, so a write is a git push
// (codeSplitter's, which needs no git library). Runs the same in the Worker and on `bun run dev`'s local Artifacts.
import { check, obj, opt, str } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";
import { type Change, push, type TreeReader } from "../../codesplitter/src/git.ts";
import type { Page } from "./page.ts";

/** The slice of Cloudflare's Artifacts binding a room uses. */
export interface Repo extends TreeReader {
  info(): Promise<{ remote: string }>;
  createToken(scope: "read" | "write", ttl: number): Promise<{ plaintext: string }>;
  log(opts: { ref: string; limit: number }): Promise<{ treeHash: string }[]>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
}
export interface Repos {
  create(name: string, opts: { description: string; setDefaultBranch: string }): Promise<unknown>;
  get(name: string): Promise<Repo>;
}

const Meta = obj({ backdrop: opt(str(40)) });
const gone = (e: unknown) => /NOT_FOUND|not found/i.test(String(e));

/** The room's repo, or null when it was never made. */
const find = (repos: Repos, room: string) => repos.get(room).catch((e: unknown) => { if (gone(e)) return null; throw e; });

/** Every file under `dir` at the branch's tip, by its path inside `dir`. */
async function under(repo: Repo, dir: string): Promise<string[]> {
  const tip = (await repo.log({ ref: "main", limit: 1 }))[0];
  const root = tip ? await repo.readTree(tip.treeHash) : null;
  const walk = async (hash: string, prefix: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of (await repo.readTree(hash)) ?? []) out.push(...e.type === "tree" ? await walk(e.hash, `${prefix}${e.name}/`) : [prefix + e.name]);
    return out;
  };
  const top = root?.find((e) => e.name === dir && e.type === "tree");
  return top ? walk(top.hash, "") : [];
}

/** One commit of `changes`, making the room's repo first when it has none. */
async function commit(repos: Repos, room: string, changes: Record<string, Change>, message: string) {
  let repo = await find(repos, room);
  if (!repo) {
    await repos.create(room, { description: "An Agent World room", setDefaultBranch: "main" }).catch((e: unknown) => { if (!/ALREADY_EXISTS|already exists/i.test(String(e))) throw e; });
    repo = await repos.get(room);
  }
  const { remote } = await repo.info();
  const token = (await repo.createToken("write", 600)).plaintext;
  await push(remote, token, { changes, message, author: "agent-page", email: "agent-page@agent-page.local", base: repo });
}

/** Keep the world as it is now: files it no longer has go, and an unchanged world makes no commit. */
export async function keepWorld(repos: Repos, room: string, page: Page) {
  const repo = await find(repos, room);
  const had = repo ? await under(repo, "world") : [];
  const changes: Record<string, Change> = {};
  for (const path of had) if (!(path in page.files)) changes[`world/${path}`] = null;
  for (const [path, text] of Object.entries(page.files)) changes[`world/${path}`] = text;
  changes["world.json"] = JSON.stringify(page.backdrop ? { backdrop: page.backdrop } : {});
  await commit(repos, room, changes, "The world changed");
}

/** The world as the room's repo has it, or null when it holds none. */
export async function keptWorld(repos: Repos, room: string): Promise<Page | null> {
  const repo = await find(repos, room);
  if (!repo) return null;
  const paths = await under(repo, "world");
  if (!paths.length) return null;
  const read = async (path: string) => (await repo.readFile({ ref: "main", path }))?.text();
  const files: Record<string, string> = {};
  for (const [path, text] of await Promise.all(paths.map(async (p) => [p, await read(`world/${p}`)] as const))) if (text !== undefined) files[path] = text;
  const meta = check(Meta, parseJson((await read("world.json")) ?? "{}"));
  return { files, ...(meta?.backdrop ? { backdrop: meta.backdrop } : {}) };
}

/** The names of the files beside the world. */
export async function keptFiles(repos: Repos, room: string): Promise<string[]> {
  const repo = await find(repos, room);
  return repo ? under(repo, "files") : [];
}

export async function keptFile(repos: Repos, room: string, name: string): Promise<Blob | null> {
  const repo = await find(repos, room);
  return repo ? repo.readFile({ ref: "main", path: `files/${name}` }) : null;
}

/** Keep `bytes` as the file `name` beside the world, or with null take it away. */
export const keepFile = (repos: Repos, room: string, name: string, bytes: Uint8Array | null) =>
  commit(repos, room, { [`files/${name}`]: bytes && { bytes } }, bytes ? `Keep ${name}` : `Remove ${name}`);
