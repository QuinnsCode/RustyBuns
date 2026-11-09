// The deploy gives eqosys.qntbr.com its exact route `<domain>/*` (#4006). On the owner's zones that
// route was already there from a hand-made or old wrangler setup, and Cloudflare's 409 stopped the
// deploy. Alchemy's route step (patched in patches/@alchemy.run%2Fcloudflare@2.0.0-beta.84.patch)
// now adopts a route that runs this Worker or none, and names the Worker otherwise.
import { describe, expect, test } from "bun:test";
import { attachWorkerRoute, type WorkerRouteApi } from "@alchemy.run/cloudflare/Workers";
import * as Effect from "effect/Effect";

const route = { pattern: "eqosys.qntbr.com/*", zoneId: "zone" };
type Row = { id: string; pattern: string; script?: string | null };

/** A zone whose listing shows `listed` (or fails), and whose create answers `create`. */
function zone(listed: Row[] | "fails", create: "ok" | "conflict", after: Row[] = []) {
  const calls: string[] = [];
  let lists = 0;
  const api = {
    // Lazy like the real client: each run of the Effect is a fresh request.
    listRoutes: () =>
      Effect.suspend(() => {
        calls.push("list");
        const rows = lists++ === 0 ? listed : after;
        return rows === "fails" ? Effect.fail({ _tag: "Forbidden" }) : Effect.succeed({ result: rows });
      }),
    createRoute: (req: { pattern: string }) => {
      calls.push("create");
      return create === "ok"
        ? Effect.succeed({ id: "new", pattern: req.pattern })
        : Effect.fail({ _tag: "Conflict", message: "A route with the same pattern already exists." });
    },
    updateRoute: (req: { routeId: string; pattern: string; script?: string }) => {
      calls.push(`update ${req.routeId} -> ${req.script}`);
      return Effect.succeed({ id: req.routeId, pattern: req.pattern, script: req.script });
    },
  } as unknown as WorkerRouteApi;
  return { api, calls };
}

describe("a deploy meets the exact route already on the zone", () => {
  test.each([
    ["on this Worker: adopted as it is", zone([{ id: "r1", ...route, script: "eqosys" }], "conflict"), "r1", ["list"]],
    ["on no Worker: pointed at this one", zone([{ id: "r1", ...route, script: null }], "conflict"), "r1", ["list", "update r1 -> eqosys"]],
    ["missed by the listing, 409 on create: adopted on the re-list", zone("fails", "conflict", [{ id: "r1", ...route, script: "eqosys" }]), "r1", ["list", "create", "list"]],
    ["not there: created", zone([], "ok"), "new", ["list", "create"]],
  ] as const)("%s", async (_, { api, calls }, id, expected) => {
    const attached = await Effect.runPromise(attachWorkerRoute<never>(route, "eqosys", api));
    expect(attached).toMatchObject({ id, pattern: route.pattern, zoneId: "zone" });
    expect(calls).toEqual([...expected]);
  });

  test("on another Worker: the deploy stops and says which one and how to move it", async () => {
    const { api } = zone([{ id: "r1", ...route, script: "old-eqosys" }], "conflict");
    const exit = await Effect.runPromiseExit(attachWorkerRoute<never>(route, "eqosys", api));
    expect(String(exit)).toContain("it already runs Worker 'old-eqosys'");
    expect(String(exit)).toContain("Workers Routes");
  });
});
