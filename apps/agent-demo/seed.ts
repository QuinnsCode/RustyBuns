// Sets up the codeSplitter demo: this app, Snack Vote, as a fresh repo on a
// codeSplitter site, with a branch whose merge has one conflict card left
// for the camera and one change that merges by itself. Then prints the links
// and the prompts to hand the agents. Nothing is deleted; each run makes a new repo.
//
//   bun seed.ts                       the site and token `codesplitter login` saved
//   bun seed.ts --url URL --token cst_…   or CODESPLITTER_URL / CODESPLITTER_TOKEN
//   bun seed.ts --name my-demo        the repo's name (default snack-vote-<MMDD-HHMM>)
//
// Its calls are the same ones the codeSplitter MCP tools make (create_repo,
// add_file, commit_file, start_branch, read_file, edit_lines, review_branch).

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The app files the repo starts with, read from this folder. */
export const FILES = ["src/tally.ts", "src/worker.ts", "test/tally.test.ts", "rustybuns.config.ts", "package.json"];
export const BRANCH = "loud-banner";
const FILE = "src/tally.ts";

type Line = { id: string; text: string; rev: number };
type Send = (req: Request) => Promise<Response>;

export interface SeedOptions { url: string; token: string; name: string; files: Record<string, string>; send?: Send; log?: (s: string) => void }

export async function seed({ url, token, name, files, send = (r) => fetch(r), log = console.log }: SeedOptions) {
  const site = url.replace(/\/+$/, "");
  const api = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await send(new Request(`${site}/api${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "agent-demo-seed/1" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }));
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  };

  const { owner } = await api<{ owner: string }>("POST", "/repos", { name, visibility: "public" });
  const repo = `/repos/${owner}/${name}`;
  log(`made ${owner}/${name}`);
  for (const [path, content] of Object.entries(files)) {
    await api("POST", `${repo}/files`, { path, content });
    await api("POST", `${repo}/do/commit?path=${encodeURIComponent(path)}`, { message: `Add ${path}` });
  }
  log(`committed ${Object.keys(files).length} files`);

  // Both sides rewrite banner's line differently: that's the conflict card.
  // The branch also documents total(), which main leaves alone: that merges by itself.
  const edit = async (branch: string | null, change: (find: (has: string, next?: number) => Line) => unknown[]) => {
    const q = `?path=${encodeURIComponent(FILE)}${branch ? `&branch=${branch}` : ""}`;
    const doc = await api<{ lines: Line[] }>("GET", `${repo}/do/file${q}`);
    // The line holding `has`, or the one `next` lines below it.
    const find = (has: string, next = 0) => {
      const l = doc.lines[doc.lines.findIndex((l) => l.text.includes(has)) + next];
      if (!l || !doc.lines.some((l) => l.text.includes(has))) throw new Error(`${FILE} has no line with ${has}`);
      return l;
    };
    await api("POST", `${repo}/do/ops${q}`, { ops: change(find) });
  };
  await api("POST", `${repo}/branches`, { name: BRANCH });
  await edit(BRANCH, (find) => {
    const b = find("is winning");
    return [
      { kind: "set", line: b.id, base: b.rev, text: "  return top ? `${top.toUpperCase()} IS WINNING!` : \"No votes yet\";" },
      // After the blank line that ends vote(), just above total().
      { kind: "insert", after: find("[snack]: (votes[snack]", 2).id, text: "// Every vote so far, across all snacks." },
    ];
  });
  await edit(null, (find) => {
    const b = find("is winning");
    return [{ kind: "set", line: b.id, base: b.rev, text: "  return top ? `${top} leads with ${votes[top]} votes` : \"No votes yet\";" }];
  });
  await api("POST", `${repo}/do/commit?path=${encodeURIComponent(FILE)}`, { message: "Banner says how many votes the leader has" });

  const review = await api<{ files: { path: string; conflicts: unknown[] }[] }>("GET", `${repo}/branches/${BRANCH}`);
  const conflicts = review.files.reduce((n, f) => n + f.conflicts.length, 0);
  log(`branch ${BRANCH}: ${conflicts} conflict${conflicts === 1 ? "" : "s"} waiting on its merge page`);

  return { owner, name, conflicts, page: `${site}/#/r/${owner}/${name}`, file: `${site}/#/r/${owner}/${name}/${FILE}` };
}

/** What to paste into each agent for the live part of the video. */
export function prompts(owner: string, name: string) {
  const at = `the codeSplitter repo ${owner}/${name}`;
  return [
    `Agent 1 (tests): In ${at}, add tests to test/tally.test.ts for a tie between two snacks. Edit lines with the codesplitter MCP tools, and don't touch src/.`,
    `Agent 2 (feature): In ${at}, add an \`undo(votes, snack)\` function to src/tally.ts that takes one vote back and never goes below zero. Edit only the lines you add.`,
    `Agent 3 (review): Read src/tally.ts in ${at} while the others work. Stamp lines you'd keep with lgtm, and tell me about anything that looks wrong. Don't edit.`,
  ];
}

if (import.meta.main) {
  const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1] ?? ""]] : a), []));
  let saved: { url?: string; token?: string } = {};
  for (const name of ["codesplitter", "codesplitters"])   // the old name, from before the rename
    try { saved = JSON.parse(readFileSync(`${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`}/${name}/config.json`, "utf8")); break; } catch {}
  const url = args.url ?? process.env.CODESPLITTER_URL ?? process.env.CODESPLITTERS_URL ?? saved.url;   // and the old names, from before the rename
  const token = args.token ?? process.env.CODESPLITTER_TOKEN ?? process.env.CODESPLITTERS_TOKEN ?? saved.token;
  if (!url || !token) {
    console.error("No codeSplitter site or token. Run `codesplitter login` once, or pass --url and --token.");
    process.exit(2);
  }
  const d = new Date(), pad = (n: number) => String(n).padStart(2, "0");
  const name = args.name ?? `snack-vote-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const files = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(import.meta.dir, f), "utf8")]));
  const r = await seed({ url, token, name, files });
  console.log(`\nRepo:  ${r.page}\nFile:  ${r.file}\nMerge: open the repo, then Branches → ${BRANCH}\n`);
  for (const p of prompts(r.owner, r.name)) console.log(`${p}\n`);
  console.log("The recording script is in DEMO.md.");
}
