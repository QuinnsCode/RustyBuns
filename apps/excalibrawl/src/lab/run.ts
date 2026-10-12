// The bake-off: one fighter, one prompt, one setup, played straight through (no pacing), then judged by Clef.
// Dev only (/api/lab, behind EXCALIBRAWL_REAL_AI=1): it's how setups get compared on real models before one
// goes into the arena. Every call is metered from the usage the model reports, so a run says what it cost.

import { clefRequest, decide, toOps, type TurnInput } from "../engine/brain.ts";
import { CANVAS } from "../engine/match.ts";
import { applyOps, DEFAULT_LIMITS } from "../engine/ops.ts";
import { PLANNER, parsePlan, planRequest, type PlanStep } from "../engine/plan.ts";
import { snapshot } from "../engine/raster.ts";
import type { Op, SkeletonEl } from "../engine/types.ts";
import { drawPrompt, extractText, parseOpsDebug, planPrompt } from "./llm.ts";
import { penFight, type PenStats } from "./pen.ts";

export const SETUPS = {
  A: "Clef + planner",
  B: "Clef Flash + planner",
  C: "Clef + planner + Scout re-plans from the canvas every 8 turns",
  D: "Clef Flash + planner, parts at the plan's spot (Flash picks size)",
  E: "Llama 4 Scout writes ops, looking every other step (the original site)",
  F: "GPT-OSS 120B writes ops, blind",
  G: "Llama 4 Scout draws with the pen, and can look",
  H: "GPT-OSS 20B draws with the pen, blind",
} as const;
export type Setup = keyof typeof SETUPS;

const CLEF = "@cf/cloudflare/clef";
const FLASH = "@cf/cloudflare/clef-flash";
const SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const OSS = "@cf/openai/gpt-oss-120b";
const OSS20 = "@cf/openai/gpt-oss-20b";

/** $ per million tokens, in and out (Workers AI's list prices). */
const PRICE: Record<string, [number, number]> = {
  [CLEF]: [0.24, 0],
  [FLASH]: [0.038, 0],
  [PLANNER]: [0.293, 2.253],
  [SCOUT]: [0.27, 0.85],
  [OSS]: [0.35, 0.75],
  [OSS20]: [0.2, 0.3],
};

type Ai = { run(model: string, input: unknown): Promise<unknown> };

export interface LabResult {
  setup: Setup;
  prompt: string;
  elements: SkeletonEl[];
  plan: PlanStep[];
  cost: number;
  calls: number;
  errors: string[];
  judge?: { likeness: number; craft: number };
  /** Pen setups only: whether the model looked, edited, or stopped early. */
  pen?: PenStats;
  ms: number;
}

const WHERE = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
const cellOf = (where: string, n: number) => {
  const i = Math.max(0, WHERE.indexOf(where));
  const third = (k: number) => Math.min(n, Math.max(1, Math.ceil(((k + 0.5) / 3) * n)));
  return { col: third(i % 3), row: third(Math.floor(i / 3)) };
};

