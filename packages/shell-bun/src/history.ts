// Memory and profile history for a long-lived host, kept across restarts and
// deploys in <data>/history.jsonl. Each start writes a boot line, then the
// memory watch adds a line per sample, each CPU profile its summary, and going
// over the memory ceiling a line of its own before the restart. Read back, the
// lines group into runs (one per boot), so "did the slope go up after that
// deploy?" is one read: the runs side by side, newest first.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Fields } from "@rustybuns/ports";
import { slope, type MemStats } from "./memwatch.ts";
import type { HotFrame, ProfileSummary } from "./profsummary.ts";
import { arr, int, nul, num, obj, oneOf, opt, str, type Guard } from "./guard.ts";

export type HistoryEntry =
  | { at: string; kind: "boot"; pid: number; build?: string }
  | { at: string; kind: "mem"; rssMb: number; heapMb: number }
  | { at: string; kind: "profile"; id: string; reason: string; durationMs: number; samples: number; idlePct: number; self: HotFrame[] }
  | { at: string; kind: "ceiling"; rssMb: number; maxMb: number | null };

export interface HistoryOptions {
  /** The .jsonl file, e.g. `<data>/history.jsonl`. */
  file: string;
  /** Lines kept; older ones are dropped. @default 5000 (17 days of 5-minute samples) */
  keep?: number;
  now?: () => Date;
}

/** Self frames kept per profile: the gist, not the profile. */
const TOP = 5;

export function history(o: HistoryOptions) {
  const keep = o.keep ?? 5000, now = o.now ?? (() => new Date());
  let lines = existsSync(o.file) ? readFileSync(o.file, "utf8").split("\n").filter(Boolean).length : 0;
  const add = (e: Fields) => {
    try {
      mkdirSync(dirname(o.file), { recursive: true });
      appendFileSync(o.file, JSON.stringify({ at: now().toISOString(), ...e }) + "\n");
      // trim in batches, not on every line
      if (++lines > keep + Math.ceil(keep / 5)) {
        const kept = readFileSync(o.file, "utf8").split("\n").filter(Boolean).slice(-keep);
        writeFileSync(o.file, kept.join("\n") + "\n");
        lines = kept.length;
      }
    } catch {}
  };
  return {
    file: o.file,
    /** A start: what follows belongs to this run. `build` names what was deployed. */
    boot: (build?: string) => add({ kind: "boot", pid: process.pid, ...(build ? { build } : {}) }),
    mem: (s: MemStats) => add({ kind: "mem", rssMb: s.rssMb, heapMb: s.heapMb }),
    profile: (id: string, s: ProfileSummary, reason = "asked") =>
      add({ kind: "profile", id, reason, durationMs: s.durationMs, samples: s.samples, idlePct: s.idlePct, self: s.self.slice(0, TOP) }),
    ceiling: (s: MemStats) => add({ kind: "ceiling", rssMb: s.rssMb, maxMb: s.maxMb }),
    read: () => readHistory(o.file),
  };
}

export type History = ReturnType<typeof history>;

/** The entries in `file`, oldest first; a torn last line is skipped. */
export function readHistory(file: string): HistoryEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });
}

export interface Run {
  from: string;
  to: string;
  build?: string;
  /** null for entries from before the first boot line (the file was trimmed). */
  pid: number | null;
  mem: { samples: number; firstMb: number; lastMb: number; peakMb: number; slopeMbPerHour: number | null } | null;
  profiles: Extract<HistoryEntry, { kind: "profile" }>[];
  /** It went over its memory ceiling, at this RSS, and restarted. */
  ceiling: { at: string; rssMb: number; maxMb: number | null } | null;
}

