// What scripts/trailers.ts shoots and how it cuts it: each app's takes (a jump link and a script that plays it) and its reels
// (cuts of 3 s or less from those takes, with looks and captions). Times in a cut are seconds into its take: read them off the
// take's contact sheet (<cache>/<app>/<take>-sheet.jpg, one frame a second) after a `--takes-only` run.

/** One thing a take's script does, `at` seconds after the recording starts (setup steps run in order before it, waiting `after` ms). */
export type Step = ({ js: string } | { key: string; hold?: number; up?: boolean } | { click: [number, number] } | { move: [number, number] }) & { at?: number; after?: number };
/** One recording: where it opens (`url` for a server other than the app's), CSS to hide what a trailer shouldn't show, then `secs` of play. */
export interface Take { name: string; path: string; /** The window, for a page laid out for a bigger screen (scaled down to the reel). */ size?: [number, number]; url?: string; wait?: number; css?: string; setup?: Step[]; steps?: Step[]; secs: number }
/** A piece of a take, 3 s or less: `fx` are push (a slow zoom), punch (a fast one), slow, fast, shake, flash, glitch, mono, dark. */
export type Cut = { take: string; at: number; len?: number; fx?: string[]; say?: string; sub?: string } | { card: string; kicker?: string; line?: string; len?: number; end?: boolean };
export interface Reel { name: string; title: string; cuts: Cut[]; crf?: number }
export interface Stage { /** The app folder it runs from, when not the key (a reel about a part of another app). */ app?: string; serve?: unknown; takes: Take[]; reels: Reel[] }

/** Hides a page's own buttons and panels (the HUD) so only the game's picture is left; `keep` stays. */
const noHud = (keep = "") => `body *:not(canvas):not(:has(canvas))${keep ? `:not(${keep}):not(${keep} *)` : ""}{visibility:hidden !important}`;
const run = (cmd: string, args: unknown) => `return await __commands.run(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`;

/** A take that plays one of a page's director scenes (`?scene=<name>`, @rustybuns/util/director) from its start. */
const scene = (name: string, secs: number, css?: string): Take => ({ name, path: `/?scene=${name}`, secs, wait: 4000, ...(css ? { css } : {}) });

/** A hero pushing forward and firing: W held, a click every `every` s at the middle, strafes and a strike (Q) on the way. */
const assault = (secs: number, every = 0.35): Step[] => [
  { at: 0, click: [480, 270] }, { at: 0.2, key: "KeyW", up: false },
  ...Array.from({ length: Math.floor(secs / every) }, (_, i): Step => ({ at: 0.5 + i * every, click: [480 + Math.round(Math.sin(i) * 30), 270] })),
  { at: secs * 0.3, key: "KeyA", hold: 900 }, { at: secs * 0.45, key: "KeyQ", hold: 100 }, { at: secs * 0.6, key: "KeyD", hold: 900 }, { at: secs - 0.5, key: "KeyW", up: true },
];
const tf = (name: string, q: string, secs: number, play = true): Take => ({ name, path: `/?${q}`, wait: 7000, secs, css: noHud(), ...(play ? { steps: assault(secs) } : {}) });

/** Keys tapped in turn every `every` s over `secs` (a lane game's presses, a walker's turns). */
const taps = (keys: string[], secs: number, every: number, from = 0.3): Step[] =>
  Array.from({ length: Math.floor((secs - from) / every) }, (_, i): Step => ({ at: from + i * every, key: keys[(i * 7 + (i >> 2)) % keys.length]!, hold: Math.round(every * 600) }));
/** Clicks the first button or link whose words start with `text`. */
const press = (text: string): string => `[...document.querySelectorAll("button,a,[role=button]")].find((e) => e.textContent.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}))?.click()`;
const mm = (name: string, q: string, secs: number): Take => ({ name, path: `/?${q}`, wait: 8000, secs, css: noHud() });

