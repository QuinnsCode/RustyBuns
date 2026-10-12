import { expect, test } from "bun:test";
import { hyperdrive } from "../src/bindings/hyperdrive.ts";

test("hyperdrive: the origin's URL in the binding's shape, encoded parts decoded", () => {
  const url = "postgresql://postgres.ref:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
  expect(hyperdrive(url)).toEqual({
    connectionString: url, host: "aws-0-us-east-1.pooler.supabase.com", port: 6543,
    user: "postgres.ref", password: "p@ss", database: "postgres",
  });
  expect(hyperdrive("postgres://u:pw@localhost/app")!.port).toBe(5432);
});

test("hyperdrive: no URL leaves the binding out; a URL that isn't Postgres is refused", () => {
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => said.push(m);
  try {
    expect(hyperdrive(undefined, "DB")).toBeUndefined();
    expect(hyperdrive("", "DB")).toBeUndefined();
  } finally { console.warn = warn; }
  expect(said[0]).toMatch(/^\[DB\] no Postgres URL set/);
  expect(() => hyperdrive("mysql://u:pw@h/db", "DB")).toThrow(/isn't Postgres/);
  expect(() => hyperdrive("not a url", "DB")).toThrow(/not a URL/);
});
