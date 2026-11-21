// What a first visitor watches before any fight is archived (a fresh deploy, local dev, R2 down): one fight
// written in the pen (engine/pen.ts) by hand and drawn by the same engine, so it replays like a real one.
// The page labels it a sample; it never stands in for a model's work.

import { penTurn } from "../engine/pen.ts";
import { CANVAS, PEN_EVERY, type LogEntry } from "../engine/match.ts";
import { regionFor } from "../engine/ops.ts";
import type { Replay, Summaries } from "../live-wire.ts";
import type { Scene } from "../engine/types.ts";

const PROMPT = "a cat in a party hat";

// Each side's pen turns, played on turns 1, 1 + PEN_EVERY, ... as a pen fight is.
const SIDES = [
  [
    "o body 175 470 200 220 orange\no head 175 300 160 140 orange\np earL orange 115,250 105,180 155,235\np earR orange 235,250 245,180 195,235",
    "o eyeL 145 290 22 28 black\no eyeR 205 290 22 28 black\nd nose 175 320 18 14 pink\nl mouth black 160,335 175,345 190,335\nl tail black 270,520 320,470 310,400",
    "p hat purple 135,240 175,130 215,240\no pom 175 128 26 26 yellow\nl whiskL black 150,325 95,315\nl whiskR black 200,325 255,315\no pawL 135 575 50 30 orange\no pawR 215 575 50 30 orange",
    "o c1 60 120 14 14 red\no c2 300 90 14 14 green\nb c3 290 200 14 14 blue\no c4 50 380 14 14 yellow\nt label 175 660 28 party cat!\ndone",
  ],
  [
    "o head 175 260 190 170 grey\no body 175 465 170 210 grey\np earL grey 95,215 100,130 150,185\np earR grey 255,215 250,130 200,185",
    "o eyeL 140 250 34 34 green\no eyeR 210 250 34 34 green\no pupL 140 250 10 24 black\no pupR 210 250 10 24 black\np nose pink 165,285 185,285 175,297",
    "p hat red 115,180 175,40 235,180\nl stripe1 yellow 130,140 220,140\nl stripe2 yellow 147,100 203,100\no pom 175 40 30 30 white\nl mouth black 160,310 175,320 190,310",
    "l tail black 260,560 330,500 310,420\nb cake 175 640 160 60 yellow\nb candle 175 592 10 30 red\ndone",
  ],
];

export const SAMPLE_ID = "sample";

/** The sample fight as a replay, plus the pen lines the engine refused (none, or the sample is broken). */
export function sampleFight(): Replay & { skipped: string[] } {
  const fighters = [{ model: "sample", name: "Left side" }, { model: "sample", name: "Right side" }];
  const turns = SIDES[0]!.length * PEN_EVERY;
  const log: LogEntry[] = [];
  const skipped: string[] = [];
  const scenes: Scene[] = fighters.map(() => new Map());
  for (let i = 0; i < SIDES[0]!.length; i++) {
    for (let side = 0; side < fighters.length; side++) {
      const r = penTurn(SIDES[side]![i]!, scenes[side]!, regionFor(side, fighters.length, CANVAS), `${side}-`);
      scenes[side] = r.scene;
      skipped.push(...r.skipped.map((s) => `${s.line}: ${s.reason}`));
      log.push({ side, turn: i * PEN_EVERY + 1, ops: r.ops, pen: { lines: r.lines, skipped: r.skipped.length, ...(r.done && { done: true }) } });
    }
  }
  return { id: SAMPLE_ID, prompt: PROMPT, fighters, turns, turn: turns, startedAt: 0, scenes: scenes.map((s) => [...s.values()]), log, skipped };
}

/** The fight the landing plays: the newest one that drew something on every side, or none. */
export const pickFight = (index: Summaries) => index.find((s) => s.shapes.length > 0 && s.shapes.every((n) => n > 0));
