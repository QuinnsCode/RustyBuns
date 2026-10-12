// Clef as the referee: once per side at the end of a fight, how clearly the drawing shows the
// prompt and how well it's made, 0 to 4 each. The bake-off scores its setups the same way. One
// Clef call a side, a fraction of a cent. It can't read text: the rasterizer draws it as a bar.

import { snapshot } from "./raster.ts";
import type { Bounds, SkeletonEl } from "./types.ts";

export const JUDGE = "@cf/cloudflare/clef";

export interface Score {
  likeness: number;
  craft: number;
}

export function judgeRequest(prompt: string, image: string) {
  return {
    model: "clef",
    state: `A drawing made only of simple coloured shapes. It is meant to show: "${prompt}".`,
    images: [image],
    questions: {
      likeness: { type: "score", instructions: `How clearly does the drawing show "${prompt}"?`, criteria: ["not at all", "barely", "somewhat", "clearly", "unmistakably"] },
      craft: { type: "score", instructions: "How well made is it as a drawing: composition, colour, clear shapes?", criteria: ["a mess", "rough", "okay", "good", "great"] },
    },
  };
}

export async function judge(run: (m: string, i: unknown) => Promise<unknown>, prompt: string, elements: SkeletonEl[], region: Bounds): Promise<Score> {
  const res = (await run(JUDGE, judgeRequest(prompt, await snapshot(elements, region)))) as { answers?: Record<string, { score?: number }> };
  return { likeness: res.answers?.likeness?.score ?? NaN, craft: res.answers?.craft?.score ?? NaN };
}

/** The side with the best likeness + craft, or -1 for a tie or when no side was scored. */
export function winnerOf(scores: (Score | null)[]): number {
  const total = scores.map((s) => (s && Number.isFinite(s.likeness + s.craft) ? s.likeness + s.craft : -Infinity));
  const best = Math.max(...total);
  return best === -Infinity || total.filter((t) => t === best).length > 1 ? -1 : total.indexOf(best);
}
