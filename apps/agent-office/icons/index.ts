// Agent Office's emoji become Lucide icons, loaded ahead of its own bundle on every page. Nothing upstream is
// patched: text the office puts in the DOM is swapped for inline SVG as it lands, and canvas text (the boards,
// the name tags, the chatter bubbles) draws the icon's strokes where the emoji glyph would have gone, in the
// same space, so the office's own measuring and centring still add up.
import { createElement } from "lucide";
import { TINT, iconFor } from "./emoji.ts";
import { hasEmoji, split } from "./split.ts";

// --- the DOM ---

// where an icon can't go (form fields, titles, options), or text that should stay as typed (code, terminals)
const SKIP = "script,style,textarea,input,select,option,title,code,pre,svg,.xterm,[contenteditable]";

function swap(node: Text) {
  const text = node.data;
  if (!hasEmoji(text) || node.parentElement?.closest(SKIP)) return;
  const runs = split(text);
  // a swap that changed nothing would wake the observer for the same text, forever
  if (runs.every(run => typeof run === "string")) return;
  node.replaceWith(...runs.map(run => typeof run === "string" ? run
    : createElement(iconFor(run.emoji), { class: TINT[run.emoji]?.solid ? "rb-icon rb-solid" : "rb-icon", "aria-hidden": "true" })));
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return swap(root as Text);
  const texts: Text[] = [];
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (it.nextNode()) texts.push(it.currentNode as Text);
  texts.forEach(swap);
}

function watchDom() {
  const style = document.createElement("style");
  // a solid status badge (a passing check, say) is a size up, so it reads at a glance
  style.textContent = ".rb-icon{display:inline-block;width:1em;height:1em;vertical-align:-0.125em;flex:none}" +
    ".rb-solid{width:1.25em;height:1.25em;vertical-align:-0.25em}";
  document.head.append(style);
  walk(document.body);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === "characterData") swap(r.target as Text);
      else r.addedNodes.forEach(n => n.isConnected && walk(n));
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
}

if (document.body) watchDom();
else document.addEventListener("DOMContentLoaded", watchDom, { once: true });

// --- canvas ---

// each icon's shapes as Path2Ds on Lucide's 24-unit grid, with the stroke and fill a tint gives them
type Shape = { path: Path2D; stroke?: string; fill?: string };
const shapes = new Map<string, Shape[]>();
function shapesFor(emoji: string): Shape[] {
  let list = shapes.get(emoji);
  if (list) return list;
  list = iconFor(emoji).map(([tag, a]) => {
    const p = new Path2D();
    const n = (k: string) => Number(a[k] ?? 0);
    if (tag === "path") p.addPath(new Path2D(String(a.d)));
    else if (tag === "circle") { p.moveTo(n("cx") + n("r"), n("cy")); p.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2); }
    else if (tag === "ellipse") { p.moveTo(n("cx") + n("rx"), n("cy")); p.ellipse(n("cx"), n("cy"), n("rx"), n("ry"), 0, 0, Math.PI * 2); }
    else if (tag === "rect") p.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx"));
    else if (tag === "line") { p.moveTo(n("x1"), n("y1")); p.lineTo(n("x2"), n("y2")); }
    else if (tag === "polyline" || tag === "polygon") {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < pts.length; i += 2) i ? p.lineTo(pts[i]!, pts[i + 1]!) : p.moveTo(pts[0]!, pts[1]!);
      if (tag === "polygon") p.closePath();
    }
    const fill = a.fill && a.fill !== "none" ? String(a.fill) : undefined;
    return { path: p, stroke: a.stroke ? String(a.stroke) : undefined, fill };
  });
  shapes.set(emoji, list);
  return list;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Draw = (this: Ctx, text: string, x: number, y: number, maxWidth?: number) => void;

function patchCanvas(proto: Ctx | undefined) {
  if (!proto) return;
  const fill = proto.fillText as Draw, stroke = proto.strokeText as Draw, measure = proto.measureText;
  // stroked text (a label's outline) leaves the icon's spot empty; the fill that follows draws it
  proto.fillText = function (text, x, y, maxWidth) { draw(this, fill, true, text, x, y, maxWidth); };
  proto.strokeText = function (text, x, y, maxWidth) { draw(this, stroke, false, text, x, y, maxWidth); };

  function draw(ctx: Ctx, orig: Draw, icons: boolean, text: string, x: number, y: number, maxWidth?: number) {
    if (typeof text !== "string" || !hasEmoji(text)) return orig.call(ctx, text, x, y, maxWidth);
    const width = measure.call(ctx, text).width;
    const k = maxWidth !== undefined && width > maxWidth ? maxWidth / width : 1;
    const align = ctx.textAlign;
    const start = align === "center" ? x - width * k / 2 : align === "right" || align === "end" ? x - width * k : x;
    // the em box around the current baseline, which is where the icon is centred
    const em = measure.call(ctx, "M");
    const top = -em.fontBoundingBoxAscent, height = em.fontBoundingBoxAscent + em.fontBoundingBoxDescent;
    ctx.save();
    ctx.textAlign = "left";
    ctx.translate(start, y);
    ctx.scale(k, 1);
    let at = 0;
    for (const run of split(text)) {
      const w = measure.call(ctx, typeof run === "string" ? run : run.raw).width;
      if (typeof run === "string") orig.call(ctx, run, at, 0);
      else if (icons) {
        // the emoji glyph is wider than a letter, so a solid badge can fill more of its space
        const size = Math.min(w, height) * (TINT[run.emoji]?.solid ? 0.95 : 0.78);
        ctx.save();
        ctx.translate(at + (w - size) / 2, top + (height - size) / 2);
        ctx.scale(size / 24, size / 24);
        const color = ctx.fillStyle;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const s of shapesFor(run.emoji)) {
          if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(s.path); }
          ctx.strokeStyle = s.stroke ?? color;
          ctx.stroke(s.path);
        }
        ctx.restore();
      }
      at += w;
    }
    ctx.restore();
  }
}

patchCanvas(globalThis.CanvasRenderingContext2D?.prototype);
patchCanvas(globalThis.OffscreenCanvasRenderingContext2D?.prototype);
