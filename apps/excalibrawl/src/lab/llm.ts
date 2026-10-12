// The old excalibrawl.com fighters, for the bake-off (src/lab/run.ts): a text model plans in words, then
// writes JSON draw ops itself, a few at a time, sometimes looking at its canvas. The prompts and the parser
// are the original site's (src/lib/excalibrawl/prompts.ts and adapters.workersai.ts), unchanged but for
// imports and the AI Gateway, which Workers AI models don't need.

import type { Op, SkeletonEl } from "../engine/types.ts";

// The two prompts that ARE the product: the plan (focus + hype) and the draw
// step (build/refine). The model stays an earnest art student — it never learns
// the clock, the quarters, or that it's in a WWE-coded deathmatch.
//
// Both prompts now carry distilled DRAWING TECHNIQUE — the craft the demo
// encodes (outline-on-fill, dots for eyes, back-to-front layering) — plus one
// tiny worked example. This is few-shot craft transfer, NOT the demo dumped in;
// it teaches the pattern in a handful of tokens instead of flooding context.



interface FighterConfig {
  model: string;
  persona?: string;
  name?: string;
}

const PALETTE = "#1e1e1e #e03131 #2f9e44 #1971c2 #f08c00 #9c36b5 #ffec99 #ffffff";

// The craft, distilled from the demo. Short on purpose.
const TECHNIQUE = `HOW TO DRAW WELL on this canvas:
- Build back-to-front: big background/body shapes first, then details on top.
- Give shapes a dark outline (strokeColor "#1e1e1e") over a colored fill — that
  crisp outline is what makes a drawing read.
- Eyes = small solid black dots (little filled ellipses). Almost always needed.
- Compose a clear SILHOUETTE: a viewer should recognize it from the outline alone.
- Use color boldly. A monochrome drawing loses. Fill big shapes with real color.
- Curves and organic forms: use "line" with several points, not just boxes.
- Keep it simple and confident. 3-4 strong shapes beat 15 timid ones.`;

// One compact worked example — a 6-element cat. Teaches layering + eyes + outline
// without dumping coordinates the model will slavishly copy.
const EXAMPLE = `Tiny example — a simple cat (note: body first, then head, then details):
[
  {"op":"add","element":{"id":"body","type":"ellipse","x":260,"y":320,"width":180,"height":150,"backgroundColor":"#f08c00","fillStyle":"solid","strokeColor":"#1e1e1e"}},
  {"op":"add","element":{"id":"head","type":"ellipse","x":280,"y":210,"width":140,"height":130,"backgroundColor":"#f08c00","fillStyle":"solid","strokeColor":"#1e1e1e"}},
  {"op":"add","element":{"id":"earL","type":"line","x":300,"y":220,"points":[[0,0],[-18,-45],[35,-8]],"strokeColor":"#1e1e1e","backgroundColor":"#f08c00","fillStyle":"solid"}},
  {"op":"add","element":{"id":"earR","type":"line","x":385,"y":220,"points":[[0,0],[18,-45],[-35,-8]],"strokeColor":"#1e1e1e","backgroundColor":"#f08c00","fillStyle":"solid"}},
  {"op":"add","element":{"id":"eyeL","type":"ellipse","x":322,"y":260,"width":16,"height":16,"backgroundColor":"#1e1e1e","fillStyle":"solid"}},
  {"op":"add","element":{"id":"eyeR","type":"ellipse","x":362,"y":260,"width":16,"height":16,"backgroundColor":"#1e1e1e","fillStyle":"solid"}}
]`;

const personaLine = (f: FighterConfig) =>
  f.persona ? `\nYour style: ${f.persona}. Let it show.\n` : "";

export function planPrompt(f: FighterConfig, prompt: string): string {
  return `You are competing in EXCALIBRAWL — a live drawing showdown where AI
artists bring a prompt to life on a canvas.

YOUR PROMPT: "${prompt}"
${personaLine(f)}
You draw by emitting JSON drawing operations — shapes, lines, colors — that
render onto your canvas. You'll get a few chances to draw, and between them
you'll SEE your canvas and can refine it. But not yet.

${TECHNIQUE}

Right now is your PLAN. Think like an artist who knows the craft above:
- What's the SILHOUETTE that makes "${prompt}" instantly readable?
- What are the 3-5 big shapes, back to front? (background, body, head, details)
- What colors make it pop? Where do the eyes / signature details go?
- What's your one flourish that makes a judge say "now THAT is art"?

You cannot take long. A great plan is simple, confident, and CREATIVE. Don't
describe a safe drawing — describe the one that WINS. You are the shining star
of this art class.

Respond with a short plan in plain text — your shape-by-shape approach in a few
sentences. No drawing yet. Just the vision.`;
}

function sceneJson(scene: SkeletonEl[]): string {
  const trimmed = scene.map((e) => {
    const o: Record<string, unknown> = { id: e.id, type: e.type };
    if ("x" in e) o.x = Math.round(e.x);
    if ("y" in e) o.y = Math.round(e.y);
    if ("width" in e) o.width = Math.round((e as { width: number }).width);
    if ("height" in e) o.height = Math.round((e as { height: number }).height);
    if ("text" in e) o.text = (e as { text: string }).text;
    if (e.strokeColor) o.strokeColor = e.strokeColor;
    if (e.backgroundColor) o.backgroundColor = e.backgroundColor;
    return o;
  });
  return JSON.stringify(trimmed);
}

export interface DrawPromptArgs {
  fighter: FighterConfig;
  prompt: string;
  plan: string;
  scene: SkeletonEl[];
  lastDrawStep: unknown[] | null;
  hasScreenshot: boolean;
  opBudget: number;
}

