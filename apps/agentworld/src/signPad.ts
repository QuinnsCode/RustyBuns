// The card-reader pad: a grey terminal with a pale screen, an X on a line to sign on, Clear and Done. A finger and a
// mouse draw the same way (pointer events). Only the pen strokes leave it (sign.ts), never the picture on the screen.
import { MAX_POINTS, MAX_STROKES, MIN_POINTS, PAD, type Point, points } from "./sign.ts";

/** Draw strokes onto a 600 by 300 space: the pad's screen and the standing sign. */
export function scrawl(g: CanvasRenderingContext2D, strokes: readonly Point[][], width: number, color: string) {
  g.lineCap = g.lineJoin = "round";
  g.lineWidth = width;
  g.strokeStyle = color;
  for (const s of strokes) {
    g.beginPath();
    g.moveTo(s[0]!.x, s[0]!.y);
    // A hair along, so a single tap is a dot.
    for (const p of s) g.lineTo(p.x + 0.01, p.y);
    g.stroke();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, attrs: Record<string, string> = {}, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.textContent = text;
  parent.append(e);
  return e;
}

/** Put the pad up in `parent`. `done` saves the strokes and answers why it couldn't, or null; `cancel` (signing again)
 *  adds a way out that keeps the old sign. Returns what takes the pad away. */
export function signPad(parent: HTMLElement, done: (strokes: Point[][]) => Promise<string | null>, cancel?: () => void): () => void {
  const till = el("div", parent, { class: "sign-till", role: "dialog", "aria-label": "Sign for your land" });
  const pad = el("div", till, { class: "sign-pad" });
  el("h2", pad, {}, "Please sign for your land");
  const screen = el("div", pad, { class: "sign-screen" });
  const ink = el("canvas", screen, { width: String(PAD.w), height: String(PAD.h), "aria-label": "Signature box: draw with your finger or mouse" });
  const keys = el("div", pad, { class: "sign-keys" });
  const clear = el("button", keys, { type: "button", class: "sign-clear" }, "Clear");
  const ok = el("button", keys, { type: "button", class: "sign-done" }, "Done");
  const says = el("p", pad, { role: "status", class: "sign-says" }, "Your neighbours will see it.");
  if (cancel) el("button", pad, { type: "button", class: "sign-keep" }, "Keep my old sign").addEventListener("click", cancel);

  const pen = ink.getContext("2d")!;
  let strokes: Point[][] = [], drawing: Point[] | null = null, saving = false;
  const redraw = () => {
    pen.clearRect(0, 0, PAD.w, PAD.h);
    scrawl(pen, strokes, 5, "#18241c");
    ok.disabled = saving || points(strokes) < MIN_POINTS;
  };
  const spot = (e: PointerEvent): Point => {
    const r = ink.getBoundingClientRect(), on = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)));
    return { x: on(((e.clientX - r.left) / r.width) * PAD.w, PAD.w), y: on(((e.clientY - r.top) / r.height) * PAD.h, PAD.h) };
  };
  ink.addEventListener("pointerdown", (e) => {
    if (strokes.length >= MAX_STROKES || points(strokes) >= MAX_POINTS) return;
    ink.setPointerCapture(e.pointerId);
    drawing = [spot(e)];
    strokes.push(drawing);
    redraw();
  });
  ink.addEventListener("pointermove", (e) => {
    const last = drawing?.at(-1);
    if (!drawing || !last || points(strokes) >= MAX_POINTS) return;
    const p = spot(e);
    // Points a few units apart are the same line, and a long scrawl stays under the cap.
    if (Math.hypot(p.x - last.x, p.y - last.y) < 4) return;
    drawing.push(p);
    redraw();
  });
  const lift = () => { drawing = null; };
  ink.addEventListener("pointerup", lift);
  ink.addEventListener("pointercancel", lift);
  clear.addEventListener("click", () => { strokes = []; drawing = null; redraw(); });
  ok.addEventListener("click", async () => {
    saving = true;
    redraw();
    const why = await done(strokes);
    saving = false;
    if (why) says.textContent = why;
    redraw();
  });
  redraw();
  return () => till.remove();
}
