import { expect, test } from "bun:test";
import { cli } from "../scripts/cli.ts";
import { handleApi } from "../src/api.ts";
import { apiCommands } from "../src/app/api-commands.ts";
import { ORIGIN } from "../src/local.ts";
import { reaches, tools } from "../src/mcp-tools.ts";
import { local, person, post } from "./app-kit.ts";

test("the CLI runs any tool with an API key: body fields as flags, the key's org filled in", async () => {
  const app = await local();
  const { cookie, org } = await person(app, "cleo@qcrm.test");
  const key = (await (await post(app, cookie, `/api/orgs/${org}/keys`, { name: "shell" })).json()).secret;
  const out: string[] = [], err: string[] = [];
  const run = (...argv: string[]) => cli(argv, { url: ORIGIN, key, fetcher: (r) => handleApi(r, app.env), io: { out: (s) => out.push(s), err: (s) => err.push(s) } });

  expect(await run("create_contact", "--first_name", "Ann", "--email", "ann@example.com", "--tags", '["vip"]')).toBe(0);
  expect(JSON.parse(out.pop()!)).toMatchObject({ first_name: "Ann", tags: ["vip"], org_id: org });
  expect(await run("list_contacts", "--q", "ann")).toBe(0);
  expect(JSON.parse(out.pop()!).items).toHaveLength(1);
  expect(await run("get_contact")).toBe(1);
  expect(err.pop()).toContain("id is required");
  expect(await run("nope")).toBe(1);
  expect(await run()).toBe(0);
  expect(out.pop()).toContain("create_contact");
});

test("Cmd-K offers every tool a role reaches, no more", () => {
  const names = (role: string) => apiCommands("org_x", role).map((c) => c.name);
  for (const role of ["seasonal", "employee", "manager", "owner", "admin"]) {
    const want = tools({ cookieOnly: true }).filter((t) => !t.open && t.tag !== "Admin" && reaches(role, t.role)).map((t) => `crm_${t.name}`);
    expect(names(role).sort()).toEqual(want.sort());
  }
  expect(names("seasonal")).not.toContain("crm_create_webhook");
  expect(names("owner")).toContain("crm_create_key"); // cookie-only: the signed-in page may, a key may not
  expect(names("super_admin")).toContain("crm_admin_list_orgs");
  // A risky one with nothing to ask takes a yes first; one with several inputs asks for JSON.
  const owner = apiCommands("org_x", "admin");
  expect(owner.find((c) => c.name === "crm_delete_org")!.inputSchema!.required).toEqual(["confirm"]);
  expect(owner.find((c) => c.name === "crm_update_contact")!.ask).toContain("JSON");
});