const n0 = num(0, Infinity), text = str(10_000), rate = nul(num(-Infinity, Infinity));
const Frame: Guard<HotFrame> = obj({ fn: text, at: text, ms: n0, pct: n0, stack: opt(arr(text, 10_000)) });
const Profile: Guard<Extract<HistoryEntry, { kind: "profile" }>> = obj({
  at: text, kind: oneOf(["profile"]), id: text, reason: text, durationMs: n0, samples: n0, idlePct: n0, self: arr(Frame, 10_000),
});
const RunShape: Guard<Run> = obj({
  from: text, to: text, build: opt(text), pid: nul(int(0, 2 ** 31)),
  mem: nul(obj({ samples: n0, firstMb: n0, lastMb: n0, peakMb: n0, slopeMbPerHour: rate })),
  profiles: arr(Profile, 100_000),
  ceiling: nul(obj({ at: text, rssMb: n0, maxMb: nul(n0) })),
});
/** What GET /__rb/history answers (without ?text=1): the box's runs, newest first. */
export const HistoryReply = obj({ runs: arr(RunShape, 100_000) });

const round = (n: number) => Math.round(n * 10) / 10;

/** The entries grouped by boot, newest run first. */
export function historyRuns(entries: HistoryEntry[]): Run[] {
  const runs: { boot: Extract<HistoryEntry, { kind: "boot" }> | null; entries: HistoryEntry[] }[] = [];
  for (const e of entries) {
    if (e.kind === "boot" || !runs.length) runs.push({ boot: e.kind === "boot" ? e : null, entries: [] });
    if (e.kind !== "boot") runs.at(-1)!.entries.push(e);
  }
  return runs.map(({ boot, entries: es }) => {
    const mems = es.filter((e) => e.kind === "mem") as Extract<HistoryEntry, { kind: "mem" }>[];
    const s = slope(mems.map((m) => ({ at: Date.parse(m.at), rss: m.rssMb })));
    const ceiling = es.find((e) => e.kind === "ceiling") as Extract<HistoryEntry, { kind: "ceiling" }> | undefined;
    return {
      from: boot?.at ?? es[0]!.at, to: es.at(-1)?.at ?? boot!.at, ...(boot?.build ? { build: boot.build } : {}), pid: boot?.pid ?? null,
      mem: mems.length ? {
        samples: mems.length, firstMb: mems[0]!.rssMb, lastMb: mems.at(-1)!.rssMb, peakMb: Math.max(...mems.map((m) => m.rssMb)),
        slopeMbPerHour: s === null ? null : round(s * 3_600_000),
      } : null,
      profiles: es.filter((e) => e.kind === "profile") as Run["profiles"],
      ceiling: ceiling ? { at: ceiling.at, rssMb: ceiling.rssMb, maxMb: ceiling.maxMb } : null,
    };
  }).reverse();
}

const hours = (r: Run) => round((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

/** The newest `max` runs as text, one block each, newest first. */
export function formatHistory(runs: Run[], max = 5): string {
  if (!runs.length) return "no history yet: the first memory sample lands when the host starts";
  return runs.slice(0, max).map((r, i) => {
    const m = r.mem;
    const head = `${i === 0 ? "this run" : `${i} run${i === 1 ? "" : "s"} back`}: ${r.from.slice(0, 16).replace("T", " ")}Z, ${hours(r)}h` +
      (r.build ? ` · ${r.build}` : "") +
      (m ? ` · rss ${m.firstMb}→${m.lastMb} MB (peak ${m.peakMb}), ${m.slopeMbPerHour === null ? "too few samples for a slope" : `${signed(m.slopeMbPerHour)} MB/h`}` : " · no memory samples") +
      (r.ceiling ? ` · went over the ${r.ceiling.maxMb} MB ceiling at ${r.ceiling.rssMb} MB and restarted` : "");
    const profs = r.profiles.map((p) => `  profile ${p.id} (${p.reason}, ${p.samples} samples, idle ${p.idlePct}%): ` +
      (p.self.length ? p.self.slice(0, 3).map((f) => `${f.fn} ${f.pct}%${f.at ? ` ${f.at}` : ""}`).join(", ") : "nothing ran"));
    return [head, ...profs].join("\n");
  }).join("\n");
}
