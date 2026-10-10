// A merge can settle every line and still leave code that won't build:
// keeping one side of a stretch both rewrote can drop a declaration the other
// side's later lines use, or land a second one. Before a merge lands, its
// JavaScript and TypeScript files are checked for redeclared names, names
// used but never declared, and code that no longer parses. Only a problem
// neither main's copy nor the branch's had counts, so the globals a file uses
// (node, browser, Bun) never need listing: each side already uses them.
//
// Babel's parser, pure JavaScript, runs in the Worker; it reports
// redeclarations itself. The undefined-name check is a scope walk over its
// tree, types left out.

import { parse } from "@babel/parser";
import { apply, text, type Conflict, type Doc, type Op } from "./lines.ts";

export interface Problem { key: string; message: string; line: number }

const EXT = /\.([cm]?[jt]sx?)$/;
export const lintable = (path: string) => EXT.test(path);

export function problems(path: string, source: string): Problem[] {
  const ext = path.match(EXT)?.[1] ?? "js";
  let ast: any;
  try {
    ast = parse(source, {
      sourceType: ext === "cjs" || ext === "cts" ? "script" : "module",
      errorRecovery: true, allowReturnOutsideFunction: true,
      plugins: [...(ext.includes("t") ? ["typescript" as const] : []), ...(ext.endsWith("x") || ext.endsWith("js") ? ["jsx" as const] : [])],
    });
  } catch (e: any) {
    return [{ key: `syntax:${e.reasonCode ?? "error"}`, message: String(e.message).replace(/ \(\d+:\d+\)$/, ""), line: e.loc?.line ?? 0 }];
  }
  const out: Problem[] = ast.errors.map((e: any) => {
    const name = e.reasonCode === "VarRedeclaration" && e.message.match(/'([^']+)'/)?.[1];
    return name
      ? { key: `redeclared:${name}`, message: `\`${name}\` is declared twice`, line: e.loc.line }
      : { key: `syntax:${e.reasonCode}`, message: String(e.message).replace(/ \(\d+:\d+\)$/, ""), line: e.loc.line };
  });
  for (const [name, line] of undeclared(ast.program)) out.push({ key: `undefined:${name}`, message: `\`${name}\` is not defined`, line });
  return out;
}

/** What the merged text has that neither side had on its own. */
export function newProblems(path: string, merged: string, main: string, branch: string): Problem[] {
  if (!lintable(path)) return [];
  const found = problems(path, merged);
  if (!found.length) return [];
  const had = new Set([...problems(path, main), ...problems(path, branch)].map((p) => p.key));
  const seen = new Set<string>();
  return found.filter((p) => !had.has(p.key) && !seen.has(p.key) && seen.add(p.key));
}

/**
 * A merge with nothing left to settle, checked before it lands: each new
 * problem is a conflict keyed `lint:<problem>`. Resolved `branch`, it lands
 * anyway (someone read it and means to fix it after); `main` keeps it out.
 */
export function lintMerge(path: string, main: Doc, branch: Doc, m: { ops: Op[]; by: string[] }, resolve: Record<string, "branch" | "main"> = {}): Conflict[] {
  if (!lintable(path) || !m.ops.length) return [];
  const merged = structuredClone(main);
  if (!apply(merged, m.ops, m.by, 0, main.rev).ok) return [];
  return newProblems(path, text(merged), text(main), text(branch))
    .filter((p) => resolve[`lint:${p.key}`] !== "branch")
    .map((p) => ({ line: `lint:${p.key}`, base: "", main: null, branch: null, lint: `${p.message} (line ${p.line})` }));
}

interface Scope { names: Set<string>; parent: Scope | null; fn: boolean }

// Keys that only ever hold types, and nodes that are only types.
const TYPES = new Set(["typeAnnotation", "returnType", "typeParameters", "typeArguments", "superTypeParameters", "superTypeArguments", "implements", "predicate"]);
const TS_EXPR = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

