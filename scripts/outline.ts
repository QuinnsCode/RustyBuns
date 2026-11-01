// A file's outline: `bun run outline <file> [name]` prints each top-level declaration (function, class, interface, type,
// enum, const, and the members of a class) with its line range and the first line of its doc comment, so an agent
// jumps straight to the one range it needs instead of paging through the file with `sed -n` (Dexter counted 5,316
// such reads in 14 days, #3166). With a `name`, it prints that symbol's source with line numbers instead.
//
//   bun run outline apps/codesplitter/src/repos.ts
//   bun run outline apps/codesplitter/src/repos.ts repoRow
import ts from "typescript";

export type Entry = { kind: string; name: string; from: number; to: number; doc: string; exported: boolean; depth: number };

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
  const add = (kind: string, name: string, node: ts.Node, exported: boolean, depth: number, docNode: ts.Node = node) =>
    out.push({ kind, name, from: line(node.getStart(sf)), to: line(node.getEnd()), doc: firstDoc(text, docNode), exported, depth });
  const isExported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);

  for (const st of sf.statements) {
    const exported = isExported(st);
    if (ts.isFunctionDeclaration(st)) { if (st.body || !out.at(-1) || out.at(-1)!.name !== (st.name?.text ?? "default")) add("function", st.name?.text ?? "default", st, exported, 0); }
    else if (ts.isClassDeclaration(st)) {
      add("class", st.name?.text ?? "default", st, exported, 0);
      for (const m of st.members) {
        const name = ts.isConstructorDeclaration(m) ? "constructor" : m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) || ts.isPrivateIdentifier(m.name)) ? m.name.text : "";
        if (name && (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m))) add("method", name, m, false, 1);
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
  }
  return out;
}

export function render(entries: Entry[], file: string): string[] {
  const w = String(Math.max(0, ...entries.map((e) => e.to))).length;
  return [file, ...entries.map((e) => {
    const range = e.from === e.to ? `${String(e.from).padStart(w)}${" ".repeat(w + 1)}` : `${String(e.from).padStart(w)}-${String(e.to).padEnd(w)}`;
    return `${range}  ${"  ".repeat(e.depth)}${e.exported ? "export " : ""}${e.kind} ${e.name}${e.doc ? `  // ${e.doc.slice(0, 100)}` : ""}`;
  })];
}

/** The source of every top-level symbol called `name` (or class member `Class.name`), numbered. */
export function show(text: string, entries: Entry[], name: string): string[] | null {
  const src = text.split("\n");
  const hits = entries.filter((e) => e.name === name);
  if (!hits.length) return null;
  return hits.flatMap((e) => src.slice(e.from - 1, e.to).map((l, i) => `${String(e.from + i).padStart(5)}  ${l}`));
}

if (import.meta.main) {
  const [file, name] = process.argv.slice(2);
  if (!file || file.startsWith("-")) { console.error("usage: bun run outline <file> [name]"); process.exit(2); }
  const f = Bun.file(file);
  if (!(await f.exists())) { console.error(`outline: no such file ${file}`); process.exit(1); }
  const text = await f.text(), entries = outline(text, file);
  if (name) {
    const lines = show(text, entries, name);
    if (!lines) { console.error(`outline: no ${name} in ${file}; names: ${[...new Set(entries.map((e) => e.name))].join(", ")}`); process.exit(1); }
    console.log(lines.join("\n"));
  } else console.log(render(entries, file).join("\n"));
}
