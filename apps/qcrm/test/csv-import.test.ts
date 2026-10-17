import { expect, test } from "bun:test";
import { local, person, post } from "./app-kit.ts";
import { parseCsv } from "../src/csv-import.ts";

test("parseCsv: quotes, escaped quotes, embedded newlines, CRLF, BOM", () => {
  expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n"two\nlines",z\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
});

test("import contacts and companies from a CSV: mapping, dedupe, bad rows, roles", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const base = `/api/orgs/${org}`;
  await post(app, cookie, `${base}/contacts`, { first_name: "Ada", email: "ada@example.com" });

  const csv = 'First Name,Last Name,E-mail,Tags,Ignored\nAda,Again,ADA@example.com,x,1\nBen,Dubois,ben@example.com,lead;vip,2\nBen,Twice,ben@example.com,,3\nCy,Bad,not-an-email,,4\n';
  const r = await post(app, cookie, `${base}/contacts/import`, { csv });
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ created: 1, duplicates: 2, failed: 1, errors: [{ row: 5 }] });
  const list = await (await app(cookie, `${base}/contacts?q=ben`)).json();
  expect(list.items[0]).toMatchObject({ first_name: "Ben", email: "ben@example.com", tags: ["lead", "vip"] });

  // Raw text/csv with an explicit map for a column the names don't give away.
  const raw = await app(cookie, `${base}/companies/import?map=${encodeURIComponent('{"Co":"name"}')}`, { method: "POST", headers: { "content-type": "text/csv" }, body: "Co,Website\nAcme,acme.com\nacme,acme.com\n" });
  expect(await raw.json()).toMatchObject({ created: 1, duplicates: 1 });

  expect((await post(app, cookie, `${base}/contacts/import`, { csv: "nope,nada\n1,2\n" })).status).toBe(400);
});
