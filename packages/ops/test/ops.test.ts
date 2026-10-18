import { expect, test } from "bun:test";
import { createOps, defineOp, OpError } from "../src/index.ts";

type Ctx = { role: "viewer" | "editor" };
const rank = { viewer: 0, editor: 1 };
const calls: unknown[] = [];

const ops = createOps<Ctx>([
  defineOp({ name: "deals_list", summary: "List deals.", input: { type: "object", properties: {} }, run: () => ["acme"] }),
  defineOp({
    name: "deals_create", summary: "Make a deal.", needs: "editor", risk: "write",
    input: { type: "object", properties: { title: { type: "string" }, amount: { type: "integer" } }, required: ["title"] },
    run: (i: { title: string; amount?: number }) => { calls.push(i); return { id: 1, ...i }; },
  }),
  defineOp({ name: "org_delete", summary: "Delete the org.", needs: "editor", risk: "danger", input: { type: "object", properties: {} }, run: () => "gone" }),
], (ctx, needs) => rank[ctx.role] >= rank[needs as Ctx["role"]]);

test("ops: one function, every view calls it, and each call re-checks the permission", async () => {
  const viewer = { role: "viewer" } as Ctx, editor = { role: "editor" } as Ctx;
  expect(ops.list(viewer).map((o) => o.name)).toEqual(["deals_list"]);        // hidden, not just refused
  expect(ops.mcpTools(editor).find((t) => t.name === "org_delete")!.annotations.destructiveHint).toBe(true);

  // CLI view: argv decodes to the same call an MCP tool call makes.
  const [name, input] = ops.parseArgv(["deals-create", "--title", "Acme", "--amount", "5"]);
  expect(await ops.call(name, input, editor)).toEqual({ id: 1, title: "Acme", amount: 5 });
  expect(ops.parseArgv(["deals-create", "--json", '{"title":"B"}'])[1]).toEqual({ title: "B" });

  // Auth at the edge is not enough: a view that forgot to check still can't get past call().
  await expect(ops.call("deals_create", { title: "x" }, viewer)).rejects.toMatchObject({ code: "forbidden" });
  await expect(ops.call("deals_create", {}, editor)).rejects.toThrow("title is required");
  await expect(ops.call("deals_create", { title: 1 }, editor)).rejects.toBeInstanceOf(OpError);
  await expect(ops.call("nope", {}, editor)).rejects.toMatchObject({ code: "unknown" });
  expect(calls).toHaveLength(1);

  const skill = ops.skill("crm", viewer, "Drive the CRM.");
  expect(skill).toContain("crm deals-list");
  expect(skill).not.toContain("deals-create");
});
