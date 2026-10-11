import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { renderPulseCard } from "../src/card.ts";
import { HOURS, spread } from "../src/pulse.ts";

// End to end (in-process D1 and file DOs), like insights.test.ts. The pulse reads the feed's line events.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (user: string | null, url: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
    call(user, url, { method, ...(body !== undefined && { body: JSON.stringify(body) }) });
  for (const u of ["ryan", "mia"]) await send(u, "/api/login", { name: u });
  const pulse = async (viewer: string | null, name: string) => {
    const res = await send(viewer, `/api/users/${name}/pulse`);
    return { status: res.status, ...((await res.json()) as any) };
  };
  return { call, send, pulse };
}

/** The file DOs write line events just after an edit answers: wait for them. */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 60; i++) { if (await check()) return; await Bun.sleep(100); }
  throw new Error("the pulse never beat");
}

describe("pulse", () => {
  test("counts lines landed per hour; private repos only on your own; you can turn it off", async () => {
    const { send, pulse } = await app();
    await send("ryan", "/api/repos", { name: "lab" });
    await send("ryan", "/api/repos", { name: "vault", visibility: "private" });
    await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo\nthree" });
    await send("ryan", "/api/repos/ryan/vault/files", { path: "b.ts", content: "secret\nsauce" });
    await until(async () => (await pulse("ryan", "ryan")).total === 5);

    const own = await pulse("ryan", "ryan");
    expect(own.hours).toHaveLength(HOURS);
    expect(own.hours.at(-1)).toBe(5);
    expect(Date.now() - own.live_at).toBeLessThan(60_000);
    // Everyone else sees the public repo's lines only.
    expect((await pulse("mia", "ryan")).total).toBe(3);
    expect((await pulse(null, "ryan")).total).toBe(3);

    // A delete isn't a line landed; a change is.
    const file = (await (await send("ryan", "/api/repos/ryan/lab/do/file?path=a.ts")).json()) as any;
    const [l1, l2] = file.lines;
    await send("ryan", "/api/repos/ryan/lab/do/ops?path=a.ts", { ops: [{ kind: "set", line: l1.id, text: "uno", base: l1.rev }, { kind: "delete", line: l2.id, base: l2.rev }] });
    await until(async () => (await pulse("mia", "ryan")).total === 4);

    // A repo going private takes its lines out of the public pulse.
    await send("ryan", "/api/repos/ryan/lab", { visibility: "private" }, "PUT");
    expect((await pulse("mia", "ryan")).total).toBe(0);
    expect((await pulse("ryan", "ryan")).total).toBe(6);
    await send("ryan", "/api/repos/ryan/lab", { visibility: "public" }, "PUT");

    // Many at once, for a crew list. An agent has no profile row: its pulse is public, quiet until it writes.
    const many = (await (await send(null, "/api/pulse?names=ryan,agent-linter,mia")).json()) as any;
    expect(many.pulses.map((p: any) => [p.name, p.total])).toEqual([["ryan", 4], ["agent-linter", 0], ["mia", 0]]);

    // The card and the share page.
    const png = await send(null, "/api/users/ryan/pulse.png");
    expect(png.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await png.arrayBuffer()).slice(1, 4)]).toEqual([80, 78, 71]);
    const share = await (await send(null, "/api/users/ryan/share")).text();
    expect(share).toContain('property="og:image" content="http');
    expect(share).toContain("/api/users/ryan/pulse.png");
    expect(share).toContain("4 lines landed this week");

    // Off: only ryan sees it, and the bio stays put (only what's sent changes).
    await send("ryan", "/api/me", { bio: "digging" }, "PUT");
    const me = (await (await send("ryan", "/api/me", { pulse: false }, "PUT")).json()) as any;
    expect(me).toMatchObject({ bio: "digging", pulse: 0 });
    expect((await pulse("mia", "ryan")).status).toBe(404);
    expect((await send(null, "/api/users/ryan/pulse.png")).status).toBe(404);
    expect(await (await send(null, "/api/users/ryan/share")).text()).not.toContain("og:image");
    expect(((await (await send("mia", "/api/pulse?names=ryan")).json()) as any).pulses).toEqual([]);
    expect((await pulse("ryan", "ryan")).total).toBe(6);
    expect((await send("ryan", "/api/me", { pulse: "no" }, "PUT")).status).toBe(400);

  });
});

describe("spread", () => {
  const H = 3_600_000;
  test("a stretch of work spreads over the hours it spans; only the week's share counts", () => {
    const hours = new Array(4).fill(0);
    spread(hours, 0, 0, 30 * 60_000, 5);           // within the first hour
    spread(hours, 0, H + 1, 3 * H + 5, 10);        // hours 1 to 3
    expect(hours).toEqual([5, 3, 3, 4]);
    const week = new Array(2).fill(0);
    spread(week, 2 * H, 0, 3 * H + 1, 8);          // four hours, two of them before the week
    expect(week).toEqual([2, 2]);
  });
});

describe("pulse card", () => {
  test("draws a week of bars as a PNG", async () => {
    const hours = Array.from({ length: HOURS }, (_, i) => (i % 9 === 0 ? i : 0));
    const png = await renderPulseCard({ title: "@ryan's pulse", hours, from: 0, status: "lots landed this week" });
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
