import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { dedupe, forecast, loadEngine, nameIndex, splitRows, stale, waveFrame } from "../src/engine.ts";

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

describe("nameIndex", () => {
  test("finds the person you meant while you type", async () => {
    const ix = await nameIndex([
      { id: 1, first_name: "John", last_name: "Smith", email: "john.smith@acme.com" },
      { id: 2, first_name: "Priya", last_name: "Natarajan", email: "pnatarajan@globex.io" },
      { id: 3, first_name: "María", last_name: "González" },
      { id: 4, email: "kwame.mensah@acme.com" },
      { id: "c1", name: "Globex Corporation" },
      { id: 5, first_name: "Jane", last_name: "Doe" },
      { id: 6, first_name: "Ana", last_name: "Lee", email: "ana@initech.com" },
    ]);
    expect(ix.size).toBe(7);
    const cases: [query: string, want: string | number | undefined][] = [
      ["Jhon Smtih", 1], // typos
      ["Smith John", 1], // last name first
      ["Jon Smyth", 1], // spelled the other way
      ["joh smi", 1], // half typed
      ["pnatarajan@globex.io", 2], // pasted an email
      ["maria gonzalez", 3], // no accents on the keyboard
      ["Kwame Mensah", 4], // only the email knows the name
      ["globex", "c1"], // a company
      ["Zebulon Quackenbush", undefined], // nobody like that
    ];
    for (const [q, want] of cases) {
      const hits = ix.search(q, 5);
      expect({ q, top: hits[0]?.id }).toEqual({ q, top: want });
      for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(0.6);
    }
    expect(ix.search("Jhon Smtih")[0]).toMatchObject({ id: 1, name: "John Smith" });
    ix.free();
  });

  test("100,000 rows: the right one comes back first", async () => {
    // Seeded made-up names, so the corpus is dense with near misses but the planted one is unique.
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32;
    const on = ["b", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z", "br", "ch", "sh", "tr"];
    const nu = ["a", "e", "i", "o", "u", "ai", "ou"];
    const word = () => {
      let w = "";
      for (let n = 2 + Math.floor(rand() * 2); n > 0; n--) w += on[Math.floor(rand() * on.length)]! + nu[Math.floor(rand() * nu.length)]!;
      return w[0]!.toUpperCase() + w.slice(1);
    };
    const rows = Array.from({ length: 100_000 }, (_, i) => {
      const [first, last] = [word(), word()];
      return { id: i, first_name: first, last_name: last, email: i % 2 ? `${first}.${last}@example.com`.toLowerCase() : null };
    });
    rows[73_421] = { id: 73_421, first_name: "Priya", last_name: "Natarajan", email: "priya.n@globex.io" };
    await loadEngine();
    let start = performance.now();
    const ix = await nameIndex(rows);
    const buildMs = performance.now() - start;
    const queries = ["Prya Natarajn", "natarajan priya", "pri nat", "priya.n@globex.io"];
    for (const q of queries) expect({ q, top: ix.search(q)[0]?.id }).toEqual({ q, top: 73_421 });
    start = performance.now();
    for (let i = 0; i < 20; i++) ix.search(queries[i % queries.length]!);
    const searchMs = (performance.now() - start) / 20;
    console.log(`nameIndex 100,000 rows: build ${buildMs.toFixed(0)} ms, search ${searchMs.toFixed(2)} ms`);
    ix.free();
  });
});
