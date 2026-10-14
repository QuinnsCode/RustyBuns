// The PR board's health bar: each card's checks as a rounded bar, green for passed, red for failed, amber for
// running, grey for skipped, as long as it has checks (or single tests, once CI counts them), with the counts and
// how long CI took beside it, and the test file a job hung in, if one ran out of time.
// The card's line is patched (checks/patch.ts) to call globalThis.__rbChecksBar(pull);
// the server adds pull.checkTally.
import { hot } from "../reload/hot.ts";
import { barWidth, describe, testTotal, took, type Tally } from "./tally.ts";

const COLORS: ["pass" | "fail" | "pending" | "skip", string][] = [["pass", "#2a9d4b"], ["fail", "#c3423f"], ["pending", "#e0a526"], ["skip", "#9aa0a6"]];

(globalThis as { __rbChecksBar?: (p: { checkTally?: Tally }) => HTMLElement | undefined }).__rbChecksBar = (p) => {
  const t = p.checkTally;
  if (!t) return undefined;
  const n = t.pass + t.fail + t.pending + t.skip;
  const bar = document.createElement("span");
  bar.style.cssText = `display:inline-flex;width:${barWidth(n, testTotal(t))}px;height:8px;border-radius:4px;overflow:hidden;` +
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
  const time = took(t), tests = testTotal(t);
  // a hung job: an hourglass and the file's name, the whole path in the tooltip
  const hung = t.hung?.length ? ` · ⌛ ${t.hung.map((f) => f.split("/").pop()).join(", ")}` : "";
  wrap.append(bar, `${n}${tests ? ` · ${tests} tests` : ""}${time ? ` · ${time}` : ""}${hung}`);
  return wrap;
};

// the bars already drawn stay until the board redraws; the new script replaces this function
hot("rb-checks", () => {});
