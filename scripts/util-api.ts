// @rustybuns/util's shape, checked: where each module runs, and the stable ones' exports locked.
//
//   bun scripts/util-api.ts                       check (CI): every module has one side, imports go the right way,
//                                                 and the stable modules' exports match packages/util/API.lock
//   bun scripts/util-api.ts --update              rewrite API.lock after adding to a stable module
//   bun scripts/util-api.ts --update --break "why"  the same when a stable export changed or went away: the lines
//                                                 and why go to packages/util/BREAKING.md for the release notes
//   bun scripts/util-api.ts --copy guard http <dir>  copy shared modules (and the shared modules they import) into
//                                                 another repo or app; they keep working as plain files
//
// The sides (packages/util/api.json): `shared` runs anywhere (page, Worker, Bun) and imports only shared modules;
// `web` needs a page; `server` needs a Worker or Bun. Web and server never import each other. `src/lab/` is the
// wild end: anything goes there, no side, no lock, and nothing outside lab may import it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arr, obj, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";
import { outline } from "./outline.ts";

const PKG = join(import.meta.dir, "../packages/util");
const SRC = join(PKG, "src");
const LOCK = join(PKG, "API.lock");
const BREAKING = join(PKG, "BREAKING.md");
const BREAKING_HEAD = "# @rustybuns/util breaking changes\n\nWhat changed in a stable module, newest first, and why. The stable ring's release notes read this.\n";
const SIDES = ["shared", "web", "server"] as const;
type Side = (typeof SIDES)[number];

const names = arr(str(40, { re: /^[a-z0-9-]+$/ }), 200);
const Manifest = obj({ stable: names, shared: names, web: names, server: names });

/** The module names under src/ (no lab), and each one's text. */
export function modules(src = SRC): Map<string, string> {
  return new Map(readdirSync(src).filter((f) => f.endsWith(".ts")).sort().map((f) => [f.slice(0, -3), readFileSync(join(src, f), "utf8")]));
}

/** What a module imports: sibling modules by name, plus anything else (packages, node:, lab/) as written. */
export function importsOf(text: string): { local: string[]; other: string[] } {
  const local: string[] = [], other: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)) {
    const spec = m[1]!;
    const sib = /^\.\/([a-z0-9-]+)\.ts$/.exec(spec);
    if (sib) local.push(sib[1]!);
    else other.push(spec);
  }
  return { local: [...new Set(local)], other: [...new Set(other)] };
}

/** Everything wrong with the sides: a module with none or two, a name that isn't a module, an import the wrong way. */
export function sideProblems(manifest: Record<Side | "stable", string[]>, mods: Map<string, string>): string[] {
  const out: string[] = [];
  const sideOf = new Map<string, Side>();
  for (const side of SIDES) for (const n of manifest[side]) {
    if (!mods.has(n)) out.push(`api.json: ${side} lists "${n}", which isn't a module in src/`);
    const had = sideOf.get(n);
    if (had) out.push(`api.json: "${n}" is both ${had} and ${side}`);
    sideOf.set(n, side);
  }
  for (const n of manifest.stable) if (!sideOf.has(n)) out.push(`api.json: stable lists "${n}", which has no side`);
  const stable = new Set(manifest.stable);
  for (const n of stable) for (const m of (mods.get(n) ?? "").matchAll(/^export \* from "\.\/([a-z0-9-]+)\.ts"/gm))
    if (!stable.has(m[1]!)) out.push(`src/${n}.ts is stable and re-exports all of ${m[1]}, so ${m[1]} is stable too: add it to stable in api.json`);
  for (const [n, text] of mods) {
    const side = sideOf.get(n);
    if (!side) { out.push(`src/${n}.ts has no side: add it to shared, web or server in packages/util/api.json`); continue; }
    const { local, other } = importsOf(text);
    for (const o of other) {
      if (o.startsWith("./lab/")) out.push(`src/${n}.ts imports ${o}: lab is for trying things, so only lab may import lab`);
      else if (side === "shared") out.push(`src/${n}.ts is shared but imports ${o}: a shared module imports only shared modules, so it runs (and copies) anywhere`);
    }
    for (const dep of local) {
      const ds = sideOf.get(dep);
      if (!ds) continue;
      if (side === "shared" && ds !== "shared") out.push(`src/${n}.ts is shared but imports ${dep} (${ds})`);
      if ((side === "web" && ds === "server") || (side === "server" && ds === "web")) out.push(`src/${n}.ts is ${side} but imports ${dep} (${ds})`);
    }
  }
  return out;
}

