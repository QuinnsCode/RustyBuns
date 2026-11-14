// A file's outline: `bun run outline <file> [name]` prints each top-level declaration (function, class, interface, type,
// enum, const, and the members of a class) with its line range and the first line of its doc comment, so an agent
// jumps straight to the one range it needs instead of paging through the file with `sed -n` (Dexter counted 5,316
// such reads in 14 days, #3166). With a `name`, it prints that symbol's source with line numbers instead.
// With `--api <package dir or file>` it prints a package's public face: each export of every entry point in its
// package.json `exports`, one line each with its signature and first doc line, no bodies (#4040).
//
//   bun run outline apps/codesplitter/src/repos.ts
//   bun run outline apps/codesplitter/src/repos.ts repoRow
//   bun run outline --api packages/util
import ts from "typescript";
import { join, relative } from "node:path";
import { isRecord } from "../packages/util/src/guard.ts";

/** `sig` is the declaration cut to one line without its body: what a caller needs to call it. */
export type Entry = { kind: string; name: string; from: number; to: number; doc: string; exported: boolean; depth: number; sig: string };

const SIG = 160;
const oneLine = (t: string) => {
  const s = t.replace(/\s+/g, " ").replace(/^(export )?(default )?(declare )?/, "").replace(/[\s{=;]+$/, "").trim();
  return s.length > SIG ? `${s.slice(0, SIG - 1)}…` : s;
};

const firstDoc = (text: string, node: ts.Node): string => {
  const leading = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const last = leading.filter((c) => text.slice(c.pos, c.pos + 2) === "/*" || text.slice(c.pos, c.pos + 2) === "//").pop();
  if (!last) return "";
  const lines = text.slice(last.pos, last.end).split("\n").map((l) => l.replace(/^\s*(\/\*+|\*+\/|\*|\/\/+)\s?/, "").replace(/\*\/\s*$/, "").trim());
  return lines.find((l) => l && !l.startsWith("@")) ?? "";
};

export function outline(text: string, file = "x.ts"): Entry[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Entry[] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  // A declaration up to its body (a function's `{`, a class's members), or all of it when it has none.
  const head = (node: ts.Node, body?: ts.Node) => oneLine(text.slice(node.getStart(sf), body ? body.getStart(sf) : node.getEnd()));
  const sigOf = (node: ts.Node, outer: ts.Node): string => {
    if (ts.isFunctionLike(node) && "body" in node) return head(node, node.body);
    if (ts.isClassDeclaration(node)) return oneLine(text.slice(node.getStart(sf), node.members.pos));
    if (ts.isVariableDeclaration(node) && ts.isVariableStatement(outer)) {
      const kw = outer.declarationList.flags & ts.NodeFlags.Const ? "const " : "let ";
      const init = node.initializer;
      if (node.type || !init) return oneLine(kw + text.slice(node.getStart(sf), (node.type ?? node).getEnd()));
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return oneLine(`${kw}${node.name.getText(sf)} = ${text.slice(init.getStart(sf), init.body.getStart(sf))}`);
      return oneLine(kw + text.slice(node.getStart(sf), node.getEnd()).split("\n")[0]);
    }
    return head(node);
  };
  const add = (kind: string, name: string, node: ts.Node, exported: boolean, depth: number, docNode: ts.Node = node) =>
    out.push({ kind, name, from: line(node.getStart(sf)), to: line(node.getEnd()), doc: firstDoc(text, docNode), exported, depth, sig: sigOf(node, docNode) });
  const local = new Set<string>();
  const isExported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);

  for (const st of sf.statements) {
    const exported = isExported(st);
    if (ts.isFunctionDeclaration(st)) { if (st.body || !out.at(-1) || out.at(-1)!.name !== (st.name?.text ?? "default")) add("function", st.name?.text ?? "default", st, exported, 0); }
    else if (ts.isClassDeclaration(st)) {
      add("class", st.name?.text ?? "default", st, exported, 0);
      for (const m of st.members) {
        const name = ts.isConstructorDeclaration(m) ? "constructor" : m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : "";
        if (!name || !(ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m))) continue;
        // `exported` on a member means public: what `--api` shows under its class.
        const hidden = ts.isPrivateIdentifier(m.name ?? st) || !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword);
        add("method", name, m, false, 1);
        out.at(-1)!.exported = !hidden;
      }
    }
    else if (ts.isInterfaceDeclaration(st)) add("interface", st.name.text, st, exported, 0);
    else if (ts.isTypeAliasDeclaration(st)) add("type", st.name.text, st, exported, 0);
    else if (ts.isEnumDeclaration(st)) add("enum", st.name.text, st, exported, 0);
    else if (ts.isModuleDeclaration(st)) add("namespace", st.name.text, st, exported, 0);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const fn = d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
        add(fn ? "function" : st.declarationList.flags & ts.NodeFlags.Const ? "const" : "let", ts.isIdentifier(d.name) ? d.name.text : d.name.getText(sf), d, exported, 0, st);
      }
    }
    else if (ts.isExportAssignment(st)) add("export", "default", st, true, 0);
    else if (ts.isExportDeclaration(st)) {
      const named = st.exportClause && ts.isNamedExports(st.exportClause) ? st.exportClause.elements : undefined;
      if (st.moduleSpecifier) {
        const names = named ? named.map((e) => e.name.text).join(", ") : st.exportClause && ts.isNamespaceExport(st.exportClause) ? `* as ${st.exportClause.name.getText(sf)}` : "*";
        add("export", `${names} from ${st.moduleSpecifier.getText(sf)}`, st, true, 0);
      } else for (const e of named ?? []) local.add((e.propertyName ?? e.name).text);
    }
  }
  // `export { a, b }` after the declarations exports them too.
  for (const e of out) if (e.depth === 0 && local.has(e.name)) e.exported = true;
  return out;
}

