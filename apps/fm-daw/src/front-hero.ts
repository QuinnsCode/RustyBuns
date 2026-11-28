// The front door's hero (#6019), drawn: a field at dusk seen from behind the crowd, the two stacks at its head, and the
// map of their highs (src/hero.ts, @rustybuns/gear's outdoor model) laid on the grass. The sliders change the air,
// the mountain button stands a bank across the field, and Play loops a beat as the back of the field hears it: each
// band turned down by what the field took from it there (hero.ts backSeat), against the low mids.
import { clamp, mulberry32 } from "@rustybuns/util";
import { banks } from "@rustybuns/gear";
import { heatRgb } from "./studio/coverage.ts";
import { BACK, BANDS, BANK, FIELD, HERO_START, HUMIDITY_RANGE, STACKS, TEMP_RANGE, backSeat, heroMap, mapSummary, type HeroAir } from "./hero.ts";
import { ICON, iconSvg } from "./paths.ts";

type V3 = { x: number; y: number; z: number };

/** Where the camera stands and looks, and how far down the screen (0 to 1) its line of sight lands. */
interface Cam { x: number; y: number; z: number; pitch: number; cyf: number }
/** The camera on the door: up on a tower at the back edge of the field, looking down it at the stacks, so the field runs off the bottom of the screen. */
const TOWER: Cam = { x: 0, y: 7, z: FIELD.z1 + 8, pitch: 0.26, cyf: 0.42 };
/** The camera with a lane open: flown up over that lane, looking almost straight down, so the map fills the screen behind the cards. */
const OVER = (x: number): Cam => ({ x, y: 26, z: (FIELD.z0 + FIELD.z1) / 2 + 26 / Math.tan(1.25), pitch: 1.25, cyf: 0.5 });

/** A lane down the field: one of the door's words, its strip of grass, and the colour its plate and beam take. */
/** A lane down the field: one of the door's words, its strip of grass, the colour its plate and beam take, and the face its word is painted in on the grass (a canvas font, e.g. `400 100px "Caveat Brush"`, drawn at 100px). */
export interface HeroLane { id: string; word: string; tone: string; face?: string; list?: HTMLElement }

