// The speakeasy: one ground floor in the whole city (city.js picks it) is a bar behind its ordinary sign.
// Four stools, a well-stocked back bar, and a butler who tends it and will chat if you stand at the counter.
import { room, stack } from "./room.js";

/** What the barkeep says, in turn; E steps through it. */
const talk = (file, lines) => [
  "Good evening. Mind the stool, it has opinions.",
  `You'll forgive the lighting. ${file} is ${lines.toLocaleString("en-US")} lines, and I have read every one of them. Line three is my favourite.`,
  "May I suggest a Dry Merge? Or a Stack Trace, on the rocks. The Null Old-Fashioned is very respectable.",
  "The archive upstairs believes it is an archive. We find it kinder not to correct it.",
  "It is raining again. The umbrellas never come in, I notice. Wise of them.",
  "Do mind the birds on your way out. They are not as well mannered as the clientele.",
];

export function buildInterior(ctx) {
  const R = room(ctx), r = ctx.r, W = R.W, ih = R.ih;
  const bottles = ["#7a4a12", "#c98a1c", "#2f6b3a", "#d8e4e0", "#8a1f2a", "#3a4a8a", "#e8c83a"];
  // The back bar: three shelves of bottles under an amber strip, a mirror's worth of light behind them.
  stack(R, r, { side: "back", rows: 3, rh: 0.27, from: -ih + 0.15, to: ih - 0.15, depth: 0.12, fill: 1, colors: bottles, tall: 0.92, label: ["#f0e6d0", "#c9a24a"] });
  R.box("neon", 0, W - 0.03, 0.9, W - 0.4, 0.03, 0.02, "#ffb347");
  // The bar itself: dark wood front, brass rail, a polished top, and the taps.
  R.box("tint", 0, W - 0.75, 0.2, 1.9, 0.4, 0.3, "#2a1810");
  R.box("tint", 0, W - 0.75, 0.415, 1.96, 0.03, 0.36, "#5a3a22");
  R.box("metal", 0, W - 0.92, 0.12, 1.86, 0.025, 0.025, "#c9a24a");
  for (const u of [-0.3, 0, 0.3]) { R.cyl(u, W - 0.8, 0.5, 0.025, 0.12, undefined, "cylMetal"); R.box("metal", u, W - 0.84, 0.56, 0.02, 0.02, 0.07); }
  // Glasses along the top.
  for (let i = 0; i < 6; i++) R.cyl(-0.8 + i * 0.3 + (r() - 0.5) * 0.06, W - 0.62, 0.47, 0.045, 0.07, "#d8e4e0");
  // Four stools, red leather on a brass post.
  for (const u of [-0.75, -0.25, 0.25, 0.75]) { R.cyl(u, W - 1.12, 0.13, 0.03, 0.26, undefined, "cylMetal"); R.cyl(u, W - 1.12, 0.28, 0.18, 0.06, "#8a1f2a"); }
  // A cask on each side, a small round table with a lamp by the door.
  for (const side of [-1, 1]) { R.cyl(side * (ih - 0.22), W - 0.3, 0.2, 0.34, 0.4, "#6b4a2e"); R.cyl(side * (ih - 0.22), W - 0.3, 0.3, 0.355, 0.02, undefined, "cylMetal"); }
  R.cyl(-ih + 0.4, 0.55, 0.16, 0.4, 0.03, "#5a3a22"); R.cyl(-ih + 0.4, 0.55, 0.08, 0.04, 0.16, undefined, "cylMetal"); R.ball(-ih + 0.4, 0.55, 0.26, 0.06, "#ffe2b3");
  // Low amber light over the bar, pooled on the boards.
  R.ball(-0.5, W - 0.75, 1.05, 0.08, "#ffe2b3"); R.ball(0.5, W - 0.75, 1.05, 0.08, "#ffe2b3");
  R.pool(0, W - 1.0, 2.0, "#ffb347");
  R.box("tint", 0, W / 2, 0.012, W, 0.02, W, "#2a1810");
  return { aisles: [-0.75, -0.25, 0.25, 0.75].map((u) => R.at(u, W - 1.2)), clerk: R.at(0, W - 0.4), talk: talk(ctx.path.split("/").pop(), ctx.lines) };
}
