// The crossover on screen (#6473), for Qollab Studio's gear room and Sound Guy Simulator's desert: a response plot of
// each band and their sum (a flat line when it's set right), and each band's high-pass, low-pass, delay and polarity to
// move. The curves are crossover.ts's `response`; the page keeps the bands and plays them. DOM only, no styles to load.
import { crossoverCheck, response, type Band, type ChannelDsp, type Edge } from "./crossover.ts";
import type { CrossoverAt } from "./crossover-lesson.ts";
import { checkSteps, type Step } from "./steps.ts";

export type PanelHost = {
  /** The rig's preset bands, or none with no rig here. */
  preset(): readonly Band[];
  /** The bands as set now, or null before the rig plays. */
  bands(): readonly ChannelDsp[] | null;
  set(bands: readonly ChannelDsp[]): void;
  /** How far the sub stands in front of the tops, metres. */
  subAheadM(): number;
  /** Back to the preset. */
  reset(): void;
};

const COLOURS = ["#ff8a5c", "#ffd166", "#6fcf8e", "#6cb8ff"];
const W = 600, H = 220, TOP_DB = 12, BOTTOM_DB = -30;
const x = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W;
const y = (db: number) => ((TOP_DB - Math.max(BOTTOM_DB, Math.min(TOP_DB, db))) / (TOP_DB - BOTTOM_DB)) * H;

/** The response plot as SVG: a line a band, the sum in white, gridlines at 100 Hz, 1 kHz and 10 kHz. */
export function plotSvg(bands: readonly ChannelDsp[], preset: readonly ChannelDsp[], subAheadM: number): string {
  const r = response(bands, preset, subAheadM);
  const path = (db: number[], colour: string, width: number) => `<path fill="none" stroke="${colour}" stroke-width="${width}" d="M${db.map((v, i) => `${x(r.hz[i]!).toFixed(1)} ${y(v).toFixed(1)}`).join("L")}"/>`;
  const grid = [100, 1000, 10000].map((f) => `<path stroke="#ffffff22" d="M${x(f)} 0V${H}"/><text x="${x(f) + 3}" y="${H - 4}">${f < 1000 ? f : `${f / 1000}k`}</text>`).join("")
    + [0, -12, -24].map((db) => `<path stroke="#ffffff${db ? "22" : "55"}" d="M0 ${y(db)}H${W}"/><text x="3" y="${y(db) - 3}">${db} dB</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Each band and their sum, 20 Hz to 20 kHz" style="display:block;width:100%;background:#0b0f14;border-radius:8px;font:11px system-ui;fill:#8b95a1">${grid}${r.bands.map((b, i) => path(b, COLOURS[i % COLOURS.length]!, 1.5)).join("")}${path(r.sum, "#fff", 2.5)}</svg>`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, style = "", text = "") => {
  const e = document.createElement(tag);
  if (style) e.style.cssText = style;
  if (text) e.textContent = text;
  return e;
};
const BUTTON = "background:transparent;color:inherit;border:1px solid #ffffff44;border-radius:8px;padding:6px 10px;min-height:36px;cursor:pointer;font:inherit";
// a split's slider runs the same log scale as the plot
const toPos = (f: number) => Math.round((Math.log(f / 20) / Math.log(1000)) * 1000);
const toHz = (p: number) => Math.round(20 * Math.pow(1000, p / 1000));
const hzText = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);

