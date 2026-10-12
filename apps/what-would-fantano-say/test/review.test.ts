import { describe, expect, test } from "bun:test";
import type { Features } from "../src/analyze.ts";
import { take } from "../src/budget.ts";
import { BOXES, boxById, pickBoxes } from "../src/boxes.ts";
import { clefRequest, estimate, parseClef } from "../src/judge.ts";
import { MAX_CLIP, parseRequest } from "../src/review.ts";
import { realReview, scoreFor, verdictFor, writeReview } from "../src/write.ts";

const f: Features = { durationSec: 200, loudnessDb: -7, dynamicsDb: 4, bpm: 145, pulse: 0.6, bass: 0.6, brightness: 0.3, silence: 0 };
const clip = "data:audio/wav;base64,UklGRiQAAABXQVZF";

describe("boxes", () => {
  test("every box has a profile, tags and a sane score range", () => {
    expect(new Set(BOXES.map((b) => b.id)).size).toBe(BOXES.length);
    for (const b of BOXES) {
      expect(b.scores[0]).toBeLessThanOrEqual(b.scores[1]);
      expect(b.tags.length).toBeGreaterThan(0);
      expect(b.reviews).toBeGreaterThan(20);
      expect(b.soundsLike.length).toBeGreaterThan(0);
      expect(b.examples.length).toBeGreaterThan(2);
    }
  });

  test("numbers pick the nearest box; a hint outweighs them", () => {
    expect(pickBoxes(f)[0]!.id).toBe("streaming-rap");
    expect(pickBoxes(f, "basically death grips")[0]!.id).toBe("abrasive-rap");
    const quiet = { ...f, bpm: 70, pulse: 0.05, loudnessDb: -20, dynamicsDb: 14, bass: 0.3, brightness: 0.2 };
    expect(pickBoxes(quiet)[0]!.id).toBe("ambient");
  });
});

describe("request", () => {
  test("clamps numbers and trims text", () => {
    const r = parseRequest({ features: { ...f, bpm: 999, bass: -3 }, clip, hint: "x".repeat(500), title: "a\u0000b\n c" });
    expect(r.features!.bpm).toBe(200);
    expect(r.features!.bass).toBe(0);
    expect(r.hint.length).toBe(80);
    expect(r.title).toBe("a b c");
    expect(r.clip).toBe(clip);
  });

  test("refuses junk", () => {
    expect(() => parseRequest(null)).toThrow();
    expect(() => parseRequest({ hint: "no song" })).toThrow();
    expect(() => parseRequest({ features: { ...f, bpm: "fast" } })).toThrow();
    expect(() => parseRequest({ features: f, clip: "data:audio/mpeg;base64,AAAA" })).toThrow("bad clip");
    expect(() => parseRequest({ features: f, clip: "data:audio/wav;base64,<script>" })).toThrow("bad clip");
    expect(() => parseRequest({ features: f, clip: "data:audio/wav;base64," + "A".repeat(MAX_CLIP) })).toThrow("bad clip");
  });
});

describe("judge", () => {
  const boxes = pickBoxes(f, "", 6);

  test("asks about only the six nearest boxes, tersely", () => {
    const req = clefRequest(clip, boxes, "Song", "trap");
    expect(Object.keys(req.questions.box.criteria)).toEqual(boxes.map((b) => b.id));
    expect(req.audio).toEqual([clip]);
    // Every question token is billed: keep the whole text side small.
    expect(JSON.stringify({ ...req, audio: [] }).length).toBeLessThan(700);
  });

  test("reads Clef's documented fields", () => {
    const v = parseClef({ answers: { box: { choice: boxes[2]!.id }, craft: { score: 3 }, originality: { score: 1 } } }, boxes);
    expect(v).toEqual({ box: boxes[2]!.id, craft: 0.75, originality: 0.25, by: "clef" });
  });

  test("falls back to the probabilities when a field is missing", () => {
    const v = parseClef({
      answers: {
        box: { probabilities: { [boxes[0]!.id]: 0.1, [boxes[1]!.id]: 0.9 } },
        craft: { probabilities: [0, 0, 0, 0, 1] },
        originality: { probabilities: { generic: 1 } },
      },
    }, boxes);
    expect(v).toMatchObject({ box: boxes[1]!.id, craft: 1, originality: 0 });
  });

  test("refuses answers that don't fit", () => {
    expect(() => parseClef({}, boxes)).toThrow();
    expect(() => parseClef({ answers: { box: { choice: "made-up" }, craft: { score: 1 }, originality: { score: 1 } } }, boxes)).toThrow();
  });

  test("the estimate marks a brickwall down", () => {
    expect(estimate({ ...f, dynamicsDb: 2 }, boxes).craft).toBeLessThan(estimate({ ...f, dynamicsDb: 9 }, boxes).craft);
    expect(estimate(null, boxes).by).toBe("estimate");
  });
});

describe("write", () => {
  const box = boxById("indie-folk")!;

  test("verdicts", () => {
    expect([0, 3, 5, 8].map(verdictFor)).toEqual(["NOT GOOD", "LIGHT", "DECENT", "STRONG"]);
  });

  test("scores stretch a point past the box's range either way", () => {
    expect(scoreFor(box, { box: box.id, craft: 0, originality: 0, by: "clef" })).toBe(box.scores[0] - 1);
    expect(scoreFor(box, { box: box.id, craft: 1, originality: 1, by: "clef" })).toBe(box.scores[1] + 1);
  });

  test("the same song always gets the same review, and nothing is left unfilled", () => {
    const v = { box: box.id, craft: 0.8, originality: 0.2, by: "clef" as const };
    const loud = { ...f, dynamicsDb: 3 };
    const a = writeReview(v, box, loud, "Mixtape"), b = writeReview(v, box, loud, "Mixtape");
    expect(a).toEqual(b);
    expect(a.review).not.toContain("{");
    expect(a.headline).toContain("Mixtape");
    expect(a.worstBit).toContain("sausage");
    expect(a.review).toContain("For the record, he gave");
  });

  test("points at the real review nearest the score", () => {
    const b = { ...box, examples: [{ artist: "A", title: "Low", year: 2015, score: 3 }, { artist: "B", title: "High", year: 2020, score: 8, take: "Great." }] };
    expect(realReview(b, 4, 0)).toBe("For the record, he gave A's Low a 3 back in 2015.");
    expect(realReview(b, 9, 0)).toBe(`For the record, he gave B's High an 8 back in 2020: "Great."`);
    expect(realReview({ ...box, examples: [] }, 5, 0)).toBe("");
  });
});

test("the daily budget stops at the cap and resets the next day", () => {
  expect(take({ day: "2026-10-12", n: 4 }, "2026-10-12", 5)).toEqual({ day: "2026-10-12", n: 5, ok: true });
  expect(take({ day: "2026-10-12", n: 5 }, "2026-10-12", 5).ok).toBe(false);
  expect(take({ day: "2026-10-11", n: 5 }, "2026-10-12", 5)).toEqual({ day: "2026-10-12", n: 1, ok: true });
  expect(take({ day: "2026-10-12", n: 0 }, "2026-10-12", 0).ok).toBe(false);
});
