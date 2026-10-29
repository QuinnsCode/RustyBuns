// A PR card's place in the merge train (train/server.ts), ahead of its checks bar. The emoji become Lucide icons
// (icons/), and the tooltip says what it waits on or why it came out.
import type { Spot } from "@rustybuns/util/train";

export type Card = Pick<Spot, "state" | "why"> & { ahead: number };

const LOOK: Record<Spot["state"], [string, string]> = {
  waiting: ["⏱", "#6b7280"], updating: ["🔄", "#e0a526"], checking: ["⏳", "#e0a526"],
  "main-red": ["⛔", "#c3423f"], pulled: ["🚫", "#c3423f"], merged: ["✅", "#2a9d4b"],
};

/** The chip's words: "next", "3 ahead", "updating", "checking", "main red", "pulled", "merged". */
export function chipText(c: Card) {
  if (c.state === "waiting") return c.ahead ? `${c.ahead} ahead` : "next";
  return c.state === "main-red" ? "main red" : c.state;
}

export function trainChip(c: Card) {
  const [icon, color] = LOOK[c.state];
  const el = document.createElement("span");
  el.className = "rb-train";
  el.title = `Merge train: ${c.why ?? chipText(c)}`;
  el.setAttribute("aria-label", el.title);
  el.style.cssText = `white-space:nowrap;color:${color};margin-right:6px;font-weight:600`;
  el.textContent = `${icon} ${chipText(c)}`;
  return el;
}
