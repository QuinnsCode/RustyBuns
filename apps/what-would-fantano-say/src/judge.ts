// The judging: Clef-omni listens to the clip and answers a few typed questions, which
// box it belongs in and two scores. It doesn't write text, so it can't be talked into
// saying anything; src/write.ts turns its answers into the review.
//
// Every token here is billed ($0.15 per million), so the questions stay terse and the
// box options are cut to the six the numbers already point at.

import type { Features } from "./analyze.ts";
import type { Box } from "./boxes.ts";

export const MODEL = "@cf/cloudflare/clef-omni";

export interface Verdict {
  box: string;
  /** How well made it sounds, 0–1. */
  craft: number;
  /** How fresh it sounds, 0–1. */
  originality: number;
  /** Someone talking with no music behind it: a podcast, a voice memo, a review of a review. */
  talking?: boolean;
  /** Who decided: Clef listening, or an estimate from the numbers alone. */
  by: "clef" | "estimate";
}

const CRAFT = ["amateur", "rough", "solid", "polished", "exceptional"];
const ORIGINALITY = ["generic", "familiar", "some ideas", "fresh", "singular"];

export function clefRequest(clip: string, boxes: Box[], title: string, hint: string) {
  const state = [`A ${title ? `clip of "${title}"` : "song clip"}.`, hint && `The artist says it sounds like: ${hint}.`].filter(Boolean).join(" ");
  return {
    model: "clef-omni",
    state,
    audio: [clip],
    questions: {
      box: { type: "choice", instructions: "Which style is this?", criteria: Object.fromEntries(boxes.map((b) => [b.id, b.name])) },
      craft: { type: "score", instructions: "How well made and mixed?", criteria: CRAFT },
      originality: { type: "score", instructions: "How original?", criteria: ORIGINALITY },
      speech: { type: "choice", instructions: "Music or speech?", criteria: { music: "music", talking: "speech only" } },
    },
  };
}

type Answer = { choice?: unknown; score?: unknown; probabilities?: Record<string, number> | number[] };

const argmax = (p: Record<string, number>) => Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0];

/** A score answer as 0–1: its `score` (0 = lowest level), or the expectation over its probabilities. */
function level(a: Answer | undefined, levels: string[]): number | null {
  if (!a) return null;
  let s = typeof a.score === "number" ? a.score : null;
  if (s === null && a.probabilities) {
    const p = Array.isArray(a.probabilities) ? a.probabilities : levels.map((l, i) => (a.probabilities as Record<string, number>)[l] ?? (a.probabilities as Record<string, number>)[i] ?? 0);
    const total = p.reduce((x, y) => x + y, 0);
    if (total > 0) s = p.reduce((acc, x, i) => acc + x * i, 0) / total;
  }
  return s === null || !Number.isFinite(s) ? null : Math.max(0, Math.min(1, s / (levels.length - 1)));
}

/** Clef's answers, checked against what we asked. Throws if they don't fit. */
export function parseClef(res: unknown, boxes: Box[]): Verdict {
  const answers = (res as { answers?: Record<string, Answer> })?.answers;
  if (!answers) throw new Error("no answers");
  const b = answers.box;
  const picked = typeof b?.choice === "string" ? b.choice : b?.probabilities && !Array.isArray(b.probabilities) ? argmax(b.probabilities) : undefined;
  const box = boxes.find((x) => x.id === picked);
  const craft = level(answers.craft, CRAFT), originality = level(answers.originality, ORIGINALITY);
  if (!box || craft === null || originality === null) throw new Error("answers don't fit the questions");
  const s = answers.speech;
  const speech = typeof s?.choice === "string" ? s.choice : s?.probabilities && !Array.isArray(s.probabilities) ? argmax(s.probabilities) : undefined;
  return { box: box.id, craft, originality, ...(speech === "talking" && { talking: true }), by: "clef" };
}

/** No Clef (local dev, or the budget's spent): a guess from the numbers. */
export function estimate(f: Features | null, boxes: Box[]): Verdict {
  let craft = 0.5, originality = 0.4;
  if (f) {
    if (f.dynamicsDb < 4) craft -= 0.15;           // brickwalled
    if (f.dynamicsDb > 8) craft += 0.1;
    if (f.loudnessDb < -20) craft -= 0.15;         // too quiet to be finished
    if (f.pulse > 0.6) craft += 0.1;
    if (f.brightness > 0.7 || f.pulse < 0.15) originality += 0.2;
    if (f.durationSec > 330) originality -= 0.1;
  }
  return { box: boxes[0]!.id, craft: clamp01(craft), originality: clamp01(originality), by: "estimate" };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