export const STAGES: Record<string, Stage> = {
  "mythic-masters": {
    takes: [
      mm("stadium", "a=jackalope&b=jersey-devil&skin=stadium&watch=1", 22),
      mm("volcano", "a=jersey-devil&b=hodag&skin=volcano&watch=1", 22),
      mm("barrens", "a=hodag&b=squonk&skin=pine-barrens&watch=1", 22),
      { name: "world", path: "/?world=1&a=jackalope", wait: 12000, secs: 16, css: noHud(), steps: [{ at: 0, key: "KeyW", up: false }, { at: 5, key: "KeyD", hold: 1200 }, { at: 9, key: "ShiftLeft", hold: 300 }, { at: 11, key: "KeyA", hold: 1000 }, { at: 15.5, key: "KeyW", up: true }] },
      { name: "faceoff", path: "/?scene=faceoff", wait: 9000, secs: 9 },
    ],
    reels: [],
  },
  "park-hide-seek": {
    takes: [
      { name: "seeker", path: "/", wait: 9000, secs: 22, setup: [{ js: "parkHideSeek.start({ role: 'seeker', bots: 5 })", after: 6000 }], steps: [{ at: 0, key: "KeyW", up: false }, ...[2, 6, 10, 14, 18].map((t, i): Step => ({ at: t, key: i % 2 ? "KeyA" : "KeyD", hold: 900 })), { at: 8, key: "ShiftLeft", hold: 2500 }, { at: 21.5, key: "KeyW", up: true }] },
      { name: "hider", path: "/", wait: 9000, secs: 20, setup: [{ js: "parkHideSeek.start({ role: 'hider', bots: 5, tod: 'dusk' })", after: 5000 }], steps: [{ at: 0, key: "KeyW", up: false }, { at: 4, key: "KeyA", hold: 1400 }, { at: 9, key: "ShiftLeft", hold: 3000 }, { at: 14, key: "KeyD", hold: 1000 }, { at: 19, key: "KeyW", up: true }] },
      { name: "night", path: "/", wait: 9000, secs: 18, setup: [{ js: "parkHideSeek.start({ role: 'seeker', bots: 6, tod: 'night' })", after: 6000 }], steps: [{ at: 0, key: "KeyW", up: false }, { at: 5, key: "KeyD", hold: 1500 }, { at: 11, key: "KeyA", hold: 1200 }, { at: 17.5, key: "KeyW", up: true }] },
    ],
    reels: [],
  },
  "alien-disc-golf": {
    takes: [
      { name: "drive", path: "/?seed=42", wait: 7000, secs: 16, steps: [{ at: 0.5, js: "golf.aim(80, 0.95, 0.4); golf.throw()" }] },
      { name: "second", path: "/?seed=7", wait: 7000, secs: 16, steps: [{ at: 0.5, js: "golf.aim(120, 0.9, 0.5); golf.throw()" }, { at: 9, js: "golf.aim(100, 0.7, 0.3); golf.throw()" }] },
      { name: "sea", path: "/?seed=42&swim=36.5,-72", wait: 7000, secs: 12, steps: [{ at: 0.5, js: "golf.seaView?.(true)" }] },
    ],
    reels: [],
  },
  "delayed-reaction": {
    takes: [
      { name: "dub", path: "/?level=5&stem=dub", wait: 6000, secs: 20, setup: [{ js: `document.querySelector("#scenario")?.click()`, after: 2500 }], steps: taps(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], 20, 0.45) },
      { name: "everything", path: "/?level=5", wait: 6000, secs: 20, setup: [{ js: `document.querySelector("#scenario")?.click()`, after: 2500 }], steps: taps(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"], 20, 0.38) },
    ],
    reels: [],
  },
  "splat-spray": {
    takes: [
      { name: "scan", path: "/", wait: 7000, secs: 16, setup: [{ js: press("Solo training"), after: 5000 }], steps: Array.from({ length: 40 }, (_, i): Step => ({ at: 0.2 + i * 0.38, js: `__spy.fireAt(${(0.2 + 0.6 * Math.abs(Math.sin(i * 0.7))).toFixed(2)} * innerWidth, ${(0.3 + 0.4 * Math.abs(Math.cos(i * 0.45))).toFixed(2)} * innerHeight, 0.3)` })) },
    ],
    reels: [],
  },
  "hippo-tycoon": {
    takes: [
      { name: "round", path: "/", wait: 7000, secs: 20, setup: [{ js: press("Solo"), after: 4000 }], steps: taps(["ArrowLeft", "ArrowRight", "Space", "ArrowRight", "ArrowLeft"], 20, 0.5) },
    ],
    reels: [],
  },
  "fm-daw": {
    takes: [
      { name: "gear-room", path: "/studio.html", wait: 7000, secs: 20, css: noHud(), setup: [{ js: press("Walk in"), after: 3000 }], steps: [
        { at: 0, js: "qstudio.look?.(0.4, -0.1)" }, { at: 0.2, key: "KeyW", hold: 2500 }, { at: 3, js: "qstudio.look?.(-0.5, -0.15)" }, { at: 5, key: "KeyD", hold: 1500 }, { at: 8, js: "qstudio.look?.(1.6, -0.2)" }, { at: 9, key: "KeyW", hold: 3000 }, { at: 13, js: "qstudio.look?.(2.8, -0.25)" }, { at: 14, key: "KeyA", hold: 2000 }, { at: 17, js: "qstudio.look?.(3.6, -0.1)" },
      ] },
      { name: "amp", path: "/amp.html", wait: 7000, secs: 16, setup: [{ js: press("Plug in"), after: 1500 }, { js: "await qamp.stage?.(true)", after: 3000 }], steps: [{ at: 2, js: "qamp.pedal?.('q-fuzz')" }, { at: 7, js: "qamp.board?.(true)" }, { at: 12, js: "qamp.board?.(false)" }] },
      { name: "decks", path: "/decks.html", wait: 6000, secs: 16, setup: [{ js: "qdecks.start()", after: 3000 }], steps: [{ at: 0.3, js: "qdecks.play('a')" }, { at: 2, js: "qdecks.play('b'); qdecks.sync('b')" }, { at: 4, js: "await qdecks.scratch('a', 1.5)" }, { at: 7, js: "qdecks.cross(0.8)" }, { at: 9, js: "qdecks.loop('b', 4)" }, { at: 12, js: "qdecks.cross(-0.6)" }] },
      { name: "desk", path: "/", wait: 5000, secs: 12, setup: [{ js: press("Start"), after: 3000 }] },
      { name: "jam", path: "/jam.html", wait: 7000, secs: 18, css: noHud(), setup: [{ js: "await qjam.start?.()", after: 4000 }], steps: [{ at: 0, js: "qjam.walkTo?.(1.5, 1.5)" }, { at: 6, js: "qjam.sit?.()" }, ...taps(["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH"], 18, 0.3, 8)] },
    ],
    reels: [],
  },
  qcrm: {
    takes: [
      { size: [1280, 720], name: "contacts", path: "/app?scenario=populated", wait: 4000, secs: 12, steps: [{ at: 2, js: "scrollBy({ top: 400, behavior: 'smooth' })" }, { at: 5, js: "document.querySelector('tbody tr, li a, [data-contact]')?.click()" }, { at: 9, js: "scrollTo({ top: 0, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "webhooks", path: "/app?scenario=webhooks", wait: 4000, secs: 10, steps: [{ at: 3, js: "scrollBy({ top: 500, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "home", path: "/", wait: 3000, secs: 10, steps: [{ at: 2, js: "scrollBy({ top: 700, behavior: 'smooth' })" }, { at: 6, js: "scrollBy({ top: 700, behavior: 'smooth' })" }] },
    ],
    reels: [],
  },
  geoboxq: {
    takes: [{ size: [1280, 720], name: "home", path: "/", wait: 5000, secs: 12, steps: [{ at: 2, js: "scrollBy({ top: 500, behavior: 'smooth' })" }, { at: 7, js: "scrollBy({ top: 500, behavior: 'smooth' })" }] }],
    reels: [],
  },
  // eqosys's pages as the preview serves them (a made-up person with friends, a party and spaces).
  eqosys: {
    serve: { cmd: ["bun", "scripts/preview-home.tsx", "--serve"], port: "PORT" },
    takes: [
      { size: [1280, 720], name: "library", path: "/?t=90", wait: 3000, secs: 14, steps: [2, 5, 8, 11].map((t): Step => ({ at: t, js: "scrollBy({ top: 420, behavior: 'smooth' })" })) },
      { size: [1280, 720], name: "friends", path: "/?tab=friends", wait: 3000, secs: 8, steps: [{ at: 4, js: "scrollBy({ top: 300, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "trophies", path: "/?tab=achievements", wait: 3000, secs: 8, steps: [{ at: 3, js: "scrollBy({ top: 500, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "studio", path: "/?tab=studio", wait: 3000, secs: 8, steps: [{ at: 3, js: "scrollBy({ top: 400, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "login", path: "/login", wait: 3000, secs: 6 },
      { size: [1280, 720], name: "dusk", path: "/?t=250", wait: 3000, secs: 6 },
    ],
    reels: [],
  },
  // Qollab is eqosys's rooms and parties: its reel is cut from eqosys's pages and Qollab Studio's rooms.
  qollab: { app: "eqosys", takes: [], reels: [] },
  // tscircuit boards as real pedals: the gear room's build sheets and Q Amp's board view (fm-daw).
  tscircuit: {
    app: "fm-daw",
    takes: [
      { name: "sheet", path: "/studio.html", wait: 7000, secs: 16, setup: [{ js: press("Walk in"), after: 3000 }, { js: "const s = qstudio.state(); const p = (s.items ?? []).find((i) => /drive|fuzz|pedal/i.test(JSON.stringify(i))); qstudio.sheet(p?.id ?? 'q-drive')", after: 2500 }], steps: [
        { at: 0, js: "qstudio.sheetTab('schematic')" }, { at: 4, js: "qstudio.sheetTab('pcb')" }, { at: 8, js: "qstudio.sheetTab('parts')" }, { at: 11, js: "qstudio.sheetTab('files')" }, { at: 13.5, js: "await qstudio.sheetBand?.()" },
      ] },
    ],
    reels: [],
  },
  codesplitter: {
    serve: { live: "https://codesplitter.notryanquinn.workers.dev/" },
    takes: [{ size: [1280, 720], name: "home", path: "/", wait: 6000, secs: 14, steps: [2, 5, 8, 11].map((t): Step => ({ at: t, js: "scrollBy({ top: 600, behavior: 'smooth' })" })) }],
    reels: [],
  },
  "two-fronts": {
    takes: [
      tf("orbit", "orbit=1&watch=1&ships=6v6", 24, false),
      tf("city", "battle=1&near=1&world=city", 20),
      tf("forest", "battle=1&near=1", 22),
      tf("horde", "battle=1&near=1&side=wooka", 22),
      tf("desert", "battle=1&near=1&world=desert", 20),
      tf("beach", "battle=1&near=1&world=beach&side=wooka", 20),
    ],
    // The captions are the Thunder Marines' radio (content/radio.json).
    reels: [
      { name: "not-cuddly", title: "Not cuddly", crf: 29, cuts: [
        { card: "Doren, the forest moon", kicker: "Thunder Marines", line: "Orders: clear out a few knee-high locals.", len: 2.2 },
        { take: "forest", at: 0.3, len: 2.4, fx: ["push"], say: "Something in the ferns is humming" },
        { take: "horde", at: 0.4, len: 2.6, fx: ["punch"], say: "They are not cuddly", sub: "Do not attempt to cuddle" },
        { take: "horde", at: 3, len: 2.2, fx: ["slow", "shake"] },
        { take: "orbit", at: 3, len: 2.2, fx: ["push", "flash"], say: "Meanwhile, in orbit" },
        { take: "city", at: 11, len: 2.4, fx: ["shake"], say: "That club has a nail in it", sub: "On purpose" },
        { take: "horde", at: 8.6, len: 1.8, fx: ["punch", "glitch"] },
        { take: "orbit", at: 9.6, len: 1.8, fx: ["shake"] },
        { take: "desert", at: 14, len: 2.2, fx: ["punch"], say: "Two eyes in the ferns", sub: "then six. then none, which is worse" },
        { take: "city", at: 15, len: 2.4, fx: ["slow", "flash"], say: "Call down the strike" },
        { take: "beach", at: 9.2, len: 2.2, fx: ["push"] },
        { take: "beach", at: 16, len: 1.8, fx: ["shake", "flash"] },
        { take: "orbit", at: 20, len: 2.2, fx: ["punch"] },
        { take: "horde", at: 15.2, len: 2.4, fx: ["push"], say: "If you hear giggling", sub: "it's already too late" },
        { card: "Two Fronts", kicker: "Thunderwooka Saga", line: "The Wooka came with a furry ferocity unseen by the likes of man.", end: true, len: 2.4 },
      ] },
      { name: "orbit", title: "The orbit", cuts: [
        { take: "orbit", at: 0.5, len: 2.6, fx: ["push"] },
        { take: "orbit", at: 4, len: 2.2, fx: ["punch"], say: "Hold the orbit" },
        { take: "orbit", at: 9.6, len: 2, fx: ["shake", "flash"] },
        { take: "orbit", at: 14, len: 2.4, fx: ["slow"] },
        { take: "orbit", at: 19.6, len: 2.4, fx: ["push"], say: "Fly it yourself", sub: "or let the AI finish it" },
        { card: "Two Fronts", kicker: "A war on two fronts", end: true },
      ] },
      { name: "the-horde", title: "Be the horde", cuts: [
        { take: "horde", at: 0.2, len: 2.4, fx: ["push"], say: "Be the horde" },
        { take: "horde", at: 2.6, len: 2.6, fx: ["slow", "punch"] },
        { take: "beach", at: 9.3, len: 2.2, fx: ["push"], say: "Knee-high", sub: "and extremely motivated" },
        { take: "desert", at: 14.2, len: 2.2, fx: ["shake"] },
        { take: "horde", at: 9, len: 2, fx: ["flash"] },
        { take: "beach", at: 16, len: 2, fx: ["punch"] },
        { card: "Two Fronts", kicker: "Play the Wooka", end: true },
      ] },
      { name: "hold-the-line", title: "Hold the line", cuts: [
        { take: "forest", at: 0.2, len: 2.6, fx: ["push"], say: "Hold the line" },
        { take: "city", at: 0.4, len: 2.4, fx: ["push"] },
        { take: "city", at: 11.2, len: 2, fx: ["shake", "flash"], say: "Intel called them harmless", sub: "intel has stopped answering" },
        { take: "desert", at: 6, len: 2.4, fx: ["push"] },
        { take: "city", at: 15.4, len: 2.2, fx: ["slow"] },
        { card: "Two Fronts", kicker: "Thunder Marines", end: true },
      ] },
      { name: "radio", title: "Radio chatter", cuts: [
        { take: "forest", at: 2, len: 2.2, fx: ["mono", "push"], say: "Do not feed them" },
        { take: "horde", at: 4, len: 2.2, fx: ["mono", "punch"], say: "Do not make eye contact" },
        { take: "city", at: 12, len: 2.2, fx: ["mono", "shake"], say: "Keep them off the backpacks" },
        { take: "beach", at: 10, len: 2.4, fx: ["mono", "push"], say: "They've started singing", sub: "nobody likes it when they sing" },
        { card: "Two Fronts", kicker: "Thunderwooka Saga", end: true },
      ] },
    ],
  },
  "git-recon": {
    takes: [
      scene("newsreel", 30), scene("credits", 30),
      ...["kitchen"].map((level): Take => ({ name: level, path: "/", wait: 5000, secs: 22, setup: [{ js: run("recon_start", { level }), after: 4000 }], steps: [
        { at: 0, key: "KeyW", up: false }, ...Array.from({ length: 40 }, (_, i): Step => ({ at: 0.3 + i * 0.5, js: i % 8 === 4 ? `${run("recon_look", { yaw: (i / 8) * 1.3, pitch: -0.05 })}` : i % 11 === 6 ? run("recon_jump", {}) : run("recon_fire", {}) })),
        { at: 6, key: "KeyA", hold: 1200 }, { at: 12, key: "KeyD", hold: 1500 }, { at: 21, key: "KeyW", up: true },
      ] })),
    ],
    reels: [
      { name: "war-for-main", title: "The war for main", crf: 29, cuts: [
        { card: "Somewhere in a real repo", kicker: "rustybuns@288aec0", line: "eight folders are in conflict.", len: 2 },
        { take: "newsreel", at: 0.2, len: 2.2, fx: ["push"] },
        { take: "kitchen", at: 0.2, len: 2.6, fx: ["punch"] },
        { take: "kitchen", at: 2.2, len: 2.4, fx: ["slow"], say: "Geronimo", sub: "a regrettable commit message" },
        { take: "kitchen", at: 4.6, len: 1.6, fx: ["shake", "flash"] },
        { take: "newsreel", at: 4.1, len: 2, fx: ["punch"] },
        { take: "kitchen", at: 8, len: 2.2, fx: ["push"], say: "Merge every folder" },
        { take: "newsreel", at: 6.2, len: 1.4, fx: ["shake", "glitch"] },
        { take: "kitchen", at: 13, len: 2, fx: ["fast", "punch"], say: "Resolve on sight" },
        { take: "newsreel", at: 7.4, len: 2.4, fx: ["push"] },
        { take: "newsreel", at: 9.2, len: 2.2, fx: ["punch", "flash"] },
        { take: "kitchen", at: 17, len: 1.8, fx: ["fast", "shake"] },
        { take: "newsreel", at: 13.2, len: 2.4, fx: ["flash", "shake"] },
        { take: "credits", at: 8, len: 2.6, fx: ["push"], say: "Outtakes included", sub: "take 4: nobody tied off the ladder" },
        { take: "newsreel", at: 11.2, len: 2.6, fx: ["push"] },
        { card: "Git Recon", kicker: "A shooter in a real repo", line: "Home to HEAD by six.", end: true, len: 2.2 },
      ] },
      { name: "boot-camp", title: "Boot camp", cuts: [
        { take: "kitchen", at: 0.3, len: 2.4, fx: ["push"] },
        { take: "kitchen", at: 2.3, len: 2.2, fx: ["slow", "flash"], say: "Your stop" },
        { take: "kitchen", at: 5, len: 1.8, fx: ["shake"] },
        { take: "kitchen", at: 9, len: 2.4, fx: ["push"], say: "0 of 6 merged", sub: "the clock is running" },
        { take: "kitchen", at: 15, len: 2, fx: ["fast", "punch"] },
        { card: "Git Recon", kicker: "Boot camp: the kitchen floor", end: true },
      ] },
      { name: "newsreel", title: "Newsreel", cuts: [
        { take: "newsreel", at: 0, len: 2.4, fx: ["mono", "push"] },
        { take: "newsreel", at: 4, len: 2.4, fx: ["mono", "punch"] },
        { take: "newsreel", at: 7.3, len: 2.6, fx: ["mono"] },
        { take: "newsreel", at: 9.2, len: 2.2, fx: ["mono", "punch"] },
        { take: "newsreel", at: 13, len: 2.6, fx: ["mono", "shake"] },
        { card: "A message from Command", kicker: "Git Recon", line: "Your branch needs you.", end: true },
      ] },
      { name: "outtakes", title: "Outtakes", cuts: [
        { take: "credits", at: 2.5, len: 2.4, fx: ["push"], say: "Blooper reel" },
        { take: "credits", at: 6, len: 2.6, fx: ["push"] },
        { take: "credits", at: 9.5, len: 2.6, fx: ["punch"], say: "Somebody dropped the prop" },
        { take: "credits", at: 13, len: 2.4, fx: ["push"] },
        { card: "Git Recon", kicker: "Thank you for your service", end: true },
      ] },
      { name: "drop-in", title: "Drop in", cuts: [
        { take: "kitchen", at: 1.2, len: 1.6, fx: ["punch"] },
        { take: "kitchen", at: 2.4, len: 2.8, fx: ["slow", "push"] },
        { take: "kitchen", at: 4.8, len: 1.6, fx: ["flash", "shake"], say: "Boots on the floor" },
        { take: "kitchen", at: 11, len: 2.2, fx: ["push"] },
        { card: "Git Recon", end: true },
      ] },
    ],
  },
  "skate-tech-park": {
    takes: [
      { name: "halfpipe", path: "/?level=yosemite-falls&spawn=creek%20halfpipe&nosweep", css: noHud(), secs: 16, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.5, push: 1, jets: true }, { seconds: 1.2, push: 1, jets: true }, { seconds: 1.2, ollie: true, trick: "tre flip" }, { seconds: 1.5, push: 1, jets: true },
        { seconds: 1.2, ollie: true, manual: "tail", steer: 1 }, { seconds: 1.5, push: 1, jets: true }, { seconds: 1.4, ollie: true, trick: "360 hardflip" }, { seconds: 1.5, push: 1, jets: true },
        { seconds: 1.4, ollie: true, trick: "nightmare flip" }, { seconds: 2, push: 1 },
      ] }) }] },
      { name: "capitan", path: "/?level=el-capitan&nosweep", css: noHud(), secs: 14, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 3, push: 1, jets: true }, { seconds: 1.5, ollie: true, trick: "double kickflip" }, { seconds: 2.5, push: 1, jets: true }, { seconds: 1.6, ollie: true, trick: "laser flip", steer: 1 }, { seconds: 3, push: 1 },
      ] }) }] },
      { name: "rail", path: "/?level=el-capitan&spawn=rail&nosweep", css: noHud(), secs: 12, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.5, push: 1 }, { seconds: 0.4, ollie: true }, { seconds: 2.5, push: 0.3 }, { seconds: 1.2, ollie: true, trick: "kickflip" }, { seconds: 3, push: 1 },
      ] }) }] },
    ],
    reels: [
      { name: "send-it", title: "Send it", cuts: [
        { take: "halfpipe", at: 2, len: 2.2, fx: ["push"] },
        { take: "halfpipe", at: 4, len: 2.4, fx: ["slow", "flash"], say: "Tre flip" },
        { take: "capitan", at: 3, len: 2.6, fx: ["punch"], say: "El Capitan", sub: "Yosemite" },
        { take: "halfpipe", at: 9, len: 2.6, fx: ["slow", "shake"], say: "360 hardflip" },
        { take: "rail", at: 1, len: 2.6, fx: ["push"] },
        { card: "Skate Tech Park", kicker: "Fingerboard National Parks", end: true },
      ] },
    ],
  },
};
