// Battles online: the Worker in front of a room's Durable Object decides who a player is, and a
// big repo's setup still fits in one message to the world.
import { describe, expect, test } from "bun:test";
import worker from "../src/edge/worker.ts";
import { EXCERPT_FILES, EXCERPT_LINES, EXCERPT_WIDTH, MAX_FILES } from "../src/sim/intel.ts";
import { cleanSetup } from "../src/net/room.ts";
import type { Setup } from "../src/net/wire.ts";

function edge() {
  const seen: { room: unknown; req: Request }[] = [];
  const env = {
    ASSETS: { fetch: async () => new Response("page") },
    WORLD: {
      idFromName: (n: string) => n,
      get: (room: unknown) => ({ fetch: async (req: Request) => (seen.push({ room, req }), new Response("world")) }),
    },
  };
  const ws = (q: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://git-recon.example/ws?${q}`, { headers: { Upgrade: "websocket", ...headers } }), env);
  return { env, seen, ws };
}

describe("the edge Worker", () => {
  test("vouches the player itself, whatever identity headers the client sent", async () => {
    const { seen, ws } = edge();
    const res = await ws("room=k7qx2m&uid=player-one-123&name=Ada%00", { "X-User-Id": "someone-else", "X-RB-Principal": "host", "X-User-Name": "Mallory" });
    expect(await res.text()).toBe("world");
    const { room, req } = seen[0]!;
    expect(room).toBe("K7QX2M");
    expect(req.headers.get("X-User-Id")).toBe("player-one-123");
    expect(req.headers.get("X-User-Name")).toBe("Ada");
    expect(req.headers.get("X-RB-Principal")).toBe("guest");
  });

  test("turns away a bad room code, a bad player id, another site, and plain HTTP", async () => {
    const { seen, ws, env } = edge();
    expect((await ws("room=no&uid=player-one-123")).status).toBe(400);
    expect((await ws("room=ABCD&uid=x")).status).toBe(400);
    expect((await ws("room=ABCD&uid=player-one-123", { Origin: "https://evil.example" })).status).toBe(403);
    expect((await worker.fetch(new Request("https://git-recon.example/ws?room=ABCD&uid=player-one-123"), env)).status).toBe(426);
    expect(seen).toHaveLength(0);
  });

  test("tells the page it's online, and serves the page otherwise", async () => {
    const { env } = edge();
    expect(await (await worker.fetch(new Request("https://git-recon.example/__rb/info"), env)).json()).toMatchObject({ online: true });
    expect(await (await worker.fetch(new Request("https://git-recon.example/"), env)).text()).toBe("page");
  });

});

test("the biggest setup a repo load makes fits in one message to the world", () => {
  // MAX_FILES files with long paths, plus the excerpts the ground is printed with.
  const files = Array.from({ length: MAX_FILES }, (_, i) => ({ path: `packages/some-long-package-name/src/deeply/nested/folder/${"x".repeat(120)}-${i}.ts`, lines: 5000, churn: 9, agent: 0.33 }));
  const text = Array.from({ length: EXCERPT_FILES }, (_, i) => ({ path: `src/${i}.ts`, lines: Array.from({ length: EXCERPT_LINES }, () => "y".repeat(EXCERPT_WIDTH)) }));
  const setup = cleanSetup({ level: "backyard", mode: "ffa", repo: { name: "o/r", ref: "abc1234", files, text, links: [], failing: [] } }) as Setup;
  expect(setup).not.toBeNull();
  expect(JSON.stringify({ t: "setup", setup }).length).toBeLessThan(250_000);
});
