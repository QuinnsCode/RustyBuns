import { expect, test } from "bun:test";
import { findings } from "./boundary-audit.ts";

const why = (line: string) => findings(line).map(([, w]) => w);

test("a parsed value asserted to a shape, any or never is found", () => {
  expect(why("const { owner } = (await req.json()) as { owner: string };")).toHaveLength(1);
  expect(why("const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;")).toHaveLength(1);
  expect(why("const o = JSON.parse(raw) as Row;")).toHaveLength(1);
  expect(why("const p: any = await res.json();")).toHaveLength(1);
  expect(why("const out = (await res.json()) as any;")).toHaveLength(1);
  expect(why("const j = await res.json();")).toHaveLength(1);
  expect(why("return lease(conf, await req.json().catch(() => null) as never);")).toHaveLength(1);
});

test("a value kept as unknown until it is checked is not", () => {
  expect(why("const b = (await req.json().catch(() => ({}))) as { ops?: unknown; claim?: unknown };")).toEqual([]);
  expect(why("const v: unknown = await req.json().catch(() => null);")).toEqual([]);
  expect(why("const f: Foo = await res.json();")).toEqual([]);
});

test("a hand-rolled isRecord is found; a list of records or a typed map is not", () => {
  expect(why("const isObj = (v: unknown): v is Record<string, unknown> => typeof v === \"object\" && v !== null;")).toHaveLength(1);
  expect(why("function isRecord(x: unknown): x is { [k: string]: unknown } {")).toHaveLength(1);
  expect(why("const rows = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v);")).toEqual([]);
  expect(why("const isObj = (v: Json): v is { [k: string]: Json } => typeof v === \"object\";")).toEqual([]);
});

test("a cast on what goes into the parse, or a response being built, is not a parsed value", () => {
  expect(why("const last = JSON.parse(row.last_report as string);")).toEqual([]);
  expect(why("return Response.json({ ok: true } as Reply);")).toEqual([]);
  expect(why("const x = 1; // await req.json() as { a: string }")).toEqual([]);
});

test("the line number is the line the value is on", () => {
  expect(findings("a\nb\nconst x = JSON.parse(s) as { n: number };").map(([n]) => n)).toEqual([3]);
});