/** Each name read or assigned that no enclosing scope declares, with the line of its first use. */
function undeclared(program: any): Map<string, number> {
  const scopes = new Map<any, Scope>(), out = new Map<string, number>();
  const root: Scope = { names: new Set(), parent: null, fn: true };
  scopes.set(program, root);
  // Pass one: every scope and what it declares, so a use before its declaration (hoisted, or in a function called later) still resolves.
  walk(program, root, (node, scope, open) => {
    if (open) scopes.set(node, open);
    const s = open ?? scope;
    if (node.type === "VariableDeclaration") {
      let to = s;
      if (node.kind === "var") while (!to.fn) to = to.parent!;
      for (const d of node.declarations) bind(d.id, to);
    } else if ((node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction" || node.type === "ClassDeclaration" || node.type === "TSEnumDeclaration" || node.type === "TSImportEqualsDeclaration") && node.id) scope.names.add(node.id.name);
    else if (node.type === "TSModuleDeclaration" && node.id.type === "Identifier") scope.names.add(node.id.name);
    else if ((node.type === "FunctionExpression" || node.type === "ClassExpression") && node.id) s.names.add(node.id.name);
    else if (node.type === "ImportDeclaration") for (const sp of node.specifiers) scope.names.add(sp.local.name);
    else if (node.type === "CatchClause" && node.param) bind(node.param, s);
    if (FN.has(node.type)) {
      for (const p of node.params) bind(p.type === "TSParameterProperty" ? p.parameter : p, s);
      if (node.type !== "ArrowFunctionExpression") s.names.add("arguments");
    }
  });
  // Pass two: every name in a reading position, looked up through the scopes.
  walk(program, root, (node, scope, open, ref) => {
    if (!ref) return;
    for (let s: Scope | null = open ?? scope; s; s = s.parent) if (s.names.has(node.name)) return;
    if (!out.has(node.name)) out.set(node.name, node.loc.start.line);
  }, scopes);
  return out;
}

function bind(p: any, s: Scope) {
  if (!p) return;
  if (p.type === "Identifier") s.names.add(p.name);
  else if (p.type === "ObjectPattern") for (const q of p.properties) bind(q.type === "RestElement" ? q.argument : q.value, s);
  else if (p.type === "ArrayPattern") for (const q of p.elements) bind(q, s);
  else if (p.type === "RestElement") bind(p.argument, s);
  else if (p.type === "AssignmentPattern") bind(p.left, s);
}

/**
 * Visit each node with the scope it sits in (and `open`, the scope it opens),
 * calling `ref` true for an Identifier that reads or assigns a name. Binding
 * names, property keys, labels and types aren't references. With `known`
 * (pass two), a scope node gets back the scope pass one made for it.
 */
function walk(node: any, scope: Scope, visit: (node: any, scope: Scope, open: Scope | null, ref?: boolean) => void, known?: Map<any, Scope>) {
  const go = (n: any, s: Scope) => walk(n, s, visit, known);
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Identifier") { visit(node, scope, null, true); return; }
  if (node.type.startsWith("TS") && !TS_EXPR.has(node.type)) {
    // Types say nothing about values; an enum's initializers and a namespace's body do.
    if (node.type === "TSEnumDeclaration") { visit(node, scope, null); for (const m of node.members ?? node.body?.members ?? []) go(m.initializer, scope); }
    else if (node.type === "TSModuleDeclaration") { const open = opens(node, scope, known); visit(node, scope, open); go(node.body, open); }
    else if (node.type === "TSModuleBlock") for (const b of node.body) go(b, scope);
    else if (node.type === "TSExportAssignment") go(node.expression, scope);
    else if (node.type === "TSParameterProperty") go(node.parameter, scope);
    else visit(node, scope, null);
    return;
  }
  const isScope = node.type === "BlockStatement" || node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement"
    || node.type === "CatchClause" || node.type === "SwitchStatement" || node.type === "StaticBlock" || node.type === "ClassExpression" || FN.has(node.type);
  const open = isScope ? opens(node, scope, known) : null;
  visit(node, scope, open);
  const inner = open ?? scope;
  // Binding names: walk only what they compute (defaults, computed keys).
  const pattern = (p: any, s: Scope) => {
    if (!p) return;
    if (p.type === "Identifier") return;
    if (p.type === "ObjectPattern") for (const q of p.properties) { if (q.type === "RestElement") pattern(q.argument, s); else { if (q.computed) go(q.key, s); pattern(q.value, s); } }
    else if (p.type === "ArrayPattern") for (const q of p.elements) pattern(q, s);
    else if (p.type === "RestElement") pattern(p.argument, s);
    else if (p.type === "AssignmentPattern") { pattern(p.left, s); go(p.right, s); }
    else if (p.type === "TSParameterProperty") pattern(p.parameter, s);
    else go(p, s);
  };
  switch (node.type) {
    case "VariableDeclarator": pattern(node.id, scope); go(node.init, scope); return;
    case "CatchClause": pattern(node.param, inner); go(node.body, inner); return;
    case "ImportDeclaration": case "ExportAllDeclaration": return;
    case "ExportNamedDeclaration": if (node.source) return; go(node.declaration, scope); for (const sp of node.specifiers) go(sp.local, scope); return;
    case "ExportDefaultDeclaration": go(node.declaration, scope); return;
    case "MemberExpression": case "OptionalMemberExpression": go(node.object, scope); if (node.computed) go(node.property, scope); return;
    case "ObjectProperty": case "ClassProperty": case "ClassAccessorProperty": case "ClassPrivateProperty":
      if (node.computed) go(node.key, scope);
      go(node.value, scope);
      for (const d of node.decorators ?? []) go(d, scope);
      return;
    case "LabeledStatement": go(node.body, scope); return;
    case "BreakStatement": case "ContinueStatement": case "MetaProperty": case "PrivateName": return;
    case "ClassDeclaration": case "ClassExpression": go(node.superClass, inner); for (const d of node.decorators ?? []) go(d, inner); go(node.body, inner); return;
  }
  if (FN.has(node.type)) {
    if ((node.type === "ObjectMethod" || node.type === "ClassMethod") && node.computed) go(node.key, scope);
    for (const p of node.params) pattern(p, inner);
    go(node.body, inner);
    return;
  }
  for (const k in node) {
    if (k === "loc" || k === "start" || k === "end" || k === "extra" || k === "leadingComments" || k === "trailingComments" || k === "innerComments" || TYPES.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) go(c, inner);
    else if (v && typeof v === "object") go(v, inner);
  }
}

function opens(node: any, scope: Scope, known?: Map<any, Scope>): Scope {
  return known?.get(node) ?? { names: new Set(), parent: scope, fn: FN.has(node.type) || node.type === "StaticBlock" || node.type === "TSModuleDeclaration" };
}
