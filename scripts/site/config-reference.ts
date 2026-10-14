// The config-key reference: every `rustybuns.config.ts` key with its type and doc comment, read from
// the types in packages/cli/src/config.ts at this version, so the page can't drift from the code.
// Interfaces and type aliases get a section each; inline `{ ... }` types are flattened into dotted
// keys (`worker.compatibilityDate`), and a union of objects (a Binding) gets a table per member.
import ts from "typescript";
import { type Page, type Source, slug } from "./lib.ts";

const FILE = "packages/cli/src/config.ts";

type Row = { key: string; type: string; optional: boolean; doc: string };
type Section = { title: string; doc: string; rows: Row[] };

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

// The text of the /** ... */ comment right before a node, with its `@default` tag turned into a sentence.
function docOf(text: string, node: ts.Node): string {
  // A comment on the same line as the token before it (`{ /** Entry. */ main?`) counts as trailing.
  const ranges = [...(ts.getTrailingCommentRanges(text, node.getFullStart()) ?? []), ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])];
  const last = ranges.filter((r) => text.startsWith("/**", r.pos)).at(-1);
  if (!last) return "";
  const lines = text
    .slice(last.pos + 3, last.end - 2)
    .split("\n")
    .map((l) => l.replace(/^\s*\*? ?/, "").trimEnd());
  const body = lines.join("\n").replace(/@default\s+([^\n]*?)\s*(?=@|\n|$)/g, "Default: `$1`.").trim();
  return body.replace(/\n(?!\n)/g, " ").replace(/\s+/g, " ");
}

const typeText = (sf: ts.SourceFile, node: ts.TypeNode) =>
  node.getText(sf).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();

// The keys of an object type, descending into inline object types so nested keys read as `a.b`.
function rows(sf: ts.SourceFile, lit: ts.TypeLiteralNode | ts.InterfaceDeclaration, prefix = ""): Row[] {
  const out: Row[] = [];
  for (const m of lit.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const name = m.name.getText(sf).replace(/^["']|["']$/g, "");
    const key = prefix + name;
    const inner = ts.isTypeLiteralNode(m.type) ? m.type : undefined;
    out.push({ key, type: inner ? "object" : typeText(sf, m.type), optional: !!m.questionToken, doc: docOf(sf.text, m) });
    if (inner) out.push(...rows(sf, inner, `${key}.`));
  }
  return out;
}

// One section per exported interface, and per object member of an exported union.
function sections(sf: ts.SourceFile): Section[] {
  const out: Section[] = [];
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isInterfaceDeclaration(st)) {
      out.push({ title: st.name.text, doc: docOf(sf.text, st), rows: rows(sf, st) });
    } else if (ts.isTypeAliasDeclaration(st) && ts.isUnionTypeNode(st.type)) {
      for (const member of st.type.types) {
        if (!ts.isTypeLiteralNode(member)) continue;
        const all = rows(sf, member);
        const tag = all.find((r) => r.key === "type")?.type.replace(/^"|"$/g, "");
        out.push({ title: tag ? `${st.name.text}: ${tag}` : st.name.text, doc: docOf(sf.text, member), rows: all.filter((r) => r.key !== "type") });
      }
    }
  }
  return out.filter((s) => s.rows.length);
}

export function configReference(src: Source): Page | undefined {
  const text = src.read(FILE);
  if (!text) return;
  const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);
  const secs = sections(sf);
  const main = secs.find((s) => s.title === "RustyBunsConfig");
  if (!main) return;
  const md = [
    "# Config reference",
    "",
    `Every key \`rustybuns.config.ts\` takes, generated from the types in [${FILE}](${FILE}). A key shown as \`a.b\` is the \`b\` key of the \`a\` object. A \`?\` after a key means it can be left out.`,
    "",
    ...[main, ...secs.filter((s) => s !== main)].flatMap((s) => [
      `## ${s.title}`,
      "",
      ...(s.doc ? [s.doc, ""] : []),
      "| Key | Type | Description |",
      "| --- | --- | --- |",
      ...s.rows.map((r) => `| \`${r.key}${r.optional ? "?" : ""}\` | \`${cell(r.type)}\` | ${cell(r.doc)} |`),
      "",
    ]),
  ].join("\n");
  return { path: "guides/config-reference.html", title: "Config reference", md, from: FILE, section: "Guides" };
}
