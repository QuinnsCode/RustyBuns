// A pen fighter (#985): a text model drawing with the pen (src/engine/pen.ts). One conversation:
// the tool card and the prompt, then a few turns of up to 8 lines each. After every turn it gets
// its shapes back as pen lines and the reasons any line was skipped. A fighter that can see gets
// a PNG of its canvas when it asks with `look`, and `done` ends the fight early. The arena plays
// one penStep per pen turn and saves the conversation between them (#996); the bake-off plays
// penFight straight through.

import { penCard, penScene, penTurn, type PenResult } from "./pen.ts";
import { snapshot } from "./raster.ts";
import type { Bounds, Scene } from "./types.ts";

type Run = (model: string, input: unknown) => Promise<unknown>;
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type PenMessage = { role: "system" | "user" | "assistant"; content: string | Part[] };

export interface PenStats {
  /** Turns the model took, lines that drew, and how many of those changed a shape already there. */
  turns: number;
  lines: number;
  edits: number;
  /** Turns that ended in `look` (a blind fighter's are ignored), and the turn it said `done`. */
  looks: number;
  doneAt?: number;
  skipped: string[];
}

export interface PenFighter {
  model: string;
  canLook: boolean;
  maxTokens: number;
}

/** The reply's text, or "" when there's none: a reasoning model that ran out of tokens has only its thinking. */
function answerOf(res: unknown): string {
  const r = res as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const text = typeof r?.response === "string" ? r.response : r?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

export function penSystem(region: Bounds, canLook: boolean): string {
  return `${penCard(region, canLook)}

You're drawing in a contest, judged on how clearly the drawing shows its prompt and how well it's made.
Big shapes first, then the details that make it read. Reply with pen lines only.`;
}

/** A pen fighter's conversation before its first turn. */
export const penOpen = (f: Pick<PenFighter, "canLook">, prompt: string, region: Bounds, turns: number): PenMessage[] => [
  { role: "system", content: penSystem(region, f.canLook) },
  { role: "user", content: `Draw: "${prompt}". Turn 1 of ${turns}.` },
];

/**
 * One pen turn: ask, draw, and (unless that was the last turn or it said `done`) tell it what it drew.
 * Mutates `messages`. A failed call throws before anything changes.
 */
export async function penStep(run: Run, f: PenFighter, messages: PenMessage[], scene: Scene, region: Bounds, prefix: string, turn: number, turns: number): Promise<PenResult & { look: boolean }> {
  const reply = answerOf(await run(f.model, { messages, max_tokens: f.maxTokens }));
  const r = penTurn(reply, scene, region, prefix);
  const look = f.canLook && r.look;
  if (r.done || turn >= turns) return { ...r, look };
  // Only the newest message carries a picture: older ones drop theirs to keep the input small.
  for (const m of messages) if (Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === "text");
  const text = [
    `Turn ${turn + 1} of ${turns}. Your canvas, as pen lines:`,
    penScene(r.scene, region, prefix) || "(empty)",
    ...(r.skipped.length ? ["Skipped:", ...r.skipped.map((s) => `${s.line} → ${s.reason}`)] : []),
    ...(look ? ["The picture is your canvas now."] : []),
  ].join("\n");
  messages.push(
    { role: "assistant", content: reply || "(nothing)" },
    { role: "user", content: look ? [{ type: "text", text }, { type: "image_url", image_url: { url: await snapshot([...r.scene.values()], region) } }] : text },
  );
  return { ...r, look };
}

export async function penFight(run: Run, f: PenFighter, prompt: string, region: Bounds, turns: number, prefix = "0-"): Promise<{ scene: Scene; stats: PenStats; errors: string[] }> {
  let scene: Scene = new Map();
  const stats: PenStats = { turns: 0, lines: 0, edits: 0, looks: 0, skipped: [] };
  const errors: string[] = [];
  const messages = penOpen(f, prompt, region, turns);
  for (let turn = 1; turn <= turns; turn++) {
    let r: Awaited<ReturnType<typeof penStep>>;
    try {
      r = await penStep(run, f, messages, scene, region, prefix, turn, turns);
    } catch (e) {
      // A failed call ends the fight, keeping what's drawn.
      errors.push(`turn ${turn}: ${e instanceof Error ? e.message : e}`);
      break;
    }
    scene = r.scene;
    stats.turns = turn;
    stats.lines += r.lines;
    stats.edits += r.edits;
    stats.skipped.push(...r.skipped.map((s) => `turn ${turn}: ${s.line} → ${s.reason}`));
    if (r.look) stats.looks++;
    if (r.done) {
      stats.doneAt = turn;
      break;
    }
  }
  return { scene, stats, errors };
}

/** A few random pen lines, for practice fights where there's no Workers AI (local dev, tests). Free. */
export function practicePen(region: Pick<Bounds, "w" | "h">, rand: () => number = Math.random): string {
  const any = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const n = (max: number) => Math.round(rand() * max);
  return Array.from({ length: 3 }, () => `${any(["o", "b", "d"])} s${n(999)} ${n(region.w)} ${n(region.h)} ${20 + n(120)} ${20 + n(120)} ${any(["red", "green", "blue", "orange", "purple", "yellow"])}`).join("\n");
}
