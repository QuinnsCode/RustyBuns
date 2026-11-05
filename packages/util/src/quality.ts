// One quality dial for every 3D game: what a machine can draw, picked once and stepped down when frames drop.
// Plain TS, nothing from three: a game maps a tier to its own renderer settings with `QUALITY[tier]`.

export type Quality = "low" | "mid" | "high";
export const QUALITIES: readonly Quality[] = ["low", "mid", "high"];

/** What each tier allows. `detail` is the asset budget name the games already use for models (`?scenery=` and `?peak=`). */
export const QUALITY = {
  low: { pixelRatio: 1, antialias: false, shadows: false, shadowMap: 0, detail: "low", anisotropy: 1 },
  mid: { pixelRatio: 1.5, antialias: true, shadows: true, shadowMap: 1024, detail: "mid", anisotropy: 4 },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowMap: 2048, detail: "hi", anisotropy: 8 },
} as const satisfies Record<Quality, { pixelRatio: number; antialias: boolean; shadows: boolean; shadowMap: number; detail: string; anisotropy: number }>;

export const STORE_KEY = "rustybuns.quality";

const isQuality = (v: unknown): v is Quality => typeof v === "string" && (QUALITIES as readonly string[]).includes(v);

/** Software rasterisers and the integrated chips that choke on shadow maps and a 2x canvas. */
const WEAK = /swiftshader|llvmpipe|softpipe|microsoft basic render|virtualbox|vmware|intel.*\b(hd|uhd|gma|iris)\b.*\b(2000|2500|3000|4000|4400|4600|5[0-9]{3}|6[0-1][0-9]{2})\b|intel\(r\) hd graphics(?! [0-9])|mali-4|adreno [1-4]|powervr/i;
/** Anything that reads as a real GPU of the last decade. */
const STRONG = /nvidia|geforce|radeon (rx|pro|vii)|apple (m[0-9]|gpu)|arc\(tm\)|adreno [6-9]/i;

export interface Machine {
  /** `GL_RENDERER`, or the unmasked one when `WEBGL_debug_renderer_info` gives it; "" when there is no WebGL at all. */
  gpu: string;
  webgl2: boolean;
  cores?: number;
  /** `navigator.deviceMemory`, GiB, when the browser says. */
  memory?: number;
  /** A phone: a coarse pointer and a screen under 600 CSS px on its short side. Its GPU may name itself like a laptop's
   * ("Apple GPU") and Safari says nothing of its memory, but it has a laptop's pixels to fill at a fraction of the power. */
  phone?: boolean;
}

/** Read the machine from a canvas. Safe to call where there is no WebGL (returns `gpu: ""`). */
export function sniffMachine(canvas?: HTMLCanvasElement): Machine {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const out: Machine = { gpu: "", webgl2: false, cores: nav?.hardwareConcurrency, memory: nav?.deviceMemory };
  try {
    out.phone = typeof matchMedia === "function" && typeof screen !== "undefined" && matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
  } catch { /* no screen to read */ }
  try {
    const c = canvas ?? document.createElement("canvas");
    const gl2 = c.getContext("webgl2");
    const gl = gl2 ?? c.getContext("webgl");
    if (!gl) return out;
    out.webgl2 = !!gl2;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    out.gpu = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
    if (!canvas) gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* a headless or blocked WebGL reads as no GPU */ }
  return out;
}

/** The tier a machine deserves, from what it says about itself. Unknown hardware lands on mid. */
export function guessQuality(m: Machine): Quality {
  if (!m.gpu) return "low"; // no WebGL at all, or a context that refused: draw the least and hope
  if (WEAK.test(m.gpu) || !m.webgl2) return "low";
  if ((m.memory ?? 8) <= 2 || (m.cores ?? 4) <= 2) return "low";
  // a phone starts on mid at most, whatever its GPU says; FrameBudget steps it down from there if frames still drop
  if (STRONG.test(m.gpu) && (m.memory ?? 8) >= 8 && !m.phone) return "high";
  return "mid";
}

/**
 * Pick the tier: `?quality=low|mid|high` wins and is remembered, then the remembered choice, then the machine.
 * `?quality=auto` forgets the remembered one. Tests pass `search`, `store` and `machine` in; the page passes nothing.
 */