export function render(entries: Entry[], file: string): string[] {
  const w = String(Math.max(0, ...entries.map((e) => e.to))).length;
  return [file, ...entries.map((e) => {
    const range = e.from === e.to ? `${String(e.from).padStart(w)}${" ".repeat(w + 1)}` : `${String(e.from).padStart(w)}-${String(e.to).padEnd(w)}`;
    return `${range}  ${"  ".repeat(e.depth)}${e.exported && e.depth === 0 && e.kind !== "export" ? "export " : ""}${e.kind} ${e.name}${e.doc ? `  // ${e.doc.slice(0, 100)}` : ""}`;
  })];
}

/** The source of every top-level symbol called `name` (or class member `Class.name`), numbered. */
export function show(text: string, entries: Entry[], name: string): string[] | null {
  const src = text.split("\n");
  const hits = entries.filter((e) => e.name === name);
  if (!hits.length) return null;
  return hits.flatMap((e) => src.slice(e.from - 1, e.to).map((l, i) => `${String(e.from + i).padStart(5)}  ${l}`));
}

/** One file's exports: each one's signature and first doc line, an exported class's public methods under it. */
export function apiLines(entries: Entry[]): string[] {
  const lines: string[] = [];
  let inClass = false;
  for (const e of entries) {
    if (e.depth === 0) inClass = e.exported && e.kind === "class";
    if (!e.exported || (e.depth > 0 && !inClass)) continue;
    const what = e.kind === "export" ? `export ${e.name}` : e.sig;
    lines.push(`  ${"  ".repeat(e.depth)}${what}${e.doc ? `  // ${e.doc.slice(0, 100)}` : ""}`);
  }
  return lines;
}


/** A package's TS entry points from package.json `exports` (or `main`), as [subpath, file]; a file is its own entry. */
export async function entryPoints(target: string): Promise<[string, string][]> {
  const pkg = Bun.file(join(target, "package.json"));
  if (!(await pkg.exists())) return [[".", target]];
  const json: unknown = await pkg.json();
  const exp = isRecord(json) ? json.exports ?? json.main ?? "./index.ts" : "./index.ts";
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" ? v : isRecord(v) ? ["bun", "import", "default", "types"].map((k) => pick(v[k])).find(Boolean) : undefined;
  const seen = new Set<string>();
  return Object.entries(isRecord(exp) ? exp : { ".": exp }).flatMap(([sub, v]): [string, string][] => {
    const f = pick(v);
    if (!f || !/\.[cm]?tsx?$/.test(f) || f.includes("*") || seen.has(f)) return [];
    seen.add(f);
    return [[sub, join(target, f)]];
  });
}

const API_MAX = 400;

/** `--api`: every entry point's exports grouped by file, cut at API_MAX lines with a note saying so. */
export async function api(target: string): Promise<string[]> {
  const out: string[] = [];
  for (const [sub, file] of await entryPoints(target)) {
    const f = Bun.file(file);
    const rel = relative(process.cwd(), file);
    const path = rel && !rel.startsWith("..") ? rel : file;
    if (!(await f.exists())) { out.push(`${path}  (missing)`); continue; }
    out.push(sub === "." ? path : `${path}  (${sub})`, ...apiLines(outline(await f.text(), file)));
  }
  if (out.length <= API_MAX) return out;
  return [...out.slice(0, API_MAX), `… ${out.length - API_MAX} more lines cut; run --api on one of the files above`];
}

if (import.meta.main) {
  const [file, name] = process.argv.slice(2);
  if (file === "--api") {
    if (!name) { console.error("usage: bun run outline --api <package dir or file>"); process.exit(2); }
    const lines = await api(name);
    if (!lines.length) { console.error(`outline: no TS entry points in ${name}`); process.exit(1); }
    console.log(lines.join("\n"));
    process.exit(0);
  }
  if (!file || file.startsWith("-")) { console.error("usage: bun run outline <file> [name] | --api <package dir or file>"); process.exit(2); }
  const f = Bun.file(file);
  if (!(await f.exists())) { console.error(`outline: no such file ${file}`); process.exit(1); }
  const text = await f.text(), entries = outline(text, file);
  if (name) {
    const lines = show(text, entries, name);
    if (!lines) { console.error(`outline: no ${name} in ${file}; names: ${[...new Set(entries.map((e) => e.name))].join(", ")}`); process.exit(1); }
    console.log(lines.join("\n"));
  } else console.log(render(entries, file).join("\n"));
}
