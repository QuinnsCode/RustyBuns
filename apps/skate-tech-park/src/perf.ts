// The frame-time readout (`?fps`, or any `?weak` run): frames per second, the slowest recent frame, the quality tier
// the game is on now (it steps down on its own) and the pixel ratio. Agents read the same numbers (`skate_perf`).
import type { Quality } from "@rustybuns/util/quality";

export type Perf = { fps: number; frameMs: number; worstMs: number; tier: Quality; pixelRatio: number };

export function mountPerf(show: boolean, tier: () => Quality, pixelRatio: () => number) {
  const el = show ? Object.assign(document.createElement("p"), { className: "perf" }) : null;
  if (el) document.body.append(el);
  let last = -1, frames = 0, worst = 0, windowAt = -1;
  let now: Perf = { fps: 0, frameMs: 0, worstMs: 0, tier: tier(), pixelRatio: pixelRatio() };
  return {
    /** Call once per drawn frame with the rAF timestamp. */
    frame(t: number) {
      if (last >= 0) worst = Math.max(worst, t - last);
      last = t;
      if (windowAt < 0) windowAt = t;
      frames++;
      if (t - windowAt < 500) return;
      const fps = (frames * 1000) / (t - windowAt);
      now = { fps: Math.round(fps), frameMs: Math.round((1000 / fps) * 10) / 10, worstMs: Math.round(worst), tier: tier(), pixelRatio: pixelRatio() };
      frames = 0; worst = 0; windowAt = t;
      if (el) el.textContent = `${now.fps} fps · ${now.frameMs} ms (worst ${now.worstMs}) · ${now.tier} · ${now.pixelRatio}x`;
    },
    read: (): Perf => ({ ...now, tier: tier(), pixelRatio: pixelRatio() }),
  };
}
