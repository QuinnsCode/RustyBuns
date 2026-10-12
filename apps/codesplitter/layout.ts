// REFERENCE.md's `## Layout` table, built from each file's own entry (#988): a file that belongs in
// the table opens with `// Layout: what it is`, or `// Layout (a.ts, b.ts): …` to make one row for
// several files. The three folders with no .ts of their own are listed in FOLDERS below. Rows sort by
// their first path, so two branches that each add a module touch two files of their own, not the
// same spot in one table. `bun run layout` rewrites the table; test/layout.test.ts fails when it's stale.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Row { files: string[]; what: string }

export const APP = import.meta.dir;

const FOLDERS: Row[] = [
  { files: ["migrations/"], what: "the D1 schema. A new one is named for when it was written, `YYYYMMDDHHMMSS_name.sql` in UTC, not the next number (`test/migrations.test.ts`)" },
  { files: ["sandbox/"], what: "the container image: the CLIs, and the server that runs one on one file" },
  { files: ["deploy-sandbox/"], what: "the deploy container image: git, bun, and the server that runs one command; `ci.Dockerfile` is the check container's image, the same server without the deploy tools" },
];

const LINE = /^\/\/ Layout(?: \(([^)]+)\))?: (.+)$/;

/** Every row: the .ts files at the top and under src/ that open with a Layout line, plus FOLDERS, by first path. Throws on a row naming a file that isn't there. */
export function layout(root = APP): Row[] {
  const files = [
    ...readdirSync(root).filter((f) => f.endsWith(".ts")),
    ...(readdirSync(join(root, "src"), { recursive: true }) as string[]).filter((f) => f.endsWith(".ts")).map((f) => `src/${f}`),
  ];
  const rows = [...(root === APP ? FOLDERS : [])];
  for (const file of files) {
    const m = readFileSync(join(root, file), "utf8").split("\n", 1)[0]!.match(LINE);
    if (!m) continue;
    const named = m[1] ? m[1].split(",").map((f) => f.trim()) : [file];
    for (const f of named) if (!existsSync(join(root, f))) throw new Error(`${file}'s Layout line names ${f}, which isn't there`);
    rows.push({ files: named, what: m[2]!.trim() });
  }
  return rows.sort((a, b) => (a.files[0]! < b.files[0]! ? -1 : a.files[0]! > b.files[0]! ? 1 : 0));
}

export function table(rows: Row[]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  return ["| File | What |", "|---|---|", ...rows.map((r) => `| ${r.files.map((f) => `\`${f}\``).join(", ")} | ${cell(r.what)} |`)].join("\n");
}

/** The reference with its Layout table swapped for `rows`'. */
export function heal(reference: string, rows: Row[]): string {
  const lines = reference.split("\n");
  const head = lines.findIndex((l, i) => l.startsWith("| File |") && lines.slice(0, i).some((h) => h === "## Layout"));
  if (head < 0) throw new Error("REFERENCE.md: no `| File |` table under `## Layout`");
  let end = head;
  while (end < lines.length && lines[end]!.startsWith("|")) end++;
  lines.splice(head, end - head, table(rows));
  return lines.join("\n");
}

if (import.meta.main) {
  const path = join(APP, "REFERENCE.md");
  const before = readFileSync(path, "utf8");
  const after = heal(before, layout());
  if (after !== before) writeFileSync(path, after);
  console.log(after === before ? "REFERENCE.md's Layout table is up to date" : "rewrote REFERENCE.md's Layout table");
}
