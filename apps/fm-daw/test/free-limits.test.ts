// A free DJ's monthly allowance and one-set-at-a-time, as the Lobby counts them (src/lobby.ts): sets that ended
// earlier, then one more going live. Times come in the requests (Listen's clock), so each row sets its own month.
import { expect, test } from "bun:test";
import Lobby, { HOUR_MS, LIVE_SLACK_MS, type LiveReply, type UsageRecord } from "../src/lobby.ts";

const DJ = "d".repeat(64), OTHER = "e".repeat(64), IP = "1".repeat(64), IP2 = "2".repeat(64);
const NOV = Date.UTC(2026, 10, 10, 12), SET = 4 * HOUR_MS;
type Past = { dj: string; ip: string; hours: number; at: number };

async function lobby() {
  const store = new Map<string, unknown>();
  let gate: Promise<void> = Promise.resolve();
  const l = new Lobby({
    storage: {
      get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); }, delete: async (k) => store.delete(k),
      list: async <T,>(o: { prefix: string }) => new Map([...store].filter(([k]) => k.startsWith(o.prefix)).map(([k, v]) => [k, v as T])),
    },
    blockConcurrencyWhile: (f) => { gate = f(); },
  }, { FREE_SET_HOURS: "16" });
  await gate;
  const post = (path: string, body: unknown) => l.fetch(new Request(`https://lobby${path}`, { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
  return {
    live: (dj: string, ip: string, set: string, at: number): Promise<LiveReply> => post("/live", { dj, ip, set, at, setMs: SET }),
    ended: (p: Past, set = "past000000") => {
      const rec: UsageRecord = { at: p.at, hours: p.hours, peakEars: 3, chunks: 10, endedBy: "dj" };
      return post("/ended", { dj: p.dj, ip: p.ip, set, rec });
    },
  };
}

test.each<[string, Past[], { dj: string; ip: string; at: number }, Partial<LiveReply> & { endIn?: number }]>([
  ["a new DJ gets a whole set", [], { dj: DJ, ip: IP, at: NOV }, { ok: true, endWhy: "hours", n: 4, endIn: SET }],
  ["13 hours used: the set ends when the month's 3 left run out", [{ dj: DJ, ip: IP, hours: 13, at: NOV - HOUR_MS * 24 }], { dj: DJ, ip: IP, at: NOV }, { ok: true, endWhy: "month", n: 16, endIn: 3 * HOUR_MS }],
  ["16 hours used across sets: no more this month", [{ dj: DJ, ip: IP, hours: 10, at: NOV - 1 }, { dj: DJ, ip: IP, hours: 6, at: NOV - 2 }], { dj: DJ, ip: IP, at: NOV }, { ok: false, why: "month", n: 16 }],
  ["a new DJ key from an address that used its 16", [{ dj: OTHER, ip: IP, hours: 16, at: NOV - 1 }], { dj: DJ, ip: IP, at: NOV }, { ok: false, why: "month" }],
  ["the same DJ key from a new address", [{ dj: DJ, ip: IP2, hours: 16, at: NOV - 1 }], { dj: DJ, ip: IP, at: NOV }, { ok: false, why: "month" }],
  ["last month's hours don't count on the 1st (UTC)", [{ dj: DJ, ip: IP, hours: 16, at: Date.UTC(2026, 9, 31, 23) }], { dj: DJ, ip: IP, at: Date.UTC(2026, 10, 1, 0, 30) }, { ok: true, endWhy: "hours" }],
])("%s", async (_, past, go, want) => {
  const l = await lobby();
  for (const p of past) await l.ended(p);
  const { endIn, ...rest } = want;
  const got = await l.live(go.dj, go.ip, "nowset0000", go.at);
  expect(got).toMatchObject(rest);
  if (endIn !== undefined) expect(got.endAt).toBe(go.at + endIn);
});

test("one live set per DJ key: a second link waits for the first to end, or for its lease to run out after a crash", async () => {
  const l = await lobby();
  expect(await l.live(DJ, IP, "aaaaaaaaaa", NOV)).toMatchObject({ ok: true });
  expect(await l.live(DJ, IP, "aaaaaaaaaa", NOV + 60_000)).toMatchObject({ ok: true });       // the same link back: still its set
  expect(await l.live(DJ, IP, "bbbbbbbbbb", NOV + 60_000)).toMatchObject({ ok: false, why: "one" });
  await l.ended({ dj: DJ, ip: IP, hours: 1, at: NOV + HOUR_MS }, "aaaaaaaaaa");
  expect(await l.live(DJ, IP, "bbbbbbbbbb", NOV + HOUR_MS)).toMatchObject({ ok: true });
  // b's Durable Object crashes and never checks out: its lease frees the DJ a little after its planned end
  expect(await l.live(DJ, IP, "cccccccccc", NOV + HOUR_MS + SET)).toMatchObject({ ok: false, why: "one" });
  expect(await l.live(DJ, IP, "cccccccccc", NOV + HOUR_MS + SET + LIVE_SLACK_MS)).toMatchObject({ ok: true });
});

test("sets live at once from one address share its month, and one that ends early gives back what it didn't run", async () => {
  const l = await lobby();
  await l.ended({ dj: "f".repeat(64), ip: IP, hours: 10, at: NOV - 1 });
  expect(await l.live(DJ, IP, "set-one000", NOV)).toMatchObject({ ok: true, endAt: NOV + SET });
  // a second key at the same moment: 6 left, 4 held by the first
  expect(await l.live(OTHER, IP, "set-two000", NOV)).toMatchObject({ ok: true, endAt: NOV + 2 * HOUR_MS, endWhy: "month" });
  const third = "a".repeat(64);
  expect(await l.live(third, IP, "set-three0", NOV)).toMatchObject({ ok: false, why: "month" });
  // the first stops after an hour: 11 used, 2 held, 3 free
  await l.ended({ dj: DJ, ip: IP, hours: 1, at: NOV + HOUR_MS }, "set-one000");
  expect(await l.live(third, IP, "set-three0", NOV + HOUR_MS)).toMatchObject({ ok: true, endAt: NOV + 4 * HOUR_MS });
});