export function pickQuality(opts: { search?: string; store?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null; machine?: Machine } = {}): { quality: Quality; why: "url" | "saved" | "machine" } {
  const search = opts.search ?? (typeof location === "undefined" ? "" : location.search);
  const store = opts.store === undefined ? safeStore() : opts.store;
  const asked = new URLSearchParams(search).get("quality");
  if (asked === "auto") try { store?.removeItem(STORE_KEY); } catch { /* fine */ }
  if (isQuality(asked)) {
    try { store?.setItem(STORE_KEY, asked); } catch { /* private window */ }
    return { quality: asked, why: "url" };
  }
  let saved: string | null = null;
  try { saved = store?.getItem(STORE_KEY) ?? null; } catch { /* blocked */ }
  if (isQuality(saved)) return { quality: saved, why: "saved" };
  return { quality: guessQuality(opts.machine ?? sniffMachine()), why: "machine" };
}

/** Remember a tier for next time (the watchdog's step-down, or a settings toggle). */
export function saveQuality(q: Quality, store: Pick<Storage, "setItem"> | null = safeStore()) {
  try { store?.setItem(STORE_KEY, q); } catch { /* private window */ }
}

function safeStore(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * Counts frames and says "drop" once the game has run under `floorFps` for `patience` seconds straight, after a
 * `warmup` grace (first-load stutter doesn't count). Feed it `tick(now)` each frame; it fires at most once per `reset()`.
 */
export class FrameWatch {
  private start = -1;
  private windowStart = -1;
  private frames = 0;
  private slowSince = -1;
  private fired = false;
  constructor(private floorFps = 24, private patience = 4, private warmup = 3) {}

  /** `now` in ms (performance.now or the rAF timestamp). */
  tick(now: number): "drop" | null {
    if (this.start < 0) { this.start = this.windowStart = now; return null; }
    this.frames++;
    const span = now - this.windowStart;
    if (span < 500) return null; // measure over half-second windows, not frame to frame
    const fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.windowStart = now;
    if (now - this.start < this.warmup * 1000 || this.fired) return null;
    if (fps >= this.floorFps) { this.slowSince = -1; return null; }
    if (this.slowSince < 0) this.slowSince = now;
    if (now - this.slowSince >= this.patience * 1000) { this.fired = true; return "drop"; }
    return null;
  }

  /** Arm it again (after the game stepped down a tier and wants to know if that was enough). */
  reset() { this.start = -1; this.fired = false; this.slowSince = -1; this.frames = 0; }
}

/**
 * Keeps a game on its frame budget, from the gaps between frames: "down" once the 95th percentile of the last `window`
 * seconds has sat over `budget` ms for `patience` seconds straight (past a `warmup`, with a full window measured since the
 * last change, so a burst of loading after a teleport doesn't cost a tier), "up" once the last
 * `calm` seconds had fewer than 1 frame in 100 late (over 25 ms, a missed beat at 60 Hz). A step up that a step down
 * follows within `calm` seconds doubles the calm the next one needs, so a tier that can't hold doesn't flicker. A gap over
 * a second (a hidden tab, a breakpoint) starts the measuring again.
 */
export class FrameBudget {
  private times: number[] = [];
  private gaps: number[] = [];
  private last = -1;
  private since = -1;      // when measuring (re)started: the warm-up, then the time since the last change
  private evalAt = 0;
  private upAt = -Infinity; // when the last step up happened
  private overSince = -1;   // since when every look has found the window over budget
  private calmNow: number;
  constructor(private budget = 18, private window = 3, private warmup = 3, private calm = 20, private patience = 4) { this.calmNow = calm; }

  /** `now` in ms (the rAF timestamp or performance.now), once a frame. */
  tick(now: number): "down" | "up" | null {
    if (this.last < 0 || now - this.last > 1000) { this.restart(now); return null; }
    const gap = now - this.last;
    this.last = now;
    this.times.push(now); this.gaps.push(gap);
    const keep = now - Math.max(this.window, this.calmNow) * 1000;
    let cut = 0;
    while (cut < this.times.length && this.times[cut]! < keep) cut++;
    if (cut) { this.times.splice(0, cut); this.gaps.splice(0, cut); }
    if (now < this.evalAt) return null;
    this.evalAt = now + 500;
    const span = now - this.since;
    if (span < Math.max(this.warmup, this.window) * 1000) return null;
    const recent: number[] = [];
    for (let i = this.times.length - 1; i >= 0 && this.times[i]! >= now - this.window * 1000; i--) recent.push(this.gaps[i]!);
    recent.sort((a, b) => a - b);
    const p95 = recent[Math.min(recent.length - 1, Math.ceil(recent.length * 0.95) - 1)] ?? 0;
    if (p95 > this.budget) {
      if (this.overSince < 0) this.overSince = now;
      if (now - this.overSince < this.patience * 1000) return null;
      if (now - this.upAt < this.calmNow * 1000) this.calmNow = Math.min(this.calmNow * 2, this.calm * 8);
      this.restart(now);
      return "down";
    }
    this.overSince = -1;
    if (span >= this.calmNow * 1000) {
      let late = 0, n = 0;
      for (let i = 0; i < this.times.length; i++) if (this.times[i]! >= now - this.calmNow * 1000) { n++; if (this.gaps[i]! > 25) late++; }
      if (n && late < n / 100) { this.upAt = now; this.restart(now); return "up"; }
    }
    return null;
  }

  private restart(now: number) { this.times = []; this.gaps = []; this.last = now; this.since = now; this.evalAt = 0; this.overSince = -1; }
}

/** The tier above `q`, or null at the top. */
export const stepUp = (q: Quality): Quality | null => (q === "low" ? "mid" : q === "mid" ? "high" : null);

/**
 * The picked tier, held to a frame budget for this visit: FrameBudget steps it down a tier when frames drop and back up
 * when they're calm, never above the tier it started on (the machine's guess, the saved one or `?quality=`) and never
 * remembered, so a hot minute doesn't cost the next visit its looks. Call `tick(now)` once a frame; `onChange` runs
 * after each step so a game can resize what the pixel ratio sizes and thin or thicken its own extras.
 */
export function budgetQuality(renderer: QualityRenderer, lights: ShadowLight[], opts: { onChange?: (q: Quality) => void; budget?: FrameBudget; search?: string; quality?: Quality } = {}) {
  const ceiling = opts.quality ?? pickQuality({ search: opts.search }).quality;
  let quality = ceiling;
  applyQuality(quality, renderer, lights);
  const watch = opts.budget ?? new FrameBudget(), steps: { at: number; to: Quality }[] = [];
  return {
    get quality() { return quality; },
    /** Each step this visit: when (the `now` it was ticked with) and to which tier. */
    steps,
    tick(now: number) {
      const say = watch.tick(now);
      const next = say === "down" ? stepDown(quality) : say === "up" && quality !== ceiling ? stepUp(quality) : null;
      if (!next) return;
      quality = next;
      steps.push({ at: Math.round(now), to: next });
      applyQuality(quality, renderer, lights);
      opts.onChange?.(quality);
    },
  };
}

/** The tier below `q`, or null at the floor. */
export const stepDown = (q: Quality): Quality | null => (q === "high" ? "mid" : q === "mid" ? "low" : null);

// Structural shapes of three's renderer and shadow lights, so this file stays free of three.
export interface QualityRenderer { setPixelRatio(n: number): void; shadowMap: { enabled: boolean; needsUpdate?: boolean } }
export interface ShadowLight { castShadow: boolean; shadow: { mapSize: { set(w: number, h: number): void }; map: { dispose(): void } | null } }

/**
 * Push a tier onto a renderer and its shadow-casting lights: pixel ratio, shadows on or off, shadow map size.
 * Antialias can't change after the context exists, so pass `QUALITY[q].antialias` to the constructor.
 * Returns the settings so the caller can size its own things (scenery budget, anisotropy) the same way.
 */
export function applyQuality(q: Quality, renderer: QualityRenderer, lights: ShadowLight[] = [], dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1) {
  const s = QUALITY[q];
  renderer.setPixelRatio(Math.min(dpr, s.pixelRatio));
  renderer.shadowMap.enabled = s.shadows;
  renderer.shadowMap.needsUpdate = true;
  for (const l of lights) {
    l.castShadow = s.shadows;
    if (s.shadows) l.shadow.mapSize.set(s.shadowMap, s.shadowMap);
    l.shadow.map?.dispose(); // three rebuilds it at the new size on the next frame
    l.shadow.map = null;
  }
  return s;
}

/**
 * Start on the picked tier and drop one tier each time frames stay slow (see FrameWatch), remembering the drop.
 * Call the returned `tick(now)` once per frame. `onChange` runs after each drop so a game can thin its own extras.
 */
export function autoQuality(renderer: QualityRenderer, lights: ShadowLight[], opts: { onChange?: (q: Quality) => void; watch?: FrameWatch; search?: string; quality?: Quality } = {}) {
  let quality = opts.quality ?? pickQuality({ search: opts.search }).quality;
  applyQuality(quality, renderer, lights);
  const watch = opts.watch ?? new FrameWatch();
  return {
    get quality() { return quality; },
    tick(now: number) {
      if (watch.tick(now) !== "drop") return;
      const next = stepDown(quality);
      if (!next) return;
      quality = next;
      applyQuality(quality, renderer, lights);
      saveQuality(quality);
      opts.onChange?.(quality);
      watch.reset();
    },
  };
}
