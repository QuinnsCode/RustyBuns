// The review text, written from templates: Clef's verdict picks the box and the
// tone, the browser's numbers pick the best and worst bits. Free, instant, and
// the same song always gets the same review.

import type { Features } from "./analyze.ts";
import type { Box } from "./boxes.ts";
import type { Verdict } from "./judge.ts";

export interface Review {
  score: number;
  verdict: "NOT GOOD" | "LIGHT" | "DECENT" | "STRONG";
  box: string;
  headline: string;
  review: string;
  bestBit: string;
  worstBit: string;
  by: Verdict["by"];
}

export const verdictFor = (score: number): Review["verdict"] =>
  score <= 2 ? "NOT GOOD" : score <= 4 ? "LIGHT" : score <= 6 ? "DECENT" : "STRONG";

const OPENERS = [
  "Hi everyone. {title} landed on my desk, and it is extremely {style}.",
  "{title}. Fifteen seconds in and I already know which shelf it goes on: {style}.",
  "Okay, {title}. Tell me this is a {like} B-side and I'd believe you for about ten seconds.",
  "{title} wants to be {like} so badly it can taste it.",
];
const CRAFT = [
  ["The mix sounds like it was bounced off a phone speaker in a parking garage.", "Production-wise it's a rough sketch wearing a finished song's jacket.", "Something in this mix is fighting everything else, and nobody's winning."],
  ["The production is clean, competent, and a little safe.", "It's mixed well enough that you won't notice the mix, which is a compliment and an insult.", "Sonically it gets the job done and then clocks out."],
  ["The production is genuinely sharp: every element has its own room.", "Sonically this is dialed in. Somebody here really cares about the low end.", "The mix is gorgeous and a little bit show-offy, which I respect."],
];
const ORIGINALITY = [
  ["But I've heard this exact song about four hundred times this year.", "It's a little forgettable. I've already forgotten it, and it's still playing.", "It sounds like a playlist that learned to talk."],
  ["There are a couple of ideas in here fighting their way out.", "It flirts with doing something weird, then gets cold feet.", "Half of it is on autopilot, but the other half is awake."],
  ["And it actually sounds like nobody else, which is rare, and I'm here for it.", "It's weird in exactly the way I want things to be weird.", "I didn't see half of these choices coming."],
];
const CLOSERS: Record<Review["verdict"], string[]> = {
  "NOT GOOD": ["Not good. Transition!", "This one's going in the not-good pile, and the pile is tall."],
  LIGHT: ["Light {score}. Not offensive, just forgettable.", "A light {score}. There's a better version of this out there somewhere."],
  DECENT: ["Decent {score}. I'll keep an eye on whoever made this.", "A solid, decent {score}. Show me more."],
  STRONG: ["Strong {score}. I'm putting this on a playlist, and I don't say that lightly.", "Strong {score}. Somebody give this person a budget."],
};

const bucket = (x: number) => (x < 0.4 ? 0 : x < 0.7 ? 1 : 2);

/** A small stable hash, so the same song always picks the same lines. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The /10: the box's usual range, stretched a point either way by craft and originality. */
export function scoreFor(box: Box, v: Verdict): number {
  const q = 0.55 * v.craft + 0.45 * v.originality;
  const [lo, hi] = box.scores;
  return Math.max(0, Math.min(10, Math.round(lo - 1 + (hi - lo + 2) * q)));
}

function best(f: Features | null, box: Box): string {
  if (!f) return `It knows exactly what a ${box.name.toLowerCase()} record is supposed to be.`;
  if (f.pulse > 0.6) return "The groove is locked in tight.";
  if (f.bass > 0.55) return "That low end is massive.";
  if (f.dynamicsDb > 10) return "It's allowed to breathe: real quiet-to-loud contrast.";
  if (f.brightness > 0.6) return "The texture is abrasive in the good way.";
  return "It gets in, makes its point, and gets out.";
}

function worst(f: Features | null): string {
  if (!f) return "I had to judge it by its title, which is never a good sign.";
  if (f.dynamicsDb < 4) return "It's mastered so loud the waveform looks like a sausage.";
  if (f.durationSec > 330) return `${Math.round(f.durationSec / 60)} minutes is a big ask.`;
  if (f.loudnessDb < -20) return "It's so quiet I checked my volume twice.";
  if (f.pulse < 0.15) return "The rhythm wanders off and never comes back.";
  return "It plays it a little safe.";
}

/** The real review in this box nearest the score, so the parody points at something he actually said. */
export function realReview(box: Box, score: number, seed: number): string {
  const near = Math.min(...box.examples.map((e) => Math.abs(e.score - score)));
  const picks = box.examples.filter((e) => Math.abs(e.score - score) === near);
  const e = picks[seed % picks.length];
  if (!e) return "";
  const said = `For the record, he gave ${e.artist}'s ${e.title} ${e.score === 8 ? "an" : "a"} ${e.score} back in ${e.year}`;
  return e.take ? `${said}: "${e.take}"` : `${said}.`;
}

export function writeReview(v: Verdict, box: Box, f: Features | null, title: string): Review {
  const seed = seedOf(`${title}|${box.id}|${f ? Object.values(f).join(",") : ""}`);
  const pick = <T,>(xs: T[], salt: number) => xs[(seed >>> salt) % xs.length]!;
  const score = scoreFor(box, v);
  const verdict = verdictFor(score);
  const fill = (s: string) =>
    s.replaceAll("{title}", title || "This track").replaceAll("{style}", box.name.toLowerCase()).replaceAll("{like}", pick(box.soundsLike, 3)).replaceAll("{score}", String(score));
  return {
    score,
    verdict,
    box: box.name,
    headline: fill(`{title}: ${pick(["a", "the", "yet another"], 1)} ${box.name.toLowerCase()} record`),
    review: [pick(OPENERS, 0), pick(CRAFT[bucket(v.craft)]!, 5), pick(ORIGINALITY[bucket(v.originality)]!, 9), pick(CLOSERS[verdict], 13)].map(fill).concat(realReview(box, score, seed >>> 17)).filter(Boolean).join(" "),
    bestBit: best(f, box),
    worstBit: worst(f),
    by: v.by,
  };
}
