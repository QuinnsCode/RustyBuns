// A pen fighter (#985): a text model drawing with the pen (src/engine/pen.ts). One conversation:
// the tool card and the prompt, then a few turns of up to 8 lines each. After every turn it gets
// its shapes back as pen lines and the reasons any line was skipped. A fighter that can see gets
// a PNG of its canvas when it asks with `look`, and `done` ends the fight early.

import { penCard, penScene, penTurn } from "../engine/pen.ts";
import { snapshot } from "../engine/raster.ts";
import type { Bounds, Scene } from "../engine/types.ts";

type Run = (model: string, input: unknown) => Promise<unknown>;
type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user" | "assistant"; content: string | Part[] };

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

export async function penFight(run: Run, f: PenFighter, prompt: string, region: Bounds, turns: number, prefix = "0-"): Promise<{ scene: Scene; stats: PenStats; errors: string[] }> {
  let scene: Scene = new Map();
  const stats: PenStats = { turns: 0, lines: 0, edits: 0, looks: 0, skipped: [] };
  const errors: string[] = [];
  const messages: Message[] = [
    { role: "system", content: penSystem(region, f.canLook) },
    { role: "user", content: `Draw: "${prompt}". Turn 1 of ${turns}.` },
  ];
  for (let turn = 1; turn <= turns; turn++) {
    let reply: string;
    try {
      reply = answerOf(await run(f.model, { messages, max_tokens: f.maxTokens }));
    } catch (e) {
      // A failed call ends the fight, keeping what's drawn.
      errors.push(`turn ${turn}: ${e instanceof Error ? e.message : e}`);
      break;
    }
    const r = penTurn(reply, scene, region, prefix);
    scene = r.scene;
    stats.turns = turn;
    stats.lines += r.lines;
    stats.edits += r.edits;
    stats.skipped.push(...r.skipped.map((s) => `turn ${turn}: ${s.line} → ${s.reason}`));
    const look = f.canLook && r.look;
    if (look) stats.looks++;
    if (r.done) {
      stats.doneAt = turn;
      break;
    }
    if (turn === turns) break;

    // Only the newest message carries a picture: older ones drop theirs to keep the input small.
    for (const m of messages) if (Array.isArray(m.content)) m.content = m.content.filter((p) => p.type === "text");
    const text = [
      `Turn ${turn + 1} of ${turns}. Your canvas, as pen lines:`,
      penScene(scene, region, prefix) || "(empty)",
      ...(r.skipped.length ? ["Skipped:", ...r.skipped.map((s) => `${s.line} → ${s.reason}`)] : []),
      ...(look ? ["The picture is your canvas now."] : []),
    ].join("\n");
    messages.push(
      { role: "assistant", content: reply || "(nothing)" },
      { role: "user", content: look ? [{ type: "text", text }, { type: "image_url", image_url: { url: await snapshot([...scene.values()], region) } }] : text },
    );
  }
  return { scene, stats, errors };
}
