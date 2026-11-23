// What scripts/trailers.ts shoots and how it cuts it: each app's takes (a jump link and a script that plays it) and its reels
// (cuts of 3 s or less from those takes, with looks and captions). Times in a cut are seconds into its take: read them off the
// take's contact sheet (<cache>/<app>/<take>-sheet.jpg, one frame a second) after a `--takes-only` run.

/** One thing a take's script does, `at` seconds after the recording starts (setup steps run in order before it, waiting `after` ms). */
export type Step = ({ js: string } | { key: string; hold?: number; up?: boolean } | { click: [number, number] } | { move: [number, number] } | { sweep: [number, number, number, number]; ms: number }) & { at?: number; after?: number };
/** One recording: where it opens (`url` for a server other than the app's), CSS to hide what a trailer shouldn't show, then `secs` of play. */
export interface Take { name: string; path: string; /** The window, for a page laid out for a bigger screen (scaled down to the reel). */ size?: [number, number]; url?: string; wait?: number; css?: string; setup?: Step[]; steps?: Step[]; secs: number }
/** A piece of a take, 3 s or less: `fx` are push (a slow zoom), punch (a fast one), slow, fast, shake, flash, glitch, mono, dark. */
export type Cut = { take: string; at: number; len?: number; fx?: string[]; say?: string; sub?: string } | { card: string; kicker?: string; line?: string; code?: string; len?: number; end?: boolean };
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
    // The captions are the Book's own lines (src/demand.ts): it keeps the ledger of the cryptids it wants.
    reels: [
      { name: "the-ledger", title: "The ledger", crf: 29, cuts: [
        { card: "Sign here", kicker: "The Book", line: "Three cryptids up front, the rest on account.", len: 2 },
        { take: "stadium", at: 0.4, len: 2.4, fx: ["push"], say: "Jackalope", sub: "vs the Jersey Devil" },
        { take: "stadium", at: 3, len: 2, fx: ["punch", "flash"] },
        { take: "volcano", at: 0.5, len: 2.2, fx: ["push"], say: "Hodag" },
        { take: "volcano", at: 6.2, len: 2.2, fx: ["slow", "shake"] },
        { take: "barrens", at: 2, len: 2.4, fx: ["push"], say: "Squonk", sub: "Pine Barrens" },
        { take: "stadium", at: 8.2, len: 2, fx: ["punch", "glitch"] },
        { take: "volcano", at: 12, len: 2, fx: ["shake"] },
        { take: "barrens", at: 15.8, len: 2, fx: ["punch", "flash"] },
        { take: "stadium", at: 19.4, len: 2.6, fx: ["slow", "flash", "shake"], say: "Bind it" },
        { take: "world", at: 2, len: 2.6, fx: ["push"], say: "Walk the world", sub: "64 regions" },
        { card: "Mythic Masters", kicker: "Item 4: something with wings", line: "Name unknown. Your problem. Bring it.", end: true, len: 2.4 },
      ] },
      { name: "stadium", title: "The Cryptid Cup", cuts: [
        { take: "stadium", at: 0.3, len: 2.4, fx: ["push"], say: "The Cryptid Cup" },
        { take: "stadium", at: 8.2, len: 2, fx: ["punch"] },
        { take: "stadium", at: 14, len: 2.2, fx: ["push"] },
        { take: "stadium", at: 19.4, len: 2.6, fx: ["slow", "flash", "shake"], say: "Knockout" },
        { card: "Mythic Masters", kicker: "The Book is watching", end: true },
      ] },
      { name: "volcano", title: "Volcano", cuts: [
        { take: "volcano", at: 0.3, len: 2.4, fx: ["push"], say: "Jersey Devil vs Hodag" },
        { take: "volcano", at: 6.4, len: 2, fx: ["punch", "flash"] },
        { take: "volcano", at: 11, len: 2.4, fx: ["slow", "shake"] },
        { take: "volcano", at: 14.4, len: 2.2, fx: ["punch"], say: "Off the ring" },
        { card: "Mythic Masters", kicker: "76 creatures from old stories", end: true },
      ] },
      { name: "pine-barrens", title: "Pine Barrens", cuts: [
        { take: "barrens", at: 0.5, len: 2.6, fx: ["push"], say: "Pine Barrens", sub: "New Jersey" },
        { take: "barrens", at: 6, len: 2.2, fx: ["punch"] },
        { take: "barrens", at: 15.6, len: 2.4, fx: ["slow", "flash"], say: "Hodag vs Squonk" },
        { take: "world", at: 6, len: 2.6, fx: ["push"], say: "Out there", sub: "something is watching" },
        { card: "Mythic Masters", kicker: "Hunt. Bind. Fight.", end: true },
      ] },
      { name: "faceoff", title: "Face-off", cuts: [
        { take: "faceoff", at: 0.3, len: 2.6, fx: ["push"] },
        { take: "faceoff", at: 3, len: 2.6, fx: ["punch"] },
        { take: "stadium", at: 3, len: 2, fx: ["flash", "shake"] },
        { take: "volcano", at: 6.2, len: 2, fx: ["punch"] },
        { card: "Mythic Masters", kicker: "Practice. I keep no accounts of practice.", end: true },
      ] },
    ],
  },
  "park-hide-seek": {
    takes: [
      { name: "seeker", path: "/", wait: 9000, css: noHud(), secs: 22, setup: [{ js: "parkHideSeek.start({ role: 'seeker', bots: 5 })", after: 46000 }], steps: [{ at: 0, key: "KeyW", up: false }, ...[2, 6, 10, 14, 18].map((t, i): Step => ({ at: t, key: i % 2 ? "KeyA" : "KeyD", hold: 900 })), { at: 8, key: "ShiftLeft", hold: 2500 }, { at: 21.5, key: "KeyW", up: true }] },
      { name: "hider", path: "/", wait: 9000, css: noHud(), secs: 20, setup: [{ js: "parkHideSeek.start({ role: 'hider', bots: 5, tod: 'dusk' })", after: 16000 }], steps: [{ at: 0, key: "KeyW", up: false }, { at: 4, key: "KeyA", hold: 1400 }, { at: 9, key: "ShiftLeft", hold: 3000 }, { at: 14, key: "KeyD", hold: 1000 }, { at: 19, key: "KeyW", up: true }] },
      { name: "night", path: "/", wait: 9000, css: noHud(), secs: 18, setup: [{ js: "parkHideSeek.start({ role: 'seeker', bots: 6, tod: 'night' })", after: 46000 }], steps: [{ at: 0, key: "KeyW", up: false }, { at: 5, key: "KeyD", hold: 1500 }, { at: 11, key: "KeyA", hold: 1200 }, { at: 17.5, key: "KeyW", up: true }] },
    ],
    reels: [
      { name: "find-the-campers", title: "Find the campers", crf: 29, cuts: [
        { card: "Ready or not", kicker: "Park Hide Seek", line: "Rangers count to thirty in the cabin.", len: 1.8 },
        { take: "hider", at: 0.5, len: 2.6, fx: ["push"], say: "Hide", sub: "in America's national parks" },
        { take: "hider", at: 5, len: 2.2, fx: ["punch"] },
        { take: "seeker", at: 1, len: 2.4, fx: ["push", "flash"], say: "Seek" },
        { take: "seeker", at: 8.5, len: 2.2, fx: ["fast", "shake"] },
        { take: "night", at: 2, len: 2.4, fx: ["push"], say: "After dark" },
        { take: "hider", at: 11, len: 2.2, fx: ["slow"] },
        { take: "seeker", at: 15, len: 2.4, fx: ["punch"], say: "Find Sasquatch", sub: "to score big" },
        { card: "Park Hide Seek", kicker: "All ages", line: "Hide and seek with friends or computers.", end: true },
      ] },
      { name: "hide", title: "Hide", cuts: [
        { take: "hider", at: 0.5, len: 2.6, fx: ["push"], say: "Find somewhere to hide" },
        { take: "hider", at: 6, len: 2.4, fx: ["push"] },
        { take: "hider", at: 12, len: 2.4, fx: ["slow"], say: "Crouch in a bush" },
        { card: "Park Hide Seek", kicker: "Be the camper", end: true },
      ] },
      { name: "seek", title: "Seek", cuts: [
        { take: "seeker", at: 0.5, len: 2.6, fx: ["push"], say: "Be the ranger" },
        { take: "seeker", at: 8, len: 2.2, fx: ["fast"] },
        { take: "night", at: 6, len: 2.6, fx: ["push"], say: "Tag them all" },
        { card: "Park Hide Seek", kicker: "Those darn renegade campers", end: true },
      ] },
    ],
  },
  "alien-disc-golf": {
    takes: [
      { name: "drive", path: "/?seed=42", wait: 7000, secs: 16, setup: [{ js: `document.querySelector("#tee-off")?.click()`, after: 3000 }], steps: [{ at: 0.5, js: "golf.aim(80, 0.95, 0.4); golf.throw()" }] },
      { name: "second", path: "/?seed=7", wait: 7000, secs: 16, setup: [{ js: `document.querySelector("#tee-off")?.click()`, after: 3000 }], steps: [{ at: 0.5, js: "golf.aim(120, 0.9, 0.5); golf.throw()" }, { at: 9, js: "golf.aim(100, 0.7, 0.3); golf.throw()" }] },
      { name: "sea", path: "/?seed=42&swim=36.5,-72", wait: 7000, secs: 12, steps: [{ at: 0.5, js: "golf.seaView?.(true)" }] },
    ],
    reels: [
      { name: "fore", title: "Fore", cuts: [
        { card: "Earth is the course", kicker: "Alien Disc Golf", line: "Nine holes. Every continent.", len: 1.8 },
        { take: "drive", at: 0.2, len: 2.4, fx: ["push"], say: "Tee off from orbit" },
        { take: "drive", at: 3, len: 2.6, fx: ["slow", "flash"] },
        { take: "second", at: 3.5, len: 2.4, fx: ["push"], say: "Real wind", sub: "NOAA's forecast, live" },
        { take: "sea", at: 0.5, len: 2.6, fx: ["push"], say: "Overboard", sub: "paddle!" },
        { take: "second", at: 10, len: 2.4, fx: ["punch"] },
        { card: "Alien Disc Golf", kicker: "Planet Earth", end: true },
      ] },
      { name: "the-drift", title: "The drift", cuts: [
        { take: "sea", at: 0.3, len: 2.6, fx: ["push"], say: "Land in the sea" },
        { take: "sea", at: 4, len: 2.6, fx: ["slow"], say: "The current takes you" },
        { take: "drive", at: 6, len: 2.4, fx: ["push"] },
        { card: "Alien Disc Golf", kicker: "Mind the water", end: true },
      ] },
      { name: "long-drive", title: "Long drive", cuts: [
        { take: "second", at: 0.3, len: 2.6, fx: ["push"], say: "Wind up" },
        { take: "second", at: 2.8, len: 2.6, fx: ["slow", "shake"], say: "Let it fly" },
        { take: "drive", at: 8, len: 2.4, fx: ["push"] },
        { card: "Alien Disc Golf", kicker: "Thousands of kilometres a throw", end: true },
      ] },
    ],
  },
  "delayed-reaction": {
    takes: [
      { name: "dub", path: "/?level=5&stem=dub", wait: 6000, secs: 20, setup: [{ js: `document.querySelector("#scenario")?.click()`, after: 2500 }], steps: taps(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], 20, 0.45) },
      { name: "everything", path: "/?level=5", wait: 6000, secs: 20, setup: [{ js: `document.querySelector("#scenario")?.click()`, after: 2500 }], steps: taps(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"], 20, 0.38) },
    ],
    reels: [
      { name: "the-vortex", title: "The vortex", crf: 34, cuts: [
        { take: "everything", at: 0.2, len: 2.2, fx: ["push"], say: "Listen" },
        { take: "everything", at: 2.4, len: 2, fx: ["punch", "flash"], say: "React" },
        { take: "dub", at: 3, len: 2.2, fx: ["push"] },
        { take: "everything", at: 6.5, len: 2.4, fx: ["slow"], say: "Late is on time" },
        { take: "dub", at: 8, len: 2, fx: ["punch", "glitch"] },
        { take: "everything", at: 10, len: 2, fx: ["push", "flash"] },
        { card: "Delayed Reaction", kicker: "Rhythm, through the delay vortex", end: true },
      ] },
      { name: "drop", title: "The drop", crf: 34, cuts: [
        { take: "dub", at: 0.5, len: 2.4, fx: ["push"], say: "Wait for it" },
        { take: "dub", at: 4, len: 2.2, fx: ["punch", "flash"] },
        { take: "everything", at: 7, len: 2.4, fx: ["slow", "glitch"] },
        { take: "dub", at: 9, len: 2, fx: ["shake"] },
        { card: "Delayed Reaction", kicker: "Four lanes, one beat", end: true },
      ] },
      { name: "colors", title: "Colors", crf: 34, cuts: [
        { take: "everything", at: 1, len: 2.6, fx: ["push"] },
        { take: "everything", at: 4.4, len: 2.4, fx: ["push"] },
        { take: "everything", at: 8.6, len: 2.6, fx: ["slow"] },
        { card: "Delayed Reaction", end: true },
      ] },
    ],
  },
  "splat-spray": {
    takes: [
      { name: "scan", path: "/", wait: 7000, secs: 16, css: noHud(), setup: [{ js: press("Solo training"), after: 5000 }], steps: [[200, 220, 760, 300], [760, 360, 180, 260], [300, 160, 700, 420], [820, 200, 240, 400], [240, 300, 720, 180], [600, 420, 300, 150]].map((sweep, i): Step => ({ at: 0.3 + i * 2.6, sweep: sweep as [number, number, number, number], ms: 2300 })) },
    ],
    reels: [
      { name: "i-spy", title: "I spy", cuts: [
        { card: "I spy", kicker: "Super Spy Splat Shot", line: "...something red, in the dark.", len: 1.8 },
        { take: "scan", at: 0.4, len: 2.4, fx: ["push"], say: "Light up the room" },
        { take: "scan", at: 3.2, len: 2.4, fx: ["punch"] },
        { take: "scan", at: 6, len: 2.4, fx: ["slow"], say: "Fewest scans wins" },
        { take: "scan", at: 11, len: 2.4, fx: ["push", "flash"] },
        { card: "Super Spy Splat Shot", kicker: "Scan, then pick", end: true },
      ] },
      { name: "scan", title: "Scan", cuts: [
        { take: "scan", at: 1, len: 2.6, fx: ["push"] },
        { take: "scan", at: 8.5, len: 2.6, fx: ["slow"], say: "Everything moves" },
        { take: "scan", at: 13, len: 2.4, fx: ["punch"] },
        { card: "Super Spy Splat Shot", end: true },
      ] },
    ],
  },
  "hippo-tycoon": {
    takes: [
      { name: "round", path: "/", wait: 7000, secs: 20, setup: [{ js: press("Solo"), after: 4000 }], steps: taps(["ArrowLeft", "ArrowRight", "Space", "ArrowRight", "ArrowLeft"], 20, 0.5) },
    ],
    reels: [
      { name: "oil-rush", title: "Oil rush", cuts: [
        { card: "Four hippos", kicker: "Hippo Tycoon", line: "One oil geyser. No manners.", len: 1.8 },
        { take: "round", at: 5, len: 2.4, fx: ["push"], say: "Chomp the oil" },
        { take: "round", at: 12.4, len: 2.2, fx: ["punch", "flash"], say: "Watered down!" },
        { take: "round", at: 15, len: 2.4, fx: ["shake"], say: "Gold is worth the most" },
        { take: "round", at: 18, len: 2, fx: ["punch"] },
        { card: "Hippo Tycoon", kicker: "Solo, couch, LAN or online", end: true },
      ] },
      { name: "greedy", title: "Greedy", cuts: [
        { take: "round", at: 6, len: 2.4, fx: ["push"] },
        { take: "round", at: 10, len: 2.4, fx: ["slow"], say: "*cough*" },
        { take: "round", at: 16.5, len: 2.4, fx: ["punch", "shake"] },
        { card: "Hippo Tycoon", kicker: "Stay away from the sludge", end: true },
      ] },
      { name: "geyser", title: "The geyser", cuts: [
        { take: "round", at: 3, len: 2.6, fx: ["push"] },
        { take: "round", at: 13, len: 2.4, fx: ["push"], say: "Most oil wins" },
        { card: "Hippo Tycoon", end: true },
      ] },
    ],
  },
  "fm-daw": {
    takes: [
      { name: "gear-room", path: "/studio.html", wait: 7000, secs: 20, css: noHud(), setup: [{ js: press("Walk in"), after: 3000 }], steps: [
        { at: 0, js: "qstudio.look?.(0.4, -0.1)" }, { at: 0.2, key: "KeyW", hold: 2500 }, { at: 3, js: "qstudio.look?.(-0.5, -0.15)" }, { at: 5, key: "KeyD", hold: 1500 }, { at: 8, js: "qstudio.look?.(1.6, -0.2)" }, { at: 9, key: "KeyW", hold: 3000 }, { at: 13, js: "qstudio.look?.(2.8, -0.25)" }, { at: 14, key: "KeyA", hold: 2000 }, { at: 17, js: "qstudio.look?.(3.6, -0.1)" },
      ] },
      { name: "amp", path: "/amp.html", wait: 7000, secs: 16, setup: [{ js: press("Plug in"), after: 1500 }, { js: "await qamp.stage?.(true)", after: 3000 }], steps: [{ at: 2, js: "qamp.pedal?.('q-fuzz')" }, { at: 7, js: "qamp.board?.(true)" }, { at: 12, js: "qamp.board?.(false)" }] },
      { name: "decks", path: "/decks.html", wait: 6000, secs: 16, setup: [{ js: "qdecks.start()", after: 3000 }], steps: [{ at: 0.3, js: "qdecks.play('a')" }, { at: 2, js: "qdecks.play('b'); qdecks.sync('b')" }, { at: 4, js: "await qdecks.scratch('a', 1.5)" }, { at: 7, js: "qdecks.cross(0.8)" }, { at: 9, js: "qdecks.loop('b', 4)" }, { at: 12, js: "qdecks.cross(-0.6)" }] },
      { name: "jam", path: "/jam.html", wait: 7000, secs: 18, css: noHud() + "#menu{display:none !important}", setup: [{ js: "await qjam.start?.()", after: 4000 }], steps: [{ at: 0, js: "qjam.walkTo?.(1.5, 1.5)" }, { at: 6, js: "qjam.sit?.()" }, ...taps(["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH"], 18, 0.3, 8)] },
    ],
    // Qollab Studio: FM DAW's rooms (the gear room, the jam room), Q Amp and the decks.
    reels: [
      { name: "the-studio", title: "Qollab Studio", crf: 29, cuts: [
        { card: "A studio you walk into", kicker: "Qollab Studio", line: "With your band, from anywhere.", len: 2 },
        { take: "gear-room", at: 0.3, len: 2.6, fx: ["push"], say: "The gear room" },
        { take: "gear-room", at: 3.4, len: 2.2, fx: ["push"] },
        { take: "amp", at: 2, len: 2, fx: ["punch"], say: "Amps simulated", sub: "part by part" },
        { take: "gear-room", at: 6.6, len: 2.4, fx: ["push"], say: "Pedals on the wall" },
        { take: "amp", at: 8.4, len: 2, fx: ["punch", "flash"] },
        { take: "jam", at: 1, len: 2.6, fx: ["push"], say: "The jam room" },
        { take: "jam", at: 6.5, len: 2.4, fx: ["push"], say: "Sit at a seat, play its track" },
        { take: "decks", at: 2, len: 2.2, fx: ["push"], say: "Two decks and a mixer" },
        { take: "tscircuit/sheet", at: 4.5, len: 2.4, fx: ["push"], say: "Real boards", sub: "order the pedal you played" },
        { take: "gear-room", at: 16.5, len: 2.4, fx: ["push"], say: "Clear amps", sub: "so the tubes show" },
        { take: "jam", at: 11, len: 2.4, fx: ["punch"] },
        { card: "Qollab Studio", kicker: "Play, mix and jam together", line: "Everyone hears the same beat.", end: true, len: 2.4 },
      ] },
      { name: "gear-room", title: "The gear room", cuts: [
        { take: "gear-room", at: 0.3, len: 2.6, fx: ["push"], say: "Walk in" },
        { take: "gear-room", at: 5, len: 2.4, fx: ["push"] },
        { take: "gear-room", at: 16.5, len: 2.6, fx: ["push"], say: "Cable it up" },
        { take: "amp", at: 2, len: 2.2, fx: ["punch"] },
        { card: "Qollab Studio", kicker: "The gear room", end: true },
      ] },
      { name: "jam", title: "The jam room", cuts: [
        { take: "jam", at: 0.5, len: 2.6, fx: ["push"], say: "Your avatar, your seat" },
        { take: "jam", at: 6.5, len: 2.6, fx: ["push"] },
        { take: "jam", at: 12, len: 2.6, fx: ["punch"], say: "Jam live" },
        { card: "Qollab Studio", kicker: "The jam room", end: true },
      ] },
    ],
  },
  qcrm: {
    takes: [
      { size: [1280, 720], name: "contacts", path: "/app?scenario=populated", wait: 4000, secs: 12, steps: [{ at: 2, js: "scrollBy({ top: 400, behavior: 'smooth' })" }, { at: 5, js: "document.querySelector('tbody tr, li a, [data-contact]')?.click()" }, { at: 9, js: "scrollTo({ top: 0, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "webhooks", path: "/app?scenario=webhooks", wait: 4000, secs: 10, steps: [{ at: 3, js: "scrollBy({ top: 500, behavior: 'smooth' })" }] },
      { size: [1280, 720], name: "home", path: "/", wait: 3000, secs: 10, steps: [{ at: 2, js: "scrollBy({ top: 700, behavior: 'smooth' })" }, { at: 6, js: "scrollBy({ top: 700, behavior: 'smooth' })" }] },
    ],
    reels: [
      { name: "contacts", title: "Your contacts", cuts: [
        { card: "qCRM", kicker: "For small teams", line: "Your people, your deals, your scripts.", len: 1.8 },
        { take: "home", at: 0.3, len: 2.4, fx: ["push"] },
        { take: "contacts", at: 0.5, len: 2.6, fx: ["push"], say: "Every contact" },
        { take: "contacts", at: 5.5, len: 2.6, fx: ["punch"], say: "Edit in place" },
        { take: "webhooks", at: 1, len: 2.4, fx: ["push"], say: "Webhooks built in" },
        { card: "qCRM", kicker: "Sign in with eqosys", end: true },
      ] },
      { name: "automate", title: "Automate it", cuts: [
        { take: "webhooks", at: 0.5, len: 2.6, fx: ["push"], say: "Hook it up" },
        { take: "webhooks", at: 4, len: 2.4, fx: ["push"] },
        { take: "home", at: 4, len: 2.6, fx: ["push"], say: "Scripts, engines, insights" },
        { card: "qCRM", end: true },
      ] },
    ],
  },
  geoboxq: {
    takes: [{ size: [1280, 720], name: "home", path: "/", wait: 5000, secs: 12, steps: [{ at: 2, js: "scrollBy({ top: 500, behavior: 'smooth' })" }, { at: 7, js: "scrollBy({ top: 500, behavior: 'smooth' })" }] }],
    reels: [
      { name: "fits", title: "What fits", cuts: [
        { card: "Which box?", kicker: "GeoBoxQ", line: "Add your boxes and products. It tells you which box they all fit in.", len: 2.2 },
        { take: "home", at: 0.3, len: 2.6, fx: ["push"], say: "Your boxes" },
        { take: "home", at: 3, len: 2.6, fx: ["push"], say: "Your products" },
        { take: "home", at: 8, len: 2.6, fx: ["punch"], say: "Fits in Small" },
        { card: "GeoBoxQ", kicker: "A packing helper for qCRM", end: true },
      ] },
      { name: "pack", title: "Pack it", cuts: [
        { take: "home", at: 2.5, len: 2.6, fx: ["push"] },
        { take: "home", at: 9, len: 2.6, fx: ["push"], say: "Even a box in a box" },
        { card: "GeoBoxQ", end: true },
      ] },
    ],
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
    reels: [
      { name: "one-account", title: "One account, every game", cuts: [
        { card: "One account", kicker: "eqosys", line: "Every game, every friend, every save.", len: 1.8 },
        { take: "library", at: 0.3, len: 2.6, fx: ["push"], say: "Your whole library", sub: "games, tools and business apps" },
        { take: "git-recon/newsreel", at: 4, len: 1.4, fx: ["punch", "flash"] },
        { take: "library", at: 5, len: 2.4, fx: ["push"], say: "Pick up where you left off" },
        { take: "two-fronts/orbit", at: 9.6, len: 1.4, fx: ["shake"] },
        { take: "friends", at: 0.3, len: 2.4, fx: ["push"], say: "See where your friends are", sub: "and what they're doing there" },
        { take: "mythic-masters/stadium", at: 19.4, len: 1.4, fx: ["flash"] },
        { take: "trophies", at: 2.5, len: 2.4, fx: ["push"], say: "Trophies across every game" },
        { take: "studio", at: 0.5, len: 2.6, fx: ["push"], say: "Make games, ship them", sub: "your studio, your people" },
        { take: "login", at: 0.3, len: 2.2, fx: ["push"], say: "Sign in once", sub: "Apple, Google, GitHub or a password" },
        { take: "dusk", at: 0.3, len: 2.2, fx: ["push"] },
        { card: "eqosys", kicker: "Play, keep, make, ship", line: "We make the boring parts easy, so your game is the only thing anyone sees.", end: true, len: 2.6 },
      ] },
      { name: "the-easy-parts", title: "The easy parts", cuts: [
        { card: "Sign-in, friends, saves", kicker: "eqosys", line: "Done before you write a line of your game.", len: 2 },
        { take: "login", at: 0.3, len: 2.2, fx: ["punch"], say: "Accounts" },
        { take: "friends", at: 1, len: 2.2, fx: ["push"], say: "Friends" },
        { take: "trophies", at: 1, len: 2.2, fx: ["push"], say: "Achievements" },
        { take: "studio", at: 2, len: 2.2, fx: ["push"], say: "Deploys" },
        { card: "eqosys", kicker: "One account for every Q game", end: true },
      ] },
    ],
  },
  // Qollab is eqosys's rooms and parties: its reel is cut from eqosys's pages and Qollab Studio's rooms.
  qollab: { app: "eqosys", takes: [], reels: [
    { name: "rooms", title: "Rooms in one call", cuts: [
      { card: "Play together", kicker: "Qollab", line: "Rooms, seats, parties, presence and saves.", len: 1.8 },
      { take: "eqosys/library", at: 0.3, len: 2.4, fx: ["push"], say: "A party code", sub: "read it out, any game" },
      { take: "fm-daw/jam", at: 1, len: 2.6, fx: ["push"], say: "Walk into the same room" },
      { take: "eqosys/friends", at: 0.5, len: 2.2, fx: ["punch"], say: "Who's online, and where" },
      { take: "two-fronts/orbit", at: 3, len: 1.6, fx: ["flash"] },
      { take: "fm-daw/jam", at: 9, len: 2.4, fx: ["push"], say: "Jam live", sub: "everyone hears the same beat" },
      { card: "One call", kicker: "For game makers", code: "const p = eqosys().party();\nconst code = await p.make();   // \"KXT7RP\"\np.onStart(({ room, seat }) => game.join(room, seat));", len: 3 },
      { card: "Qollab", kicker: "Realtime rooms on Cloudflare", line: "Built into eqosys.", end: true },
    ] },
    { name: "parties", title: "Parties", cuts: [
      { take: "eqosys/library", at: 0.3, len: 2.4, fx: ["punch"], say: "Start a party" },
      { take: "eqosys/friends", at: 0.5, len: 2.4, fx: ["push"], say: "Friends join from anywhere" },
      { take: "fm-daw/jam", at: 5, len: 2.4, fx: ["push"], say: "Same room, every page" },
      { card: "Qollab", kicker: "Parties for any game", end: true },
    ] },
  ] },
  // tscircuit boards as real pedals: the gear room's build sheets and Q Amp's board view (fm-daw).
  tscircuit: {
    app: "fm-daw",
    takes: [
      { name: "sheet", path: "/studio.html", wait: 7000, secs: 16, setup: [{ js: press("Walk in"), after: 3000 }, { js: "const s = qstudio.state(); const p = (s.items ?? []).find((i) => /drive|fuzz|pedal/i.test(JSON.stringify(i))); qstudio.sheet(p?.id ?? 'q-drive')", after: 2500 }], steps: [
        { at: 0, js: "qstudio.sheetTab('schematic')" }, { at: 4, js: "qstudio.sheetTab('pcb')" }, { at: 8, js: "qstudio.sheetTab('parts')" }, { at: 11, js: "qstudio.sheetTab('files')" }, { at: 13.5, js: "await qstudio.sheetBand?.()" },
      ] },
    ],
    reels: [
      { name: "pedals", title: "Boards you play, then order", cuts: [
        { card: "Draw it in tscircuit", kicker: "Q Drive", line: "Hear it as a pedal. Then order the board.", len: 2 },
        { take: "sheet", at: 0.2, len: 2.6, fx: ["push"], say: "The schematic" },
        { take: "sheet", at: 4.3, len: 2.6, fx: ["punch"], say: "The board" },
        { take: "sheet", at: 8.2, len: 2.4, fx: ["push"], say: "The parts list" },
        { take: "sheet", at: 11.3, len: 2.4, fx: ["push"], say: "Gerbers, ready to fab" },
        { take: "fm-daw/amp", at: 2, len: 2.2, fx: ["punch"], say: "Simulated part by part" },
        { card: "tscircuit pedals", kicker: "Qollab Studio", line: "Every pedal on the wall is a real 9 V board.", end: true },
      ] },
      { name: "build-sheet", title: "The build sheet", cuts: [
        { take: "sheet", at: 1, len: 2.4, fx: ["push"] },
        { take: "sheet", at: 5, len: 2.4, fx: ["push"], say: "PCB" },
        { take: "sheet", at: 9, len: 2.2, fx: ["punch"], say: "BOM" },
        { card: "tscircuit pedals", end: true },
      ] },
    ],
  },
  codesplitter: {
    serve: { live: "https://codesplitter.notryanquinn.workers.dev/" },
    takes: [{ size: [1280, 720], name: "home", path: "/", wait: 6000, secs: 14, steps: [2, 5, 8, 11].map((t): Step => ({ at: t, js: "scrollBy({ top: 600, behavior: 'smooth' })" })) }],
    reels: [
      { name: "split-apart", title: "Split apart", cuts: [
        { card: "Git, split apart", kicker: "codeSplitter", line: "And put back together.", len: 1.8 },
        { take: "home", at: 0.3, len: 2.6, fx: ["push"] },
        { take: "home", at: 2.2, len: 2.4, fx: ["push"], say: "Meet the helpers" },
        { take: "home", at: 5.3, len: 2.4, fx: ["punch"], say: "Not fixing itself", sub: "adding value" },
        { take: "home", at: 11.2, len: 2.4, fx: ["push"] },
        { card: "codeSplitter", kicker: "On Cloudflare", line: "Many agents, one repo, no fights.", end: true },
      ] },
      { name: "helpers", title: "The helpers", cuts: [
        { take: "home", at: 2.4, len: 2.6, fx: ["push"], say: "Mervin, Ester, Dexter" },
        { take: "home", at: 6.5, len: 2.4, fx: ["punch"], say: "No AI spent on chores" },
        { take: "home", at: 12, len: 2.2, fx: ["push"] },
        { card: "codeSplitter", end: true },
      ] },
    ],
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
      ...[["vert-capitan", "el-capitan"], ["vert-canyon", "grand-canyon"], ["vert-arches", "arches"]].map(([name, level]): Take => ({ name, path: `/?level=${level}&spawn=vert&nosweep`, css: noHud(), secs: 16, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.6, push: 1, jets: true }, { seconds: 1.3, ollie: true, trick: "tre flip", jets: true }, { seconds: 1.4, push: 1, jets: true, fan: true }, { seconds: 1.3, ollie: true, manual: "tail", steer: 1 },
        { seconds: 1.4, push: 1, jets: true }, { seconds: 1.4, ollie: true, trick: "double kickflip" }, { seconds: 1.4, push: 1, jets: true }, { seconds: 1.4, ollie: true, trick: "laser flip", steer: -1 }, { seconds: 2, push: 1, jets: true },
      ] }) }] })),
      ...[["rail", "el-capitan"], ["rail-teton", "grand-teton"]].map(([name, level]): Take => ({ name, path: `/?level=${level}&spawn=rail&nosweep`, css: noHud(), secs: 12, steps: [{ at: 0.5, js: run("skate_line", { moves: [
        { seconds: 1.2, push: 1 }, { seconds: 0.4, ollie: true }, { seconds: 2.5, push: 0.3 }, { seconds: 1.2, ollie: true, trick: "kickflip" }, { seconds: 1.5, push: 1 }, { seconds: 0.4, ollie: true }, { seconds: 2, push: 0.3 },
      ] }) }] })),
    ],
    reels: [
      { name: "national-parks", title: "Shred the parks", crf: 29, cuts: [
        { take: "vert-capitan", at: 0.2, len: 2.4, fx: ["push"], say: "El Capitan" },
        { take: "halfpipe", at: 2, len: 2.2, fx: ["punch"] },
        { take: "halfpipe", at: 3.6, len: 2.6, fx: ["slow", "flash"], say: "Tre flip", sub: "off the creek halfpipe" },
        { take: "vert-capitan", at: 3, len: 2.2, fx: ["punch"] },
        { take: "vert-capitan", at: 4, len: 2.4, fx: ["slow", "shake"] },
        { take: "vert-capitan", at: 5.4, len: 2.2, fx: ["slow", "flash"], say: "Jets on" },
        { take: "vert-canyon", at: 0.6, len: 2.4, fx: ["punch", "flash"], say: "Grand Canyon" },
        { take: "rail", at: 1, len: 2.6, fx: ["push"], say: "Grind it" },
        { take: "vert-arches", at: 5, len: 2.4, fx: ["slow"], say: "Arches" },
        { take: "halfpipe", at: 9, len: 2.6, fx: ["slow", "shake"], say: "360 hardflip" },
        { take: "rail-teton", at: 1.5, len: 2.2, fx: ["push"], say: "Grand Teton" },
        { take: "vert-capitan", at: 7.2, len: 2.2, fx: ["push"] },
        { card: "Skate Tech Park", kicker: "Fingerboard National Parks", line: "Every national park in America, on a board with jets.", end: true, len: 2.4 },
      ] },
      { name: "send-it", title: "Send it", cuts: [
        { take: "halfpipe", at: 2, len: 2.2, fx: ["push"] },
        { take: "halfpipe", at: 3.6, len: 2.6, fx: ["slow", "flash"], say: "Tre flip" },
        { take: "vert-capitan", at: 4, len: 2.4, fx: ["punch"] },
        { take: "halfpipe", at: 9, len: 2.6, fx: ["slow", "shake"], say: "360 hardflip" },
        { card: "Skate Tech Park", kicker: "Send it", end: true },
      ] },
      { name: "vert", title: "Vert", cuts: [
        { take: "vert-capitan", at: 0.2, len: 2.4, fx: ["push"], say: "Find the tallest wall" },
        { take: "vert-capitan", at: 3, len: 2.6, fx: ["slow", "flash"] },
        { take: "vert-arches", at: 2.6, len: 2.4, fx: ["punch"], say: "Jets on" },
        { take: "vert-canyon", at: 0.8, len: 2.4, fx: ["slow", "shake"] },
        { card: "Skate Tech Park", kicker: "Vert", end: true },
      ] },
      { name: "rails", title: "Rails", cuts: [
        { take: "rail", at: 0.5, len: 2.6, fx: ["push"], say: "Sky rails" },
        { take: "rail", at: 3, len: 2.4, fx: ["slow"] },
        { take: "rail-teton", at: 1, len: 2.6, fx: ["push"], say: "Kickflip in" },
        { take: "rail-teton", at: 4, len: 2.2, fx: ["punch", "flash"] },
        { card: "Skate Tech Park", kicker: "Grind every park", end: true },
      ] },
      { name: "parks", title: "The parks", cuts: [
        { take: "halfpipe", at: 0.3, len: 2.6, fx: ["push"], say: "Yosemite Falls" },
        { take: "vert-capitan", at: 0.3, len: 2.6, fx: ["push"], say: "El Capitan" },
        { take: "vert-canyon", at: 0.4, len: 2.6, fx: ["push"], say: "Grand Canyon" },
        { take: "rail-teton", at: 0.4, len: 2.6, fx: ["push"], say: "Grand Teton" },
        { take: "vert-arches", at: 0.4, len: 2.6, fx: ["push"], say: "Arches" },
        { card: "Skate Tech Park", kicker: "63 parks on real ground", end: true },
      ] },
    ],
  },
};
