// The 2D figure (drawAvatar, drawFace: codeSplitter's city and profile, the Mythic crowd's faces, FM DAW's tag) draws
// what the face maker picks (#5009): every choice of face shape, brows, nose, facial hair and cheeks, and every slider (height
// too: longer legs), changes the picture. Drawn on a stand-in context that writes down each call, so it needs no canvas.
import { expect, test } from "bun:test";
import { defaultAvatar, drawAvatar, FACE, TUNE, type Avatar } from "../src/avatar.ts";

/** A canvas context that keeps a line per call and per colour set: two avatars drawn the same give the same lines. */
function sketch(a: Avatar) {
  const lines: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (_, k) => (...args: unknown[]) => { lines.push(`${String(k)}(${args.map((x) => typeof x === "number" ? x.toFixed(2) : String(x)).join(",")})`); },
    set: (_, k, v) => { lines.push(`${String(k)}=${String(v)}`); return true; },
  });
  drawAvatar(g, a, 100, 200, 180);
  return lines.join("\n");
}

test("every face-maker choice and slider changes the 2D figure", () => {
  const ada: Avatar = { ...defaultAvatar("Ada"), glasses: "round", eyes: "dot", mouth: "smile", beard: "none", cheeks: "none", nose: "button", brows: "soft", face: "round" };
  const base = sketch(ada);
  for (const k of Object.keys(FACE) as (keyof typeof FACE)[]) for (const v of FACE[k]) {
    if (v === ada[k]) continue;
    expect([k, v, sketch({ ...ada, [k]: v }) !== base]).toEqual([k, v, true]);
  }
  for (const k of TUNE) expect([k, sketch({ ...ada, [k]: 2 }) !== base]).toEqual([k, true]);
  // the same avatar draws the same every time (the crowd's atlas and a profile agree)
  expect(sketch(ada)).toBe(base);
});
