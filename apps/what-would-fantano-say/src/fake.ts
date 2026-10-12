// The canned review: what you get with no API key (local dev, or a deploy without
// one). Deterministic from the numbers, so it costs nothing and tests pin it.

import type { Box } from "./boxes.ts";
import type { Review, ReviewRequest } from "./review.ts";
import { verdictFor } from "./review.ts";

export function cannedReview(req: ReviewRequest, boxes: Box[]): Review {
  const f = req.features;
  const box = boxes[0]!;
  const [lo, hi] = box.scores;
  // Land inside the box's usual range, nudged by how the numbers look.
  let nudge = 0.5;
  if (f) {
    if (f.dynamicsDb < 5) nudge -= 0.2;
    if (f.durationSec > 360) nudge -= 0.15;
    if (f.pulse > 0.6 || f.dynamicsDb > 10) nudge += 0.2;
  }
  const score = Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, nudge)));
  const name = req.title || "this one";
  const loud = f && f.dynamicsDb < 5 ? "It's mastered so hot the waveform looks like a sausage." : "At least it's allowed to breathe.";
  return {
    score,
    verdict: verdictFor(score),
    headline: `${name}: ${box.name.toLowerCase()}, and it knows it`,
    review: `Hi everyone, a parody music nerd here. ${name} drops us straight into ${box.name.toLowerCase()} territory, somewhere near ${box.soundsLike[0]}. ${f ? `${f.bpm} BPM. ` : ""}${loud} ${box.take}`,
    bestBit: f && f.pulse > 0.5 ? "The groove locks in." : "It has ideas.",
    worstBit: f && f.durationSec > 300 ? "It could lose two minutes." : "It's over before it says much.",
    by: "canned",
  };
}
