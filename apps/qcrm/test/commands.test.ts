import { expect, test } from "bun:test";
import { list, match, register, run } from "../src/app/commands.ts";

test("commands: the menu and code share one registry, and a disabled command is neither listed nor runnable", async () => {
  const ran: unknown[] = [];
  const off = register([
    { id: "deals.new", title: "New deal", keywords: "create", run: (a) => { ran.push(a); } },
    { id: "go.deals", title: "Go to Deals", run: () => {} },
    { id: "contacts.new", title: "New contact", enabled: false, run: () => { ran.push("no"); } },
    { id: "deals.search", title: "Search deals", menu: false, run: (a) => { ran.push(a); } },
  ]);
  expect(match("new").map((c) => c.id)).toEqual(["deals.new"]);          // title hit; the disabled one is hidden
  expect(match("deal create").map((c) => c.id)).toEqual(["deals.new"]);  // every word must hit
  expect(match("deals").map((c) => c.id)).toEqual(["go.deals"]);         // menu:false stays out of the menu
  await run("deals.search", { q: "acme" });                              // ...but runs from code
  expect(ran).toEqual([{ q: "acme" }]);
  await expect(run("contacts.new")).rejects.toThrow("no command");
  off();
  expect(list()).toEqual([]);
});
