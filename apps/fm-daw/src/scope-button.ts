// The scope anywhere (#6551): one symbol on every page that makes sound, which floats an oscilloscope of what this page
// plays (scope-tap.ts's list). Closed there is no analyser and no drawing loop. Also in Cmd+K and WebMCP.
import { addCommands } from "@rustybuns/util/commands";
import { iconSvg } from "./paths.ts";
import { watchHeard } from "./scope-tap.ts";
import "./scope-button.css";

// lucide (ISC): audio-waveform
const ICON = '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>';
const SIZE = 2048, SPAN = SIZE / 2;

/** The button sits in the decks' header while the decks are up (their own page, or over the jam room), else beside the
 * room pill (way.ts) on a page that has one, else in the top-right corner; given `into`, in that element of the page's own. */
export function mountScope(o: { into?: string } = {}) {
  if (document.getElementById("q-scope")) return;
  const button = document.createElement("button");
  button.id = "q-scope"; button.type = "button"; button.title = "Scope: what you hear"; button.innerHTML = iconSvg(ICON, 18);
  button.setAttribute("aria-label", "Scope: what you hear"); button.setAttribute("aria-pressed", "false");
  const canvas = document.createElement("canvas");
  canvas.id = "q-scope-view"; canvas.width = 480; canvas.height = 220; canvas.hidden = true;
  canvas.setAttribute("aria-label", "Oscilloscope");

  const taps = new Map<AudioNode, AnalyserNode>();
  const buf = new Float32Array(SIZE), mix = new Float32Array(SIZE);
  let unwatch: (() => void) | null = null, frame = 0, peak = 0;

  const tap = (node: AudioNode, on: boolean) => {
    const had = taps.get(node);
    if (on && !had) {
      const a = new AnalyserNode(node.context, { fftSize: SIZE });
      node.connect(a);
      taps.set(node, a);
    } else if (!on && had) {
      try { node.disconnect(had); } catch { /* the page already took it apart */ }
      taps.delete(node);
    }
  };

  const draw = () => {
    frame = requestAnimationFrame(draw);
    mix.fill(0);
    for (const a of taps.values()) {
      if (a.context.state !== "running") continue; // a stopped context keeps its last block
      a.getFloatTimeDomainData(buf);
      for (let i = 0; i < SIZE; i++) mix[i]! += buf[i]!;
    }
    peak = 0;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    // start on a rising zero crossing, so a held note stands still
    let from = 1;
    while (from < SPAN && !(mix[from - 1]! < 0 && mix[from]! >= 0)) from++;
    if (from === SPAN) from = 0;
    const g = canvas.getContext("2d");
    if (!g) return;
    const { width: w, height: h } = canvas, gain = 1 / Math.max(0.1, peak); // quiet sounds are drawn up to 10x
    g.clearRect(0, 0, w, h);
    g.lineWidth = 1; g.strokeStyle = "rgba(244,241,234,.16)";
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.lineWidth = 3; g.strokeStyle = "#5eead4";
    g.beginPath();
    for (let i = 0; i < SPAN; i++) g.lineTo((i / (SPAN - 1)) * w, h / 2 - mix[from + i]! * gain * (h / 2 - 8));
    g.stroke();
  };

  /** Open it under or over the button, whichever side has the room, and inside the window. */
  const place = () => {
    const b = button.getBoundingClientRect(), w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, b.left + b.width / 2 - w / 2))}px`;
    canvas.style.top = `${b.top > innerHeight / 2 ? b.top - h - 8 : b.bottom + 8}px`;
  };

  const show = (on: boolean) => {
    if (on === !canvas.hidden) return;
    canvas.hidden = !on;
    button.setAttribute("aria-pressed", String(on));
    if (on) { place(); unwatch = watchHeard(tap); draw(); return; }
    unwatch?.(); unwatch = null;
    cancelAnimationFrame(frame);
    for (const node of [...taps.keys()]) tap(node, false);
    peak = 0;
  };
  const flip = () => show(canvas.hidden === true);

  // the page's own keys and pointer lock carry on: the button takes no focus (Space stays play) and its click stays here
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => { e.stopPropagation(); flip(); });
  addEventListener("resize", () => { if (!canvas.hidden) place(); });

  document.body.append(button, canvas);
  const hosts = o.into ? ["#dj header", o.into] : ["#dj header"];
  const dock = () => {
    const host = hosts.map((h) => document.querySelector(h)).find((e) => e?.getClientRects().length);
    if (host) {
      button.className = "q-scope-in"; button.removeAttribute("style");
      if (button.parentElement !== host) host.append(button);
      return;
    }
    const way = document.getElementById("qs-way");
    if (way?.style.position === "relative") { button.className = "q-scope-in"; way.style.marginLeft = "0"; if (button.nextElementSibling !== way) way.before(button); return; }
    button.className = "";
    if (button.parentElement !== document.body) document.body.append(button);
    const r = way?.getBoundingClientRect();
    if (!r?.width) return;
    button.style.top = `${r.top + (r.height - 36) / 2}px`;
    button.style.right = `${document.documentElement.clientWidth - r.left + 6}px`;
  };
  // pages draw their headers and pills after this runs, and the decks come and go: look again until each is found, and
  // each time one of them changes size (shown or hidden)
  const resized = new ResizeObserver(dock), found = new Set<Element>();
  const wanted = [...hosts, "#qs-way"];
  const look = () => {
    let fresh = false;
    for (const sel of wanted) {
      const e = document.querySelector(sel);
      if (e && !found.has(e)) { found.add(e); resized.observe(e); fresh = true; }
    }
    if (fresh) dock();
  };
  new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
  look();
  addEventListener("resize", dock);

  addCommands([{ name: "qollab_scope", title: "Scope on or off", group: "Sound", description: "Show or hide the oscilloscope of what this page plays.",
    execute: () => { flip(); return { open: !canvas.hidden }; } }]);
  // for `bun run probe` and the journey test
  Object.assign(window, { qscope: { state: () => ({ open: !canvas.hidden, taps: taps.size, peak }) } });
}
