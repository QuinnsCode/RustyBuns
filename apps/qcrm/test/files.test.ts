import { expect, test } from "bun:test";
import { local, person, post } from "./app-kit.ts";

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

test("a file on a contact: added as bytes or as JSON, listed, read, downloaded safely, deleted with the org", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "fran@qcrm.test");
  const ann = await (await post(app, cookie, `/api/orgs/${org}/contacts`, { first_name: "Ann", email: "ann@example.com" })).json();

  // A browser sends the bytes; an agent sends JSON.
  const pdf = await app(cookie, `/api/orgs/${org}/files?entity=contacts&id=${ann.id}&name=contract.pdf`, { method: "POST", headers: { "content-type": "application/pdf" }, body: new Uint8Array([37, 80, 68, 70]) });
  expect(pdf.status).toBe(201);
  const note = await (await post(app, cookie, `/api/orgs/${org}/files`, { entity: "contacts", id: ann.id, name: "call notes.txt", text: "wants the blue plan" })).json();
  const page = await (await post(app, cookie, `/api/orgs/${org}/files`, { entity: "contacts", id: ann.id, name: "x.html", type: "text/html", base64: btoa("<script>alert(1)</script>") })).json();

  const list = await (await app(cookie, `/api/orgs/${org}/files?entity=contacts&id=${ann.id}`)).json();
  expect(list.items.map((f: { name: string }) => f.name).sort()).toEqual(["call notes.txt", "contract.pdf", "x.html"]);
  expect(list.used).toEqual({ count: 3, bytes: 4 + 19 + 25 });
  expect((await (await app(cookie, `/api/orgs/${org}/files/${note.id}`)).json()).text).toBe("wants the blue plan");

  // An HTML upload never comes back as a page on this origin.
  const got = await app(cookie, `/api/orgs/${org}/files/${page.id}/content`);
  expect(got.headers.get("content-type")).toBe("application/octet-stream");
  expect(got.headers.get("content-disposition")).toStartWith("attachment;");
  expect(got.headers.get("content-security-policy")).toContain("sandbox");
  expect(await got.text()).toBe("<script>alert(1)</script>");

  // Someone else's org, a row that isn't there, and a seasonal member are refused.
  const other = await person(app, "gus@qcrm.test");
  expect((await app(other.cookie, `/api/orgs/${org}/files/${note.id}`)).status).toBe(404);
  expect((await post(app, cookie, `/api/orgs/${org}/files`, { entity: "deals", id: "nope", name: "a.txt", text: "x" })).status).toBe(404);
  await post(app, cookie, `/api/orgs/${org}/members`, { email: "gus@qcrm.test" });
  expect((await post(app, other.cookie, `/api/orgs/${org}/files`, { entity: "contacts", id: ann.id, name: "a.txt", text: "x" })).status).toBe(403);

  expect((await app(cookie, `/api/orgs/${org}/files/${note.id}`, { method: "DELETE" })).status).toBe(200);
  expect((await app(cookie, `/api/orgs/${org}/files/${note.id}`)).status).toBe(404);
  expect((await app.env.FILES!.list({ prefix: `${org}/` })).objects).toHaveLength(2);
  expect((await app(cookie, `/api/orgs/${org}`, { method: "DELETE" })).status).toBe(200);
  expect((await app.env.FILES!.list({ prefix: `${org}/` })).objects).toHaveLength(0);
});

// The hourly sweep deletes trial orgs through deleteOrg (demo.test.ts), and deleteOrg drops the files (above).
test("a trial org keeps five small files", async () => {
  const app = await local();
  const res = await post(app, "", "/api/scenario", { name: "empty" });
  const cookie = cookieOf(res), { org } = await res.json();
  const id = (await (await post(app, cookie, `/api/orgs/${org.id}/contacts`, { first_name: "Tia" })).json()).id;
  const add = (name: string, text: string) => post(app, cookie, `/api/orgs/${org.id}/files`, { entity: "contacts", id, name, text });

  expect((await add("big.txt", "x".repeat(300 << 10))).status).toBe(413);
  for (let i = 0; i < 5; i++) expect((await add(`n${i}.txt`, "hi")).status).toBe(201);
  const full = await add("n5.txt", "hi");
  expect(full.status).toBe(413);
  expect((await full.json()).error).toContain("make an account");
});
