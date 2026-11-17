import { expect, test } from "bun:test";
import { local, person, post } from "./app-kit.ts";

// Each route's body goes through a guard: a wrong one is a 400 that names the field, in the route's own words.
test("a body of the wrong shape answers 400 with the field and what it wants", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "alice@qcrm.test");
  const o = `/api/orgs/${org}`;
  const script = await (await post(app, cookie, `${o}/scripts`, { name: "  Tally  ", body: "return 1;" })).json();
  expect(script.name).toBe("Tally");

  const cases: [string, unknown, string, string?][] = [
    ["/api/orgs", { name: "   " }, "name: what to call the org"],
    [`${o}/members`, { email: "nobody" }, "email: the account to add"],
    [`${o}/members`, { email: "bob@qcrm.test", role: "king" }, "role: one of seasonal, employee, manager, owner, admin"],
    [`${o}/keys`, {}, "name: what this key is for"],
    [`${o}/seed`, { n: "lots" }, "n: 1 to 100000 contacts"],
    [`${o}/sync`, { ops: "all of them" }, "ops: a list of at most 500"],
    [`${o}/scripts`, { name: "x", body: 7 }, "body: JavaScript, up to"],
    [`${o}/scripts/${script.id}`, { enabled: "yes" }, "enabled: true or false", "PUT"],
    [`${o}/webhooks`, { url: "https://example.com/hook", format: "fax" }, "format: one of json, slack, discord"],
    [`${o}/webhooks`, { url: "https://example.com/hook", events: [] }, "events: some of"],
    ["/api/scenario", { name: "nope" }, "name: one of"],
  ];
  for (const [path, body, said, method] of cases) {
    const res = await post(app, cookie, path, body, method);
    expect([path, res.status]).toEqual([path, 400]);
    expect((await res.json()).error).toStartWith(said);
  }
});
