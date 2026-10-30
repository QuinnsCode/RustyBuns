// What the iOS app asks the edge for besides /ws: the ground to draw, and a report against a player.
import { expect, test } from "bun:test";
import { PROTOCOL, ZoneReply } from "../src/api.ts";
import { check } from "@rustybuns/util/guard";
import worker from "../src/edge/worker.ts";

const SITE = "https://park-hide-seek.notryanquinn.workers.dev";
const env = { ASSETS: { fetch: async () => new Response("page") }, WORLD: {}, MATCH: {}, PARKS: {} } as never;
const get = (path: string, init?: RequestInit) => worker.fetch(new Request(`${SITE}${path}${path.includes("?") ? "&" : "?"}pv=${PROTOCOL}`, init), env);

test("a zone's ground comes with its props, as the guard the app's decoder mirrors", async () => {
  const res = await get("/api/zone?id=el-capitan");
  expect(res.status).toBe(200);
  const zone = check(ZoneReply, await res.json());
  expect(zone).not.toBeNull();
  expect(zone!.props.length).toBeGreaterThan(100);
  expect(atob(zone!.heights).length).toBe(zone!.n * zone!.n * 2);
  expect(zone!.props.some((p) => p.kind === "cabin")).toBe(true);
});

test("an id that isn't a zone is a 404", async () => {
  expect((await get("/api/zone?id=nowhere")).status).toBe(404);
});

test("a report names a room, a player and a reason; anything else is refused", async () => {
  const ok = "uid=player-one-uid&room=PIKA&player=0123456789abcdef&reason=name";
  expect((await get(`/api/report?${ok}`, { method: "POST" })).status).toBe(204);
  expect((await get(`/api/report?${ok}`)).status).toBe(405);
  expect((await get(`/api/report?${ok.replace("name", "boredom")}`, { method: "POST" })).status).toBe(400);
  expect((await get(`/api/report?${ok.replace("0123456789abcdef", "x")}`, { method: "POST" })).status).toBe(400);
});
