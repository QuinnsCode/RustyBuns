import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { dedupe, forecast, loadEngine, splitRows, stale, waveFrame } from "../src/engine.ts";

setDefaultTimeout(30_000);

const palette = { sky: 0x7cc4ff, navy: 0x0b1f3a, cream: 0xf4eee2 };

describe("wave_frame", () => {
  test("fills every block, moves with t and loops every 12 s", async () => {
    const e = await loadEngine();
    const [w, h] = [128, 64];
    const a = new Uint8Array(w * h * 4);
    waveFrame(e, a, w, h, 0, 8, palette);
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] !== 255) throw new Error(`zero alpha at pixel ${(i - 3) / 4}`);
    }
    const b = new Uint8Array(w * h * 4);
    waveFrame(e, b, w, h, 3, 8, palette);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
    const c = new Uint8Array(w * h * 4);
    waveFrame(e, c, w, h, 15, 8, palette);
    expect(Buffer.compare(Buffer.from(b), Buffer.from(c))).toBe(0);
  });

  test("one 1280x400 frame at pixel=8 is quick", async () => {
    const e = await loadEngine();
    const buf = new Uint8Array(1280 * 400 * 4);
    waveFrame(e, buf, 1280, 400, 1, 8, palette); // warm up
    const n = 10;
    const start = performance.now();
    for (let i = 0; i < n; i++) waveFrame(e, buf, 1280, 400, 1 + i * 0.1, 8, palette);
    const ms = (performance.now() - start) / n;
    console.log(`wave_frame 1280x400 pixel=8: ${ms.toFixed(2)} ms/frame`);
    expect(ms).toBeLessThan(20);
  });
});

describe("analysis", () => {
  test("dedupe pairs the same person under two emails at one company", async () => {
    const pairs = await dedupe([
      { id: 1, first_name: "Jon", last_name: "Smith", email: "jon.smith@acme.com", company_id: "acme" },
      { id: 2, first_name: "Jon", last_name: "Smith", email: "jsmith@acme.com", company_id: "acme" },
      { id: 3, first_name: "Priya", last_name: "Natarajan", email: "priya@globex.io", company_id: "globex", phone: null },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 1, b: 2 });
    expect(pairs[0]!.score).toBeGreaterThanOrEqual(0.5);
    expect(pairs[0]!.score).toBeLessThanOrEqual(1);
    expect(pairs[0]!.why).toContain("same last name and company");
  });

  test("dedupe across workers finds the same pairs as one thread", async () => {
    const rows = Array.from({ length: 1600 }, (_, i) => ({
      id: i, first_name: `Name${i % 800}`, last_name: `Last${i % 800}`, email: `p${i % 800}@x${i % 7}.com`, company_id: `c${i % 40}`,
    }));
    const one = await dedupe(rows, 1);
    const many = await dedupe(rows, 4);
    expect(one.length).toBeGreaterThan(700);
    const key = (p: { a: unknown; b: unknown }) => `${p.a}-${p.b}`;
    expect(many.map(key).sort()).toEqual(one.map(key).sort());
  }, 60_000);

  test("splitRows covers every row once, in near-equal pair shares", () => {
    const parts = splitRows(10_000, 8);
    expect(parts[0]![0]).toBe(0);
    expect(parts.at(-1)![1]).toBe(10_000);
    parts.forEach(([, end], i) => { if (i) expect(parts[i - 1]![1]).toBe(parts[i]![0]); });
    const pairs = parts.map(([a, b]) => { let t = 0; for (let r = a; r < b; r++) t += 10_000 - r - 1; return t; });
    expect(Math.max(...pairs) / Math.min(...pairs)).toBeLessThan(1.05);
  });

  test("forecast weights a proposal at 60% and buckets it by close month", async () => {
    const now = Date.UTC(2026, 9, 16);
    const f = await forecast([
      { id: "d1", name: "Big one", stage: "proposal", amount_cents: 100_000, close_at: Date.UTC(2026, 10, 3) },
      { id: "d2", name: "Maybe", stage: "lead", amount_cents: 50_000, close_at: null },
      { id: "d3", name: "Done", stage: "won", amount_cents: 999 },
    ], now);
    const proposal = f.stages.find((s) => s.stage === "proposal")!;
    expect(proposal.weighted_cents).toBe(60_000);
    expect(f.months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(f.months[1]!.weighted_cents).toBe(60_000);
    expect(f.unscheduled_weighted_cents).toBe(5_000);
    expect(f.total_weighted_cents).toBe(65_000);
  });

  test("stale lists untouched open deals, oldest first", async () => {
    const day = 86_400_000;
    const now = Date.UTC(2026, 9, 16);
    const rows = await stale(
      [
        { id: 1, name: "Fresh", stage: "qualified", updated_at: now - 40 * day },
        { id: 2, name: "Old", stage: "lead", updated_at: now - 30 * day },
        { id: 3, name: "Older", stage: "lead", updated_at: "2026-01-05" },
        { id: 4, name: "Closed", stage: "lost", updated_at: now - 90 * day },
      ],
      [{ id: "a", deal_id: 1, at: now - 2 * day, type: "call" }],
      now,
      14,
    );
    expect(rows.map((r) => r.id)).toEqual([3, 2]);
    expect(rows[1]!.days_idle).toBe(30);
  });
});

describe("dedupe at scale", () => {
  test("2,000 contacts dedupe fast and still find the planted pairs", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      first_name: `F${i}x`,
      last_name: `L${i}y`,
      email: `person${i}@co${i % 50}.com`,
      phone: `55501${String(10000 + i).padStart(5, "0")}`,
      company_id: `c${i % 50}`,
    }));
    rows[1500] = { ...rows[1500]!, email: "person7+x@other.com" };
    await dedupe(rows.slice(0, 5)); // warm up
    const start = performance.now();
    const pairs = await dedupe(rows);
    const ms = performance.now() - start;
    console.log(`dedupe 2,000 contacts: ${ms.toFixed(0)} ms`);
    expect(pairs.some((p) => p.a === 7 && p.b === 1500)).toBe(true);
    expect(ms).toBeLessThan(400);
  });
});
