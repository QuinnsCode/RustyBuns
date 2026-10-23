import { expect, test } from "bun:test";
import { callDrain, drainFlags } from "../src/drain.ts";

test("--drain-url turns the warning on, with a 30 s grace unless --drain-seconds says otherwise", () => {
  expect(drainFlags(["--yes"])).toEqual({ url: undefined, seconds: 30, rest: ["--yes"] });
  expect(drainFlags(["--drain-url", "https://x.dev/", "--yes", "--drain-seconds=5"])).toEqual({ url: "https://x.dev", seconds: 5, rest: ["--yes"] });
  expect(() => drainFlags(["--drain-url", "x.dev"])).toThrow("origin");
  expect(() => drainFlags(["--drain-seconds", "9000"])).toThrow("0 to 600");
  expect(() => drainFlags(["--drain-url"])).toThrow("needs a value");
});

test("callDrain sends the secret and the grace, and answers null rather than failing the deploy", async () => {
  const seen: [string, RequestInit][] = [];
  const ok = (async (u: string, init: RequestInit) => { seen.push([u, init]); return Response.json({ rooms: 2, drained: 2 }); }) as unknown as typeof fetch;
  expect(await callDrain("https://x.dev", "s", { in: 30 }, ok)).toEqual({ rooms: 2, drained: 2 });
  expect(seen[0]![0]).toBe("https://x.dev/api/admin/drain");
  expect((seen[0]![1].headers as Record<string, string>).authorization).toBe("Bearer s");
  expect(JSON.parse(seen[0]![1].body as string)).toEqual({ in: 30 });
  expect(await callDrain("https://x.dev", "s", { in: 1 }, (async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).toBeNull();
  expect(await callDrain("https://x.dev", "s", { in: 1 }, (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
});