/** The lock: each stable module's exports, one signature a line (doc comments left out, so rewording one is free). */
export function lockText(stable: string[], mods: Map<string, string>): string {
  const parts = ["# @rustybuns/util stable API. Written by `bun scripts/util-api.ts --update`; CI fails when the code differs.", ""];
  for (const n of [...stable].sort()) {
    parts.push(`## ${n}`);
    let inClass = false;
    for (const e of outline(mods.get(n) ?? "", `${n}.ts`)) {
      if (e.depth === 0) inClass = e.exported && e.kind === "class";
      if (!e.exported || (e.depth > 0 && !inClass)) continue;
      parts.push(`${"  ".repeat(e.depth)}${e.kind === "export" ? `export ${e.name}` : e.sig}`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

/** Lines of `before` that aren't in `after` (headings aside): a stable export that changed or went away. */
export function dropped(before: string, after: string): string[] {
  const keep = new Set(after.split("\n"));
  let at = "";
  const out: string[] = [];
  for (const l of before.split("\n")) {
    if (l.startsWith("## ")) at = l.slice(3);
    else if (l.trim() && !l.startsWith("#") && !keep.has(l)) out.push(`${at}: ${l.trim()}`);
  }
  return out;
}

/** The shared modules `want` needs, itself included, in a stable order. */
export function closure(want: string[], shared: Set<string>, mods: Map<string, string>): string[] {
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    if (!shared.has(n)) throw new Error(`${n} isn't shared, so it doesn't copy on its own (shared: ${[...shared].join(", ")})`);
    seen.add(n);
    importsOf(mods.get(n) ?? "").local.forEach(visit);
  };
  want.forEach(visit);
  return [...seen].sort();
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const manifest = Manifest(JSON.parse(readFileSync(join(PKG, "api.json"), "utf8")));
  const mods = modules();
  if (argv[0] === "--copy") {
    const dir = argv.at(-1), want = argv.slice(1, -1);
    if (!dir || !want.length) { console.error("usage: bun scripts/util-api.ts --copy <module ...> <dir>"); process.exit(1); }
    mkdirSync(dir, { recursive: true });
    let files: string[];
    try { files = closure(want, new Set(manifest.shared), mods); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
    for (const n of files) copyFileSync(join(SRC, `${n}.ts`), join(dir, `${n}.ts`));
    console.log(`copied ${files.map((n) => `${n}.ts`).join(", ")} to ${dir}`);
    process.exit(0);
  }
  const problems = sideProblems(manifest, mods);
  const now = lockText(manifest.stable, mods);
  const was = existsSync(LOCK) ? readFileSync(LOCK, "utf8") : "";
  if (argv[0] === "--update") {
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    const gone = dropped(was, now);
    const why = argv[1] === "--break" ? argv[2]?.trim() : undefined;
    if (gone.length && !why) {
      console.error(`These stable exports changed or went away:\n${gone.map((g) => `  ${g}`).join("\n")}\n` +
        `Apps outside this repo may use them. Keep the old one beside the new, or say why with --update --break "why".`);
      process.exit(1);
    }
    if (gone.length && why) {
      const old = existsSync(BREAKING) ? readFileSync(BREAKING, "utf8") : BREAKING_HEAD;
      const entry = `## ${new Date().toISOString().slice(0, 10)}: ${why}\n\n${gone.map((g) => `- \`${g}\``).join("\n")}\n`;
      writeFileSync(BREAKING, `${BREAKING_HEAD}\n${entry}${old.slice(BREAKING_HEAD.length).replace(/^\n?/, "\n")}`.trimEnd() + "\n");
    }
    writeFileSync(LOCK, now);
    console.log(gone.length ? `API.lock written; ${gone.length} break${gone.length === 1 ? "" : "s"} noted in BREAKING.md` : "API.lock written");
  } else {
    if (now !== was) {
      const gone = dropped(was, now), added = dropped(now, was);
      problems.push(`packages/util/API.lock is out of date:\n${gone.map((g) => `  - ${g}`).concat(added.map((a) => `  + ${a}`)).join("\n")}\n` +
        `  Run bun scripts/util-api.ts --update${gone.length ? ' --break "why"' : ""}.`);
    }
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`util api: ${mods.size} modules on their sides, ${manifest.stable.length} stable and locked`);
  }
}