export async function runLab(ai: Ai, setup: Setup, prompt: string, turns = 24): Promise<LabResult> {
  const t0 = Date.now();
  const r: LabResult = { setup, prompt, elements: [], plan: [], cost: 0, calls: 0, errors: [], ms: 0 };
  const run = async (model: string, input: unknown) => {
    const res = (await ai.run(model, input)) as { usage?: Record<string, number> };
    const u = res?.usage ?? {};
    const tin = u.input_tokens ?? u.prompt_tokens ?? JSON.stringify(input).length / 4;
    const tout = u.output_tokens ?? u.completion_tokens ?? 0;
    const [pi, po] = PRICE[model] ?? [1, 1];
    r.cost += (tin * pi + tout * po) / 1e6;
    r.calls++;
    return res;
  };
  const region = CANVAS;
  let scene = new Map<string, SkeletonEl>();
  let n = 1;

  if (setup === "G" || setup === "H") {
    // The pen: up to 8 lines a turn, so a quarter of the turns the Clef setups get.
    const f = setup === "G" ? { model: SCOUT, canLook: true, maxTokens: 800 } : { model: OSS20, canLook: false, maxTokens: 3000 };
    const out = await penFight(run, f, prompt, region, Math.max(2, Math.round(turns / 4)));
    scene = out.scene;
    r.pen = out.stats;
    r.errors.push(...out.errors);
  } else if (setup === "E" || setup === "F") {
    // The original flow: a plan in words, then a few ops a step, eight steps.
    const model = setup === "E" ? SCOUT : OSS;
    const fighter = { model };
    const plan = extractText(await run(model, { messages: [{ role: "user", content: planPrompt(fighter, prompt) }], max_tokens: 500 })).trim();
    let last: Op[] | null = null;
    const steps = Math.round(turns / 3);
    for (let step = 1; step <= steps; step++) {
      try {
        const look = setup === "E" && step > 1 && step % 2 === 1;
        const text = drawPrompt({ fighter, prompt, plan, scene: [...scene.values()], lastDrawStep: last, hasScreenshot: look, opBudget: DEFAULT_LIMITS.maxOpsPerTurn });
        const content: unknown[] = [{ type: "text", text }];
        if (look) content.push({ type: "image_url", image_url: { url: await snapshot([...scene.values()], region) } });
        const res = await run(model, { messages: [{ role: "user", content }], max_tokens: setup === "F" ? 4000 : 1500 });
        const { ops, reason } = parseOpsDebug(extractText(res));
        if (!ops.length) r.errors.push(`step ${step}: ${reason}`);
        const out = applyOps(scene, ops.map((o) => (o.op === "add" ? { ...o, element: { ...o.element, id: `0-${o.element.id}` } } : "id" in o ? { ...o, id: `0-${o.id}` } : o)), region);
        scene = out.scene;
        last = out.applied;
      } catch (e) {
        r.errors.push(`step ${step}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } else {
    const model = setup === "B" || setup === "D" ? FLASH : CLEF;
    try {
      r.plan = parsePlan(await run(PLANNER, planRequest(prompt)));
    } catch (e) {
      r.errors.push(`plan: ${e instanceof Error ? e.message : e}`);
    }
    let done = 0;
    for (let turn = 1; turn <= turns; turn++) {
      try {
        const els = [...scene.values()];
        const image = await snapshot(els, region);
        if (setup === "C" && turn > 1 && turn % 8 === 1) r.plan = [...r.plan.slice(0, done), ...(await replan(run, prompt, r.plan, done, image))];
        const input: TurnInput = { prompt, turn, turns, scene: els, region, image, plan: r.plan, done };
        const d = decide(await run(model, clefRequest(model === FLASH ? "clef-flash" : "clef", input)), input);
        if (setup === "D" && d.action === "next") Object.assign(d, cellOf(r.plan[done]!.where, 12));
        const ops = toOps(d, els, region, () => `0-${n++}`);
        const out = applyOps(scene, ops, region, { ...DEFAULT_LIMITS, maxOpsPerTurn: Math.max(6, ops.length) });
        scene = out.scene;
        if (d.action === "next" && out.applied.length) done++;
      } catch (e) {
        r.errors.push(`turn ${turn}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  r.elements = [...scene.values()];
  try {
    r.judge = await judge(run, prompt, r.elements);
  } catch (e) {
    r.errors.push(`judge: ${e instanceof Error ? e.message : e}`);
  }
  r.ms = Date.now() - t0;
  return r;
}

/** Scout looks at the canvas and rewrites the parts not drawn yet. */
async function replan(run: (m: string, i: unknown) => Promise<unknown>, prompt: string, plan: PlanStep[], done: number, image: string): Promise<PlanStep[]> {
  const req = planRequest(prompt);
  const drawn = plan.slice(0, done).map((s) => s.part).join(", ") || "nothing yet";
  const text = `The image is the drawing of "${prompt}" so far. Parts drawn: ${drawn}. Looking at it, list only the parts still to draw, placed to fit what's there (and anything that would fix what looks wrong), in the same JSON.`;
  const res = await run(SCOUT, { ...req, messages: [req.messages[0], { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: image } }] }] });
  const more = parsePlan(res);
  return more.length ? more : plan.slice(done);
}

/** Clef as the judge: how clearly the drawing shows the prompt, and how well it's made. */
async function judge(run: (m: string, i: unknown) => Promise<unknown>, prompt: string, elements: SkeletonEl[]) {
  const res = (await run(CLEF, {
    model: "clef",
    state: `A drawing made only of simple coloured shapes. It is meant to show: "${prompt}".`,
    images: [await snapshot(elements, CANVAS)],
    questions: {
      likeness: { type: "score", instructions: `How clearly does the drawing show "${prompt}"?`, criteria: ["not at all", "barely", "somewhat", "clearly", "unmistakably"] },
      craft: { type: "score", instructions: "How well made is it as a drawing: composition, colour, clear shapes?", criteria: ["a mess", "rough", "okay", "good", "great"] },
    },
  })) as { answers?: Record<string, { score?: number }> };
  return { likeness: res.answers?.likeness?.score ?? NaN, craft: res.answers?.craft?.score ?? NaN };
}
