// The planner: the step Clef can't do itself. Clef only picks from options, so on its own it never decides that
// a cat is a long orange body, a head at one end, two triangle ears and black dot eyes. Once per fight a text
// model writes each fighter that list, in Clef's own vocabulary (shape, colour, rough spot, size, proportions),
// and every turn Clef works through it, looking at its canvas to place each part against what's already there.
// One call a fighter, ~1,500 tokens.

/** The shapes a fighter can draw; brain.ts describes each to Clef. */
export const SHAPE_KINDS = ["ellipse", "rectangle", "diamond", "triangle", "stroke", "dot"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Workers AI's Llama 3.3 70B (fp8, fast): good at short structured lists, ~$0.001 a plan. */
export const PLANNER = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const COLOR_NAMES = ["black", "red", "green", "blue", "orange", "purple", "yellow", "white"] as const;
const SIZES = ["tiny", "small", "medium", "large", "huge"] as const;
const ASPECTS = ["tall", "square", "wide"] as const;
const WHERE = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

export interface PlanStep {
  /** What it is: "body", "left ear", "turntable". */
  part: string;
  shape: ShapeKind;
  color: (typeof COLOR_NAMES)[number];
  where: (typeof WHERE)[number];
  /** 0 (tiny) to 4 (huge), as Clef's size score. */
  size: number;
  aspect: (typeof ASPECTS)[number];
}

export const MAX_STEPS = 12;

export function planRequest(prompt: string, persona?: string) {
  const system = `You plan simple drawings made only of these shapes: ${SHAPE_KINDS.join(", ")}.
Colours: ${COLOR_NAMES.join(", ")}. Sizes: ${SIZES.join(", ")}. Proportions: ${ASPECTS.join(", ")}.
Places on the canvas: ${WHERE.join(", ")}.
List the parts in drawing order: the biggest shapes at the back first, details on top last.
No background, sky or floor: the white canvas is the background. Draw the subject, big and centred.
A good plan has a clear silhouette someone could name, bold colour, and black dots for eyes.
Use 5 to ${MAX_STEPS} parts. Answer with JSON only: {"parts":[{"part":"...","shape":"...","color":"...","where":"...","size":"...","aspect":"..."}]}`;
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Plan a drawing of: "${prompt}".${persona ? ` Style: ${persona}.` : ""}` },
    ],
    max_tokens: 900,
    temperature: 0.9,
  };
}

const pick = <T extends string>(v: unknown, options: readonly T[]): T | undefined => {
  const s = String(v ?? "").toLowerCase().trim();
  return options.find((o) => o === s) ?? options.find((o) => s.includes(o));
};

/** The planner's answer as steps; anything outside the vocabulary is dropped, not guessed at. */
export function parsePlan(res: unknown): PlanStep[] {
  const text = typeof res === "string" ? res : typeof (res as { response?: unknown })?.response === "string" ? (res as { response: string }).response : JSON.stringify((res as { response?: unknown })?.response ?? res);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parts: unknown;
  try {
    parts = (JSON.parse(json) as { parts?: unknown }).parts;
  } catch {
    return [];
  }
  if (!Array.isArray(parts)) return [];
  const steps: PlanStep[] = [];
  for (const p of parts.slice(0, MAX_STEPS) as Record<string, unknown>[]) {
    const shape = pick(p?.shape, SHAPE_KINDS);
    const color = pick(p?.color, COLOR_NAMES);
    const size = pick(p?.size, SIZES);
    if (!shape || !color || !size) continue;
    steps.push({
      part: String(p.part ?? shape).slice(0, 40),
      shape,
      color,
      where: pick(p.where, WHERE) ?? "center",
      size: SIZES.indexOf(size),
      aspect: pick(p.aspect, ASPECTS) ?? "square",
    });
  }
  return steps;
}

export const describeStep = (s: PlanStep) => `${s.part}: ${SIZES[Math.round(s.size)]} ${s.color} ${s.shape}, ${s.aspect}, ${s.where}`;

/** A plan for practice fights: random, free. */
export function practicePlan(rand: () => number = Math.random): PlanStep[] {
  const any = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  return Array.from({ length: 6 }, (_, i) => ({
    part: `part ${i + 1}`,
    shape: any(SHAPE_KINDS),
    color: any(COLOR_NAMES),
    where: any(WHERE),
    size: Math.max(0, 3 - Math.floor(i / 2)),
    aspect: any(ASPECTS),
  }));
}
