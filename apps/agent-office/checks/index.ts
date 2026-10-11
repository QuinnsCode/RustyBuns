// The PR board's health bar: each card's checks as a rounded bar, green for passed, red for failed, amber for
// running, grey for skipped, as long as it has checks, with the count and how long CI took beside it. The card's
// line is patched (checks/patch.ts) to call globalThis.__rbChecksBar(pull); the server adds pull.checkTally.
import { barWidth, describe, took, type Tally } from "./tally.ts";

const COLORS: [keyof Tally, string][] = [["pass", "#2a9d4b"], ["fail", "#c3423f"], ["pending", "#e0a526"], ["skip", "#9aa0a6"]];

(globalThis as { __rbChecksBar?: (p: { checkTally?: Tally }) => HTMLElement | undefined }).__rbChecksBar = (p) => {
  const t = p.checkTally;
  if (!t) return undefined;
  const n = t.pass + t.fail + t.pending + t.skip;
  const bar = document.createElement("span");
  bar.style.cssText = `display:inline-flex;width:${barWidth(n)}px;height:8px;border-radius:4px;overflow:hidden;` +
    "background:#9aa0a633;vertical-align:middle;margin-right:4px";
  for (const [k, color] of COLORS) {
    if (!t[k]) continue;
    const seg = document.createElement("span");
    seg.style.cssText = `flex:${t[k]};background:${color}`;
    bar.append(seg);
  }
  const wrap = document.createElement("span");
  wrap.className = "rb-checks-bar";
  wrap.title = describe(t);
  wrap.setAttribute("aria-label", wrap.title);
  wrap.style.whiteSpace = "nowrap";
  const time = took(t);
  wrap.append(bar, `${n}${time ? ` · ${time}` : ""}`);
  return wrap;
};
