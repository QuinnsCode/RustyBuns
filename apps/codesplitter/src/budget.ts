// Layout: agent budgets (#1077): what a run reads, when it's cut short, and the caveman-terse note fresh eyes start from
// Agents get worse per dollar as their context grows: every run of the CLI reads the prompt and the
// files again, and a long session drifts. So a run has a budget, from its path's policy (policy.ts),
// and is cut short before it grinds on: past the budget, the same failure twice, or a third round of
// conflicts. What it did and what's left go in a short, blunt note, and the next agent (agent-routes.ts)
// starts from that note and nothing else: a fresh one, a cheaper model, or a person, as the policy says.
// What a run read comes from the CLI's own usage where it reports it (claude's JSON answer, #1088);
// the others' is counted from what went in and came out of them: four characters to the token.

import type { Over } from "./policy.ts";

/** Characters to a token, near enough for a budget. */
const CHARS_PER_TOKEN = 4;
/** About how many tokens `chars` characters are. */
export const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/**
 * What a CLI asked for JSON said it read and wrote, and its reply: claude's answer is one
 * `{"type":"result",...}` line, whose usage counts the cache it read and wrote as well as fresh
 * input and output. Null when the output holds no such line (another harness, or a crash), so
 * the run is counted by characters instead. Stderr comes after it, so the last one wins.
 */
export function usageOf(out: string): { reply: string; tokens: number } | null {
  for (const line of out.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const r = JSON.parse(line) as { type?: string; result?: unknown; usage?: Record<string, unknown> };
      if (r.type !== "result" || !r.usage) continue;
      const n = (k: string) => typeof r.usage![k] === "number" ? r.usage![k] as number : 0;
      return { reply: typeof r.result === "string" ? r.result : "", tokens: n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens") };
    } catch { /* not JSON: a line of the CLI's chatter */ }
  }
  return null;
}

/** The conflict round that goes to fresh eyes instead: the third. */
export const CONFLICT_ROUNDS = 3;
/** Handoffs one task makes before a person gets it, whatever its policy says. */
export const HANDOFFS = 2;

/** A run's budget: how many tokens it may read, and what happens past them. */
export interface Budget { tokens: number; over: Over }
/** Why a run was cut short, and how much it had read by then. */
export interface Trip { at: number; why: string }

/**
 * A failure as text to compare: two runs of the same failing test differ in times, durations,
 * addresses and colours, so those go, and so does the spacing.
 */
export const failureKey = (s: string) => s
  .replace(/\x1b\[[0-9;]*m/g, "")
  .replace(/\d{4}-\d\d-\d\d[T ][\d:.]+Z?/g, "")
  .replace(/\b0x[0-9a-f]+\b/gi, "")
  .replace(/\[?\b\d+(?:\.\d+)?\s?(?:ms|s|m)\b\]?/g, "")
  .replace(/\s+/g, " ").trim();

/** The same failure as before: the same test, or the same error text. */
export const sameFailure = (a: string | undefined, b: string | undefined) => !!a?.trim() && !!b?.trim() && failureKey(a) === failureKey(b);

/**
 * Whether a run should stop before going round again, and why: past its budget, failing the
 * same way as last round, or about to start its third round of conflicts. Null: go on.
 */
export function tripped(m: { spent: number; budget: number; failures?: string[]; conflictRounds?: number }): string | null {
  if (m.spent >= m.budget) return `context past ${short(m.budget)} tokens`;
  const f = m.failures ?? [];
  if (f.length >= 2 && sameFailure(f.at(-1), f.at(-2))) return "same failure twice";
  if ((m.conflictRounds ?? 0) >= CONFLICT_ROUNDS - 1) return `a ${ordinal(CONFLICT_ROUNDS)} conflict round`;
  return null;
}

export const short = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
const ordinal = (n: number) => ["zeroth", "first", "second", "third", "fourth"][n] ?? `${n}th`;

/** The four lines of a handoff note. Each says one thing, as few words as it takes. */
export interface Note { done: string[]; next: string[]; broke: string[]; dont: string[] }
const KEYS = ["done", "next", "broke", "dont"] as const;
/** How long one line of a note may get. */
const LINE_CHARS = 300;

/** The note as the next agent reads it: `DONE: x, y` and so on, a line left out when there's nothing on it. */
export function writeNote(n: Partial<Note>): string {
  return KEYS.flatMap((k) => n[k]?.length ? [`${k.toUpperCase()}: ${n[k]!.join(", ").replace(/\s+/g, " ").trim().slice(0, LINE_CHARS)}`] : []).join("\n");
}

/** The note lines an agent left at the end of its reply, as the prompt asks of one that can't finish: the last of each kind wins. */
export function readNote(output: string): Partial<Note> {
  const out: Partial<Note> = {};
  for (const line of output.split("\n")) {
    const m = /^\s*[-*]?\s*\**(DONE|NEXT|BROKE|DONT|DON'T)\**\s*:\**\s*(.+)$/.exec(line);
    if (m) out[m[1] === "DON'T" ? "dont" : m[1]!.toLowerCase() as keyof Note] = [m[2]!.trim()];
  }
  return out;
}

/**
 * The note for a run cut short: the agent's own lines where it left them, else what's known.
 * DONE what landed, NEXT the task (where it stopped), BROKE what went wrong, DONT what it tried.
 */
export function noteFor(r: { path: string; task: string; why: string; applied: number; edited?: string[]; conflicts?: { path?: string }[]; failures?: string[]; output?: string }): string {
  const own = readNote(r.output ?? ""), lost = r.conflicts?.length ?? 0, last = r.failures?.at(-1)?.trim().split("\n").at(-1);
  return writeNote({
    done: own.done ?? [r.applied ? `${r.applied} line edits to ${[r.path, ...r.edited ?? []].join(", ")}` : "nothing landed"],
    next: own.next ?? [`${r.task.split("\n")[0]!.trim()} (${r.path})`],
    broke: own.broke ?? [...(last ? [last] : []), ...(lost ? [`${lost} edits lost to others' changes`] : []), r.why],
    dont: own.dont ?? (r.why === "same failure twice" ? ["same fix again"] : lost ? ["redo lines others changed; work round them"] : []),
  });
}

/** What the next agent is told: the note, and nothing else. */
export const handoffTask = (path: string, why: string, note: string) =>
  `Fresh eyes on ${path}: the last agent stopped (${why}) and left you this note. Pick up from NEXT.\n${note}`;

/** The line a run's prompt ends with, so one that can't finish leaves its note. */
export const NOTE_ASK = "If you can't finish, end your reply with a note for whoever picks it up, caveman-terse, one line each: DONE: what you did. NEXT: what's left (file:line). BROKE: what fails, why. DONT: what you tried that failed, and why.";
