// Fatty borg (#857): the chunky examples run through build, deploy and teardown, to catch what only
// shows up at size. Pure pieces here (the steps, the guards, the timing/size comparison); fatty.ts at
// the app root runs them. Costs money, so it is on demand and `plan` always comes first.

export type StepKind = "build" | "plan" | "deploy" | "smoke" | "destroy";
export interface Step { kind: StepKind; label: string; cmd?: string[] }
export interface FattyApp {
  name: string;
  dir: string;
  /** Why the app has no edge deploy: it is desktop or box only, or its edge stack can't be a throwaway yet. */
  note: string;
  steps: Step[];
}

const rb = (...a: string[]) => ["bun", "../../packages/cli/src/index.ts", ...a];

const edgeSteps = (): Step[] => [
  { kind: "plan", label: "plan", cmd: rb("plan") },
  { kind: "deploy", label: "deploy", cmd: rb("deploy", "--yes") },
  { kind: "smoke", label: "smoke" },
  { kind: "destroy", label: "destroy", cmd: rb("destroy", "--yes") },
];

export const APPS: FattyApp[] = [
  { name: "codesplitter", dir: "apps/codesplitter", note: "queues, Artifacts, many Durable Objects; edge only", steps: edgeSteps() },
  { name: "park-hide-seek", dir: "apps/park-hide-seek", note: "Durable Objects plus big assets; its box is a Railway service, which bills until destroyed, so only the box build runs", steps: [
    { kind: "build", label: "build desktop", cmd: rb("build", "desktop", "--check") },
    { kind: "build", label: "build box", cmd: rb("build", "box") },
  ] },
  { name: "agent-office", dir: "apps/agent-office", note: "PTYs, so desktop and box only", steps: [{ kind: "build", label: "build desktop", cmd: ["bun", "scripts/rustybunsify.ts", "compile", "--check"] }] },
];

/** Every run deploys under its own stage, `fatty<unix seconds>`, so its resources carry their start time. */
export const fattyStage = (now = Date.now()) => `fatty${Math.floor(now / 1000)}`;

/**
 * Why this app's deploy can't go to a throwaway stage, or null when it can. A config that pins the
 * Worker's name (or adopts) would make a stage take over the live one, and `destroy` would then delete it.
 */
export function deployBlocker(edge: { adopt?: boolean; workerName?: string } | undefined, stages: Record<string, unknown> | undefined, stage: string): string | null {
  if (!edge) return "no edge target";
  if (stages?.[stage]) return null;
  if (edge.adopt || edge.workerName) return `targets.edge pins ${edge.workerName ? `the Worker name "${edge.workerName}"` : "adopt"}, so a throwaway stage would take over the live deploy and destroy would delete it; give the config a stages entry for fatty runs first`;
  return null;
}

/** The artifact paths a `rustybuns build` printed: its "built <path>" lines (one path per line after the first). */
export function builtPaths(output: string): string[] {
  const out: string[] = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^built (\S.*)$/.exec(lines[i]!);
    if (!m) continue;
    out.push(m[1]!.trim());
    while (i + 1 < lines.length && /^[\w./~-]+$/.test(lines[i + 1]!.trim()) && lines[i + 1]!.includes("/")) out.push(lines[++i]!.trim());
  }
  return out;
}

export interface Measure { step: string; ok: boolean; ms: number; bytes: number | null }
export interface Run { at: string; apps: Record<string, Measure[]> }

const fmtBytes = (n: number) => n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtMs = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`;
const delta = (now: number, was: number | undefined, fmt: (n: number) => string) => {
  if (was === undefined || was === 0) return "";
  const p = Math.round(((now - was) / was) * 100);
  return ` (${p >= 0 ? "+" : ""}${p}% on ${fmt(was)})`;
};

/** The grid: each step's timing and size, against the same step in the last run. */
export function formatRun(run: Run, last?: Run | null): string {
  const rows: string[] = [];
  for (const [app, ms] of Object.entries(run.apps)) {
    for (const m of ms) {
      const was = last?.apps[app]?.find((x) => x.step === m.step && x.ok);
      rows.push(`${m.ok ? "✓" : "✗"} ${app.padEnd(18)} ${m.step.padEnd(14)} ${(fmtMs(m.ms) + delta(m.ms, was?.ms, fmtMs)).padEnd(28)}${m.bytes === null ? "" : fmtBytes(m.bytes) + delta(m.bytes, was?.bytes ?? undefined, fmtBytes)}`.trimEnd());
    }
  }
  return rows.join("\n");
}