export function mountHero(root: HTMLElement, lanes: readonly HeroLane[] = [], onPick: (id: string) => void = () => {}) {
  const canvas = root.querySelector<HTMLCanvasElement>("canvas")!, g = canvas.getContext("2d")!;
  const temp = root.querySelector<HTMLInputElement>('input[name="temp"]')!, hum = root.querySelector<HTMLInputElement>('input[name="humidity"]')!;
  const bankBtn = root.querySelector<HTMLButtonElement>('button[name="bank"]')!, playBtn = root.querySelector<HTMLButtonElement>('button[name="play"]')!;
  const out = (k: string) => root.querySelector<HTMLElement>(`[data-out="${k}"]`)!;
  temp.min = String(TEMP_RANGE[0]); temp.max = String(TEMP_RANGE[1]); hum.min = String(HUMIDITY_RANGE[0]); hum.max = String(HUMIDITY_RANGE[1]);
  bankBtn.innerHTML = iconSvg(ICON.mountain, 18) + "<span>Bank</span>";
  temp.closest("label")!.insertAdjacentHTML("afterbegin", iconSvg(ICON.thermometer, 18));
  hum.closest("label")!.insertAdjacentHTML("afterbegin", iconSvg(ICON.droplets, 18));

  let air: HeroAir = { ...HERO_START }, map = heroMap(air), back = backSeat(air), draws = 0;
  let W = 0, H = 0, f = 0, cx = 0, cy = 0;
  let cam: Cam = { ...TOWER }, F = { y: 0, z: 0 }, U = { y: 0, z: 0 };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const land = (a: HeroAir) => (a.bank ? banks([BANK]) : () => 0);

  // the lanes: the field cut into strips from the back to the stage, a word painted on the grass of each, and at the
  // foot of the screen a card for each: its button and the list of its apps (hemyviz's floor names and picked block in its beam of light)
  const laneW = (FIELD.x1 - FIELD.x0) / Math.max(1, lanes.length);
  // the camera looks up the field from the back, so +x is to the left on screen: the first lane takes the far +x strip
  const strips = lanes.map((l, i) => ({ ...l, x0: FIELD.x1 - (i + 1) * laneW, x1: FIELD.x1 - i * laneW, quad: [] as [number, number][] }));
  let open: string | null = null, hover: string | null = null;
  const tags = document.querySelector<HTMLElement>(".lanes"); // over the whole page, so a button slides above the tab bar into its tab
  const tagOf = new Map<string, HTMLElement>();
  for (const s of strips) {
    const card = document.createElement("div"), b = document.createElement("button");
    card.className = "lane"; card.dataset.lane = s.id; card.style.setProperty("--tone", s.tone);
    b.type = "button"; b.innerHTML = `<b></b>`; b.querySelector("b")!.textContent = s.word;
    card.append(b);
    if (s.list) card.append(s.list);
    card.addEventListener("click", (e) => { if (!(e.target instanceof Element && e.target.closest("a"))) onPick(s.id); });
    card.addEventListener("pointerenter", () => { hover = s.id; draw(); });
    card.addEventListener("pointerleave", () => { hover = null; draw(); });
    tags?.append(card); tagOf.set(s.id, card);
  }
  const inQuad = (q: [number, number][], x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, yi] = q[i]!, [xj, yj] = q[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const laneAt = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return strips.find((s) => s.quad.length && inQuad(s.quad, x, y))?.id ?? null;
  };
  canvas.addEventListener("pointermove", (e) => { const h = laneAt(e); if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : ""; draw(); } });
  canvas.addEventListener("pointerleave", () => { if (hover) { hover = null; draw(); } });
  canvas.addEventListener("click", (e) => { const h = laneAt(e); if (h) onPick(h); });
  /** Lights a lane (or none): it stands in its beam, the others go dark, and the camera flies over it. The page calls
   *  this as you scroll from one lane's shelf to the next. */
  function show(id: string | null) {
    if (id === open) return;
    open = id;
    for (const [k, b] of tagOf) b.setAttribute("aria-current", String(k === open));
    draw();
  }
  // the lane buttons slide up into the tabs as you scroll off the field: `morph` runs 0 (on the field) to 1 (in the tabs)
  let morph = 0, into = new Map<string, DOMRect>();
  const ease = (t: number) => t * t * (3 - 2 * t);
  function placeTags() {
    const e = ease(morph);
    for (const s of strips) {
      const tag = tagOf.get(s.id), to = into.get(s.id);
      if (!tag) continue;
      // the card's button slides from where the page laid it into its tab, and its list fades on the way
      const head = tag.firstElementChild as HTMLElement, mid = head.offsetTop + head.offsetHeight / 2;
      let x = 0, y = 0, k = 1;
      if (to && e > 0) {
        x = (to.left + to.width / 2 - (tag.offsetLeft + tag.offsetWidth / 2)) * e; y = (to.top + to.height / 2 - (tag.offsetTop + mid)) * e;
        k = 1 + (to.height / Math.max(1, head.offsetHeight) - 1) * e;
      }
      tag.style.transformOrigin = `50% ${mid}px`;
      tag.style.transform = e > 0 ? `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(3)})` : "";
      tag.style.setProperty("--list", clamp(1 - e * 3, 0, 1).toFixed(2));
      tag.style.visibility = morph >= 1 ? "hidden" : "";
      tag.style.pointerEvents = morph > 0.3 ? "none" : "";
    }
  }
  /** A word painted flat on the grass between x0 and x1, its foot at z (near the back) and its head toward the stage,
   *  read left to right from the back (from x1 on the left of the screen to x0). */
  function floorWord(text: string, face: string, x0: number, x1: number, z: number, deep: number, fill: string, dpr: number) {
    const o = project({ x: x1, y: 0, z }), u = project({ x: x0, y: 0, z }), v = project({ x: x1, y: 0, z: z - deep });
    g.save(); g.font = face;
    const tw = g.measureText(text).width, a = (u[0] - o[0]) / tw, b = (u[1] - o[1]) / tw, c = -(v[0] - o[0]) / 100, d = -(v[1] - o[1]) / 100;
    g.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * o[0], dpr * o[1]);
    g.fillStyle = fill; g.textBaseline = "bottom"; g.fillText(text, 0, 0); g.restore();
  }
  const project = (p: V3): [number, number] => {
    const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, depth = Math.max(0.5, dy * F.y + dz * F.z);
    return [cx - (f * dx) / depth, cy - (f * (dy * U.y + dz * U.z)) / depth];
  };

  // the treeline past the stage, one fixed silhouette
  const rnd = mulberry32(6019), trees = Array.from({ length: 90 }, () => 0.4 + rnd() * 0.6);

  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    if (Math.round(r.width * dpr) !== canvas.width || Math.round(r.height * dpr) !== canvas.height) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    W = r.width; H = r.height; // the field crowds up under the title, big: the treeline near the top, the stage high, the lanes filling the screen
    f = Math.min(W * 1.3, H * 1.1); cy = H * cam.cyf;
    cx = W / 2;
    // the camera flies between the tower and over the open lane, a step a frame until it gets there
    const lane = strips.find((s) => s.id === open), goal = lane ? OVER((lane.x0 + lane.x1) / 2) : TOWER;
    let moving = false;
    for (const k of ["x", "y", "z", "pitch", "cyf"] as const) {
      const d = goal[k] - cam[k];
      if (still || Math.abs(d) < (k === "pitch" || k === "cyf" ? 0.002 : 0.02)) cam[k] = goal[k]; else { cam[k] += d * 0.14; moving = true; }
    }
    if (moving) requestAnimationFrame(() => draw());
    F = { y: -Math.sin(cam.pitch), z: -Math.cos(cam.pitch) }; U = { y: Math.cos(cam.pitch), z: -Math.sin(cam.pitch) };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const horizon = cy - f * Math.tan(cam.pitch);
    // the sky at dusk, the sun gone down behind the stage
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#151832"); sky.addColorStop(0.55, "#3d2b55"); sky.addColorStop(0.85, "#b55a4a"); sky.addColorStop(1, "#f0a060");
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon + 1);
    const glow = g.createRadialGradient(cx, horizon, 0, cx, horizon, W * 0.45);
    glow.addColorStop(0, "rgba(255,190,120,.55)"); glow.addColorStop(1, "rgba(255,190,120,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, horizon + 1);
    // the land
    const grass = g.createLinearGradient(0, horizon, 0, H);
    grass.addColorStop(0, "#1a2119"); grass.addColorStop(1, "#24331f");
    g.fillStyle = grass; g.fillRect(0, horizon, W, H - horizon);
    g.fillStyle = "#0d1012"; g.beginPath(); g.moveTo(0, horizon + 1);
    trees.forEach((t, i) => g.lineTo((i / (trees.length - 1)) * W, horizon - t * H * 0.045 - (i % 3) * 1.5));
    g.lineTo(W, horizon + 1); g.closePath(); g.fill();
    // the map, far rows first, each cell on the land under it
    const t = land(air), { nx, nz, db, ref } = map, cw = (FIELD.x1 - FIELD.x0) / nx, cd = (FIELD.z1 - FIELD.z0) / nz;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x0 = FIELD.x0 + ix * cw, z0 = FIELD.z0 + iz * cd, x1 = x0 + cw, z1 = z0 + cd;
      const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => project({ x: x!, y: t(x!, z!), z: z! }));
      const [rr, gg, bb] = heatRgb(ref - db[iz * nx + ix]!);
      g.fillStyle = g.strokeStyle = `rgba(${rr},${gg},${bb},.62)`; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(c[0]![0], c[0]![1]); for (const p of c.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); g.stroke();
    }
    // the lanes over the map: the others go dark when one is open, the open one glows and stands in a beam from the sky
    for (const s of strips) {
      s.quad = [[s.x0, FIELD.z0], [s.x1, FIELD.z0], [s.x1, FIELD.z1], [s.x0, FIELD.z1]].map(([x, z]) => project({ x: x!, y: 0, z: z! }));
      const lit = s.id === open, hot = s.id === hover, path = () => { g.beginPath(); s.quad.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
      if (open && !lit) { path(); g.fillStyle = "rgba(9,10,14,.55)"; g.fill(); }
      if (lit || hot) { path(); g.fillStyle = s.tone + (lit ? "33" : "1a"); g.fill(); }
      path(); g.strokeStyle = s.tone + (lit ? "ff" : hot ? "cc" : "66"); g.lineWidth = lit ? 2.5 : 1.5; g.stroke();
      floorWord(s.word.toUpperCase(), s.face ?? '600 100px "Saira Condensed", sans-serif', s.x0 + laneW * 0.16, s.x1 - laneW * 0.16, FIELD.z1 - 18, laneW * 0.42, lit ? "rgba(244,241,234,.92)" : s.tone + (hot ? "dd" : "88"), dpr);
      if (lit) { // the beam: from the top of the sky down onto the lane's head, by the stage
        const [nl, nr] = [s.quad[0]!, s.quad[1]!], top = (nl[0] + nr[0]) / 2, spread = (nr[0] - nl[0]) * 0.35;
        const beam = g.createLinearGradient(0, 0, 0, nl[1]);
        beam.addColorStop(0, "rgba(255,240,220,0)"); beam.addColorStop(1, "rgba(255,240,220,.22)");
        g.fillStyle = beam; g.beginPath(); g.moveTo(top - spread, 0); g.lineTo(top + spread, 0); g.lineTo(nr[0], nr[1]); g.lineTo(nl[0], nl[1]); g.closePath(); g.fill();
      }
    }
    if (air.bank) { // the crest, lit from the west
      g.strokeStyle = "rgba(255,220,170,.55)"; g.lineWidth = 1.5; g.beginPath();
      for (let k = 0; k <= 20; k++) { const x = BANK.at[0] - BANK.len / 2 + (k / 20) * BANK.len, [sx, sy] = project({ x, y: t(x, BANK.at[1]), z: BANK.at[1] }); k ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }
      g.stroke();
    }
    // the stage between the stacks, and the stacks: a bass bin and two horns each
    box(-4.5, 4.5, 0, 1.1, -3, -0.2, "#121418");
    for (const s of STACKS) { box(s.x - 0.6, s.x + 0.6, 0, 1.1, s.z - 0.8, s.z + 0.2, "#0c0d10"); box(s.x - 0.28, s.x + 0.28, 1.1, 3, s.z - 0.5, s.z, "#16181c"); }
    for (const s of STACKS) { // the horns' work lights, so the stacks read at dusk
      const [sx, sy] = project({ x: s.x, y: 3.1, z: s.z }), l = g.createRadialGradient(sx, sy, 0, sx, sy, 26);
      l.addColorStop(0, "rgba(255,200,140,.7)"); l.addColorStop(1, "rgba(255,200,140,0)"); g.fillStyle = l; g.fillRect(sx - 26, sy - 26, 52, 52);
    }
    // you, at the back
    const [bx, by] = project({ x: BACK.x, y: t(BACK.x, BACK.z), z: BACK.z });
    g.fillStyle = "#f4f1ea"; g.beginPath(); g.arc(bx, by - 6, 4, 0, Math.PI * 2); g.fill();
    g.fillRect(bx - 1.5, by - 3, 3, 4);
    draws++;
    placeTags();
  }
  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, fill: string) {
    const t = land(air), base = t((x0 + x1) / 2, (z0 + z1) / 2);
    const faces: V3[][] = [ // the top and the face toward the camera
      [{ x: x0, y: y1, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }],
      [{ x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }],
    ];
    faces.forEach((face, i) => {
      g.fillStyle = i ? fill : "#2a2a2e"; g.beginPath();
      face.forEach((p, k) => { const [sx, sy] = project({ ...p, y: p.y + base }); k ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
      g.closePath(); g.fill();
    });
  }

  // the beat, heard from the back: kick, hats and a held chord, through one EQ the field sets
  let ctx: AudioContext | null = null, eq: BiquadFilterNode[] = [], level: GainNode | null = null, timer = 0, next = 0, beat = 0;
  const tone = () => {
    if (!ctx || !level) return;
    const lowMid = back.down[BANDS.indexOf(500)]!, now = ctx.currentTime;
    eq.forEach((b, i) => b.gain.setTargetAtTime(clamp(-(back.down[i]! - lowMid), -30, 12), now, 0.08));
    level.gain.setTargetAtTime(0.5 * 10 ** (-clamp(lowMid, 0, 20) / 20), now, 0.08);
  };
  function start() {
    ctx ??= new AudioContext();
    if (!level) {
      level = ctx.createGain(); level.connect(ctx.destination);
      eq = BANDS.map((hz, i) => { const b = ctx!.createBiquadFilter(); b.type = i === 0 ? "lowshelf" : i === BANDS.length - 1 ? "highshelf" : "peaking"; b.frequency.value = hz; b.Q.value = 1; return b; });
      eq.reduce((a, b) => (a.connect(b), b)).connect(level);
    }
    void ctx.resume(); tone();
    next = ctx.currentTime + 0.05; beat = 0;
    timer = window.setInterval(schedule, 50);
  }
  const stop = () => { clearInterval(timer); timer = 0; void ctx?.suspend(); };
  const noise = (c: AudioContext) => { const b = c.createBuffer(1, c.sampleRate * 0.2, c.sampleRate), d = b.getChannelData(0), r = mulberry32(7); for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1; return b; };
  let hiss: AudioBuffer | null = null;
  function schedule() {
    const c = ctx!, inp = eq[0]!, step = 60 / 122 / 2;
    while (next < c.currentTime + 0.2) {
      if (beat % 2 === 0) { // kick
        const o = c.createOscillator(), a = c.createGain();
        o.frequency.setValueAtTime(120, next); o.frequency.exponentialRampToValueAtTime(42, next + 0.12);
        a.gain.setValueAtTime(0.9, next); a.gain.exponentialRampToValueAtTime(0.001, next + 0.35);
        o.connect(a).connect(inp); o.start(next); o.stop(next + 0.4);
      } else { // hat
        hiss ??= noise(c);
        const s = c.createBufferSource(), hp = c.createBiquadFilter(), a = c.createGain();
        s.buffer = hiss; hp.type = "highpass"; hp.frequency.value = 6000;
        a.gain.setValueAtTime(0.35, next); a.gain.exponentialRampToValueAtTime(0.001, next + 0.08);
        s.connect(hp).connect(a).connect(inp); s.start(next); s.stop(next + 0.1);
      }
      if (beat % 16 === 0) for (const hz of [220, 277.2, 329.6, 440]) { // the chord, a bar long
        const o = c.createOscillator(), a = c.createGain();
        o.type = "sawtooth"; o.frequency.value = hz;
        a.gain.setValueAtTime(0, next); a.gain.linearRampToValueAtTime(0.05, next + 0.3); a.gain.linearRampToValueAtTime(0, next + step * 16);
        o.connect(a).connect(inp); o.start(next); o.stop(next + step * 16 + 0.05);
      }
      next += step; beat++;
    }
  }

  function render() {
    temp.value = String(air.tempC); hum.value = String(air.humidity);
    out("temp").textContent = `${air.tempC} °C`; out("humidity").textContent = `${air.humidity} %`;
    bankBtn.setAttribute("aria-pressed", String(air.bank));
    const dull = back.dull, hi = back.down[BANDS.indexOf(4000)]!;
    out("back").textContent = `At the back the highs are ${hi.toFixed(1)} dB under the middle of the field, ${Math.abs(dull).toFixed(1)} dB ${dull >= 0 ? "duller" : "brighter"} than the low mids, and the sound lands ${back.ms} ms after it leaves the stacks.`;
    playBtn.innerHTML = iconSvg(timer ? ICON.pause : ICON.play, 18) + `<span>${timer ? "Stop" : "Hear it from the back"}</span>`;
    playBtn.setAttribute("aria-pressed", String(!!timer));
    draw(); tone();
  }
  function set(p: Partial<HeroAir>) {
    air = { tempC: clamp(Math.round(p.tempC ?? air.tempC), ...TEMP_RANGE), humidity: clamp(Math.round(p.humidity ?? air.humidity), ...HUMIDITY_RANGE), bank: p.bank ?? air.bank };
    map = heroMap(air); back = backSeat(air); render();
  }
  temp.addEventListener("input", () => set({ tempC: +temp.value }));
  hum.addEventListener("input", () => set({ humidity: +hum.value }));
  bankBtn.addEventListener("click", () => set({ bank: !air.bank }));
  playBtn.addEventListener("click", () => { timer ? stop() : start(); render(); });
  new ResizeObserver(() => draw()).observe(canvas);
  // a canvas asks for no font, so load each lane's face and paint the words again once they land
  for (const s of strips) if (s.face) void document.fonts.load(s.face).then(() => draw());
  render();

  return {
    /** The hero as drawn: the air, the map in two numbers (dB under the middle, near half and far half), the back seat, whether it plays, and how many times it was drawn. */
    state: () => ({ air: { ...air }, map: mapSummary(map), back: { ...back }, playing: !!timer, draws, size: [Math.round(W), Math.round(H)], lane: open }),
    /** Lights a lane, or none with null: its beam, the others dark, the camera over it (the page calls it as you scroll). */
    lane: show,
    /** How far the lane buttons have slid from the field into the tabs (0 to 1), and the tab each slides into. */
    morph(p: number, tabs: ReadonlyMap<string, DOMRect>) { morph = clamp(p, 0, 1); into = new Map(tabs); placeTags(); },
    /** Changes the air or the bank, as the sliders and the mountain button do. */
    set,
  };
}