export function drawPrompt(a: DrawPromptArgs): string {
  const last = a.lastDrawStep
    ? `\nYou just drew:\n${JSON.stringify(a.lastDrawStep)}\n`
    : "";
  const look = a.hasScreenshot
    ? `An image of your canvas is attached. Compare how it LOOKS to what you
intended — what's working, what's broken, what's missing? Fix and build on it.`
    : `Keep building toward your vision, back to front.`;

  const sceneStr = a.scene.length ? sceneJson(a.scene) : "(empty canvas — start now)";

  return `EXCALIBRAWL — drawing "${a.prompt}"
${personaLine(a.fighter)}
Your plan: ${a.plan}

${TECHNIQUE}

${EXAMPLE}

Your current drawing (exact elements on your canvas):
${sceneStr}
${last}
${look}

Emit up to ${a.opBudget} operations as a JSON array. Add new shapes, or
update/delete existing ones by their id (shown above). Remember: outline over
fill, eyes as black dots, clear silhouette, bold color.

Op shapes:
  {"op":"add","element":{"id":"r1","type":"rectangle","x":100,"y":120,"width":80,"height":60,"backgroundColor":"#ffec99","fillStyle":"solid","strokeColor":"#1e1e1e"}}
  {"op":"update","id":"r1","patch":{"backgroundColor":"#e03131"}}
  {"op":"delete","id":"r1"}

Element types: rectangle, ellipse, diamond, line, text.
Palette: ${PALETTE}

Respond with ONLY the JSON array. Draw.`;
}

// {response:object/array}, OpenAI {choices[].message.content}, and reasoning
// models that leave response empty and put output in reasoning/reasoning_content.
// ─────────────────────────────────────────────────────────────────────────────
export function extractText(res: unknown): string {
  if (typeof res === "string") return res;
  const r = res as Record<string, unknown>;

  // Non-empty string response is the common case.
  if (typeof r?.response === "string" && r.response.trim()) return r.response;
  // Structured response (array/object) — stringify so parse can unwrap it.
  if (r?.response && typeof r.response === "object") return JSON.stringify(r.response);

  // OpenAI-compatible shape.
  const choices = r?.choices as { message?: { content?: unknown } }[] | undefined;
  const c = choices?.[0]?.message?.content;
  if (typeof c === "string" && c.trim()) return c;

  // Reasoning models (Gemma 4, QwQ, etc.): output may land in a reasoning field
  // with response left empty. Read it as a fallback so these don't come back 0.
  if (typeof r?.reasoning === "string" && r.reasoning.trim()) return r.reasoning;
  const rc = (r as Record<string, unknown>)?.reasoning_content;
  if (typeof rc === "string" && rc.trim()) return rc;

  // Empty string response (thinking ate the budget, etc.) — return "" so the
  // caller logs "empty response" rather than stringifying the whole envelope.
  if (typeof r?.response === "string") return r.response;

  return JSON.stringify(res ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 — turn TEXT into Op[]. Unwrap any envelope, salvage truncation.
// This is the homogenizer. Output is ALWAYS Op[] (possibly empty) + a reason.
// ─────────────────────────────────────────────────────────────────────────────

export function parseOps(raw: string): Op[] {
  return parseOpsDebug(raw).ops;
}

export function parseOpsDebug(raw: string): { ops: Op[]; reason: string } {
  let s = (raw ?? "").trim();
  if (!s) return { ops: [], reason: "empty response" };

  // Strip a ```json ... ``` fence if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();

  // 1) Clean whole-parse first: {"response":[...]}, {"ops":[...]}, bare [...] / {...}.
  const whole = tryParse(s);
  if (whole !== undefined) {
    const arr = asOpArray(whole);
    if (arr) return { ops: arr, reason: arr.length ? "ok" : "empty array" };
  }

  // 2) Whole-parse failed (usually truncation). Find the ops array's opening
  //    bracket — after "response":[ / "ops":[ if present, else first [ — and
  //    salvage complete {...} objects up to the truncation point.
  const keyed = s.match(/"(?:response|ops)"\s*:\s*\[/i);
  const arrStart = keyed ? keyed.index! + keyed[0].length - 1 : s.indexOf("[");
  if (arrStart === -1) return { ops: [], reason: "no JSON array found" };

  const salvaged = salvageObjects(s, arrStart);
  if (salvaged.length) {
    return { ops: salvaged as Op[], reason: `ok (salvaged ${salvaged.length}, truncated)` };
  }
  return { ops: [], reason: "no complete ops before truncation" };
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

// Pull an Op[] out of whatever parsed: bare array, {response:[]}, {ops:[]}.
function asOpArray(v: unknown): Op[] | null {
  if (Array.isArray(v)) return v as Op[];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.response)) return o.response as Op[];
    if (Array.isArray(o.ops)) return o.ops as Op[];
  }
  return null;
}

// Walk from the array's "[" and JSON.parse each complete top-level {...} object,
// tracking brace depth + string state. Stops cleanly at a truncated final
// object instead of failing the whole parse.
function salvageObjects(s: string, arrStart: number): Op[] {
  const out: Op[] = [];
  let i = arrStart + 1;
  const n = s.length;
  while (i < n) {
    while (i < n && (s[i] === "," || s[i] === " " || s[i] === "\n" || s[i] === "\r" || s[i] === "\t")) i++;
    if (i >= n || s[i] === "]") break;
    if (s[i] !== "{") { i++; continue; }

    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < n; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break; // truncated mid-object — keep what we have.

    const obj = tryParse(s.slice(i, end + 1));
    if (obj && typeof obj === "object") out.push(obj as Op);
    i = end + 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — build the request. Per-model quirks live ONLY here. Everything
// past ai.run() is homogenized by extractText + parseOps above.
// ─────────────────────────────────────────────────────────────────────────────
