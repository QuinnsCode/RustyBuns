import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BREAKER_DEFAULTS, CLOSED, MACHINE_PATCHES, breakerConfig, holdMachine, stepBreaker, type BreakerState } from "../live/breaker.ts";
import { pinnedTest, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(30_000);

/** The ceiling after each second's reading, CPU at `cpu(t)` and memory at `mem(t)` percent. */
function walk(seconds: number, cpu: (t: number) => number, running: number, normal: number | undefined, mem = (_t: number) => 50) {
  const out: (number | null)[] = [];
  let s: BreakerState = CLOSED;
  for (let t = 0; t <= seconds; t++) {
    s = stepBreaker(s, { at: t * 1000, cpu: cpu(t), mem: mem(t) }, running, normal, BREAKER_DEFAULTS);
    out.push(s.ceiling);
  }
  return out;
}

test("the breaker trips on 30 s at 90%, opens by one per 2 cool minutes, and a hot reading restarts the clock", () => {
  const hotUntil = (end: number) => (t: number) => (t < end ? 95 : 40);
  const rows: { name: string; ceilings: (number | null)[]; at: [second: number, ceiling: number | null][] }[] = [
    { name: "a 29 s spike doesn't trip", ceilings: walk(200, hotUntil(29), 5, 12), at: [[28, null], [29, null], [200, null]] },
    { name: "a spike right at 90% for 30 s trips too", ceilings: walk(31, () => 90, 5, 12), at: [[29, null], [30, 5]] },
    { name: "memory alone trips it", ceilings: walk(31, () => 10, 5, 12, () => 96), at: [[30, 5]] },
    // hot 0..39 (tripped at 30), cool from 40: 1:59 later still shut, 2:00 later one more, 2:00 after that another
    { name: "sustained 95% holds at the running count and reopens one at a time", ceilings: walk(400, hotUntil(40), 5, 12),
      at: [[30, 5], [39, 5], [159, 5], [160, 6], [279, 6], [280, 7], [399, 7], [400, 8]] },
    // tripped, cool from 40, one hot second at 100 (under the 30 s trip), cool again from 101: the clock starts at 101
    { name: "a hot reading mid-recovery restarts the 2-minute clock",
      ceilings: walk(230, (t) => (t < 40 || t === 100 ? 95 : 40), 5, 12), at: [[160, 5], [220, 5], [221, 6]] },
    // back to the normal cap, it closes
    { name: "at the normal cap the breaker closes", ceilings: walk(300, hotUntil(40), 5, 6), at: [[159, 5], [160, null], [300, null]] },
    // with no normal cap, a step whose opening nobody used closes it
    { name: "with no cap, an unused step closes it", ceilings: walk(300, hotUntil(40), 5, undefined), at: [[160, 6], [280, null]] },
  ];
  for (const row of rows) for (const [t, want] of row.at) expect([row.name, t, row.ceilings[t]]).toEqual([row.name, t, want]);
});

test("the numbers come from the environment, with the owner's defaults, and the breaker can be turned off", () => {
  expect(breakerConfig({})).toEqual({ at: 90, tripMs: 30_000, reopenMs: 120_000, step: 1 });
  expect(breakerConfig({ AGENT_OFFICE_BREAKER_AT: "80", AGENT_OFFICE_BREAKER_TRIP_S: "60", AGENT_OFFICE_BREAKER_REOPEN_S: "300", AGENT_OFFICE_BREAKER_STEP: "2" }))
    .toEqual({ at: 80, tripMs: 60_000, reopenMs: 300_000, step: 2 });
  expect(breakerConfig({ AGENT_OFFICE_BREAKER_AT: "lots" })?.at).toBe(90);
  expect(breakerConfig({ AGENT_OFFICE_BREAKER: "off" })).toBeNull();
});

pinnedTest("on the office's own Machine and task queue, a hire is turned away while it cools and a queued task starts once it reopens", async () => {
  const pkg = await unpackPinned();
  const srv = path.join(pkg, "dist/server/server");
  const machineJs = path.join(srv, "machine.js");
  let js = readFileSync(machineJs, "utf8");
  for (const [from, to] of MACHINE_PATCHES) {
    expect(js.split(from).length - 1).toBe(1);
    js = js.replace(from, to);
  }
  writeFileSync(machineJs, js);
  // the other targets rustybunsify.ts patches for it are there too, once each
  for (const [file, target] of [["office/services.js", "    machine.start();\n"],
    ["hooks/office-workers.js", "            ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}),\n"],
    ["../../../bin/office-workers.js", "${view?.hiringPaused ? ` · hiring paused: ${view.hiringPaused}` : ''}`"]]) {
    expect([file, readFileSync(path.resolve(srv, file!), "utf8").split(target!).length - 1]).toEqual([file, 1]);
  }

  const { Machine } = await import(machineJs);
  const { TaskQueue } = await import(path.join(srv, "queue.js"));
  const data = mkdtempSync(path.join(tmpdir(), "rb-breaker-"));

  // three workers hired by hand, and whoever the queue seats
  const seated: { id: string; name: string; status: string; viewers: never[] }[] = [];
  const desks = new Set<string>();
  const workers = {
    defaultProvider: "claude", officeDefault: { provider: "claude" },
    list: () => seated, deskOccupied: (id: string) => desks.has(id), wing: () => 0,
    spawn: (desk: string) => {
      const w = { id: `w${seated.length}`, name: `Worker ${seated.length}`, status: "working", viewers: [] };
      desks.add(desk);
      seated.push(w);
      return w;
    },
    kill: async () => ({}),
  };
  const machine = new Machine(data, 12, () => 3 + seated.length, () => {});
  const queue = new TaskQueue(data, workers, false, {
    hiringPaused: () => undefined, room: () => machine.room(), toast: () => {}, update: () => {}, emptied: () => {},
    refreshGitHub: () => {}, claimIssue: async () => undefined, worktreeNote: () => "",
  });
  let now = 0;
  holdMachine(machine, () => queue.pump(), BREAKER_DEFAULTS, () => now, 100);
  // the fake sampler: memory in percent of 100, a reading every 5 s through the patched sample hook
  const reading = (cpu: number) => {
    now += 5000;
    machine.cpu = cpu;
    machine.memUsed = 50;
    machine.__rbSampled(true);
  };
  try {
    for (let i = 0; i <= 6; i++) reading(95);
    expect(machine.limit).toBe(3);
    expect(machine.full()).toBe("The office is cooling down: CPU 95% (2 min under 90% to reopen), 3 of 12 workers for now");
    expect(machine.state()).toMatchObject({ limit: 3, normal: 12, workers: 3 });

    expect(queue.add("Fix the flaky test", "owner")).toBeUndefined();
    queue.pump();
    expect(queue.state().tasks.map((t: { status: string }) => t.status)).toEqual(["queued"]);

    // cool from here: 23 readings (1:55) keep it shut, the 25th (2:00) opens one and the queue seats its task
    for (let i = 0; i < 24; i++) reading(40);
    expect(machine.full()).toMatch(/^The office is cooling down: CPU 40%, memory 50% \(5 s under 90% to reopen\)/);
    expect(seated).toHaveLength(0);
    reading(40);
    expect(machine.limit).toBe(4);
    expect(queue.state().tasks.map((t: { status: string }) => t.status)).toEqual(["running"]);
    expect(seated).toHaveLength(1);
    // full again at the new ceiling, and still cooling
    expect(machine.full()).toMatch(/cooling down.*4 of 12 workers for now$/);
  } finally {
    queue.shutdown();
  }
});