/** The panel, hidden until opened. With `steps`, it lists a lesson's steps under the plot while one is on. */
export function crossoverPanel(parent: HTMLElement, host: PanelHost, o: { steps?: () => readonly Step<CrossoverAt>[] | null; onToggle?: (open: boolean) => void } = {}) {
  const box = el("section", "position:fixed;right:12px;top:56px;bottom:76px;width:min(440px,calc(100vw - 24px));overflow:auto;z-index:40;pointer-events:auto;background:#161b22;color:#e6edf3;border:1px solid #ffffff22;border-radius:12px;padding:12px;font:14px/1.35 system-ui,sans-serif;box-sizing:border-box;text-align:left");
  box.id = "crossover-panel"; box.hidden = true;
  box.setAttribute("aria-label", "Crossover");
  // a drag or an arrow key on a slider is the slider's, not the room's
  for (const t of ["keydown", "keyup", "mousedown", "pointerdown", "touchstart"]) box.addEventListener(t, (e) => { if (!("code" in e && e.code === "Escape")) e.stopPropagation(); });
  parent.append(box);
  let said = "", built = "";
  let plot: HTMLElement, read: HTMLElement, list: HTMLElement;
  let rows: (() => void)[] = [];

  const change = (i: number, next: (b: ChannelDsp) => ChannelDsp) => {
    const now = host.bands();
    if (now) host.set(now.map((b, k) => (k === i ? next(b) : b)));
    panel.frame();
  };

  /** A labelled range input, kept showing `value`. */
  function slider(way: string, what: string, max: number, step: number, value: () => number, text: () => string, input: (v: number) => void) {
    const row = el("label", "display:grid;grid-template-columns:72px 1fr 72px;gap:8px;align-items:center;min-height:32px");
    const s = el("input", "width:100%;min-width:0;margin:0"), out = el("output", "text-align:right;font-variant-numeric:tabular-nums");
    s.type = "range"; s.min = "0"; s.max = String(max); s.step = String(step); s.setAttribute("aria-label", `${way}, ${what}`);
    s.addEventListener("input", () => input(Number(s.value)));
    rows.push(() => { if (Number(s.value) !== value()) s.value = String(value()); out.textContent = text(); });
    row.append(el("span", "", what), s, out);
    return row;
  }

  function build() {
    rows = [];
    const head = el("header", "display:flex;gap:8px;align-items:center;margin-bottom:8px");
    const shut = el("button", BUTTON, "Close"), back = el("button", BUTTON, "Preset");
    shut.type = back.type = "button";
    shut.addEventListener("click", () => panel.toggle(false));
    back.addEventListener("click", () => { host.reset(); panel.frame(); });
    head.append(el("b", "flex:1;font-size:16px", "Crossover"), back, shut);
    plot = el("div", "position:sticky;top:-12px;z-index:1"); read = el("p", "margin:8px 0"); list = el("div");
    box.replaceChildren(head, plot, read, list);
    if (!host.bands()) return;
    host.preset().forEach((band, i) => {
      const dsp = () => host.bands()![i]!;
      const set = el("fieldset", "border:0;border-top:1px solid #ffffff22;margin:8px 0 0;padding:6px 0 0;min-width:0");
      set.append(el("legend", `font-weight:600;color:${COLOURS[i % COLOURS.length]};padding:0 4px 0 0`, band.way));
      for (const [key, label] of [["hp", "High-pass"], ["lp", "Low-pass"]] as const) {
        const had = band.dsp[key];
        if (!had) continue;
        const edge = (): Edge => dsp()[key] ?? had;
        set.append(slider(band.way, label, 1000, 1, () => toPos(edge().hz), () => hzText(edge().hz), (v) => change(i, (b) => ({ ...b, [key]: { ...edge(), hz: toHz(v) } }))));
      }
      set.append(slider(band.way, "Delay", Math.max(12, Math.ceil(band.dsp.delayMs)), 0.01, () => dsp().delayMs, () => `${dsp().delayMs.toFixed(2)} ms`, (v) => change(i, (b) => ({ ...b, delayMs: v }))));
      const flip = el("button", BUTTON);
      flip.type = "button";
      flip.addEventListener("click", () => change(i, (b) => ({ ...b, polarity: b.polarity === 1 ? -1 : 1 })));
      rows.push(() => { flip.textContent = dsp().polarity === 1 ? "Polarity normal" : "Polarity flipped"; flip.setAttribute("aria-pressed", String(dsp().polarity === -1)); });
      set.append(flip);
      box.append(set);
    });
  }

  const panel = {
    get open() { return !box.hidden; },
    /** Take it off the page (the venue left). */
    dispose() { box.remove(); },
    toggle(open = box.hidden) {
      box.hidden = !open;
      if (open) panel.frame();
      o.onToggle?.(open);
    },
    /** Redraw what changed (each move, and now and then while open, for moves made elsewhere). */
    frame() {
      if (box.hidden) return;
      const preset = host.preset(), now = host.bands(), shape = `${!!now} ${preset.map((b) => b.way).join()}`;
      if (shape !== built) { built = shape; said = ""; build(); }
      const steps = o.steps?.() ?? null, ahead = host.subAheadM();
      const key = JSON.stringify([now, ahead, !!steps]);
      if (key === said) return;
      said = key;
      if (!now || !preset.length) { read.textContent = preset.length ? "Turn the speakers up to set the rig's crossover." : "No rig here: the crossover is an open-air rig's."; return; }
      const want = preset.map((b) => b.dsp), check = crossoverCheck(preset.map((b, i) => ({ ...b, dsp: now[i] ?? b.dsp })), want, ahead);
      plot.innerHTML = plotSvg(now, want, ahead);
      const sum = check.dipDb < -1 ? `${-check.dipDb} dB hole at ${hzText(check.dipHz)}` : check.bumpDb > 1 ? `${check.bumpDb} dB bump at ${hzText(check.bumpHz)}` : "the bands sum flat";
      // the commands' warnings name the box id; on screen the way's name is enough
      read.textContent = [`Sum: ${sum}.`, ...check.warnings.map((w) => `${w.replace(/^[\w-]+: /, "").replace(/^t/, "T")}.`), ...(ahead ? [`The sub stands ${ahead} m in front of the tops.`] : [])].join(" ");
      list.replaceChildren();
      if (steps) {
        const checked = checkSteps(steps, { bands: now, subAheadM: ahead }), next = checked.findIndex((s) => !s.done);
        const ol = el("ol", "margin:0 0 8px;padding-left:20px");
        checked.forEach((s, i) => ol.append(el("li", s.done ? "opacity:.55;text-decoration:line-through" : i === next ? "font-weight:600" : "opacity:.8", s.job)));
        list.append(ol, el("p", "margin:0;padding:8px;border-radius:8px;background:#ffffff14", next < 0 ? "Done: the stack sums flat and the sub is in time." : checked[next]!.why ?? ""));
      }
      for (const r of rows) r();
    },
  };
  return panel;
}
