// The gear room's start card: a level card, all symbols, every one with a tip (hover, or tap on touch).
// lucide (ISC): guitar, radio, speaker, toggle-right, split, audio-waveform, repeat, mouse, hand, rotate-cw,
// cable, circle-gauge, unplug, clipboard-list, plus, circuit-board, volume-2, volume-x, sliders-horizontal, log-out, play
const I = {
  guitar: '<path d="m11.9 12.1 4.514-4.514"/><path d="M20.1 2.3a1 1 0 0 0-1.4 0l-1.114 1.114A2 2 0 0 0 17 4.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 17.828 7h1.344a2 2 0 0 0 1.414-.586L21.7 5.3a1 1 0 0 0 0-1.4z"/><path d="m6 16 2 2"/><path d="M8.23 9.85A3 3 0 0 1 11 8a5 5 0 0 1 5 5 3 3 0 0 1-1.85 2.77l-.92.38A2 2 0 0 0 12 18a4 4 0 0 1-4 4 6 6 0 0 1-6-6 4 4 0 0 1 4-4 2 2 0 0 0 1.85-1.23z"/>',
  amp: '<path d="M16.247 7.761a6 6 0 0 1 0 8.478"/><path d="M19.075 4.933a10 10 0 0 1 0 14.134"/><path d="M4.925 19.067a10 10 0 0 1 0-14.134"/><path d="M7.753 16.239a6 6 0 0 1 0-8.478"/><circle cx="12" cy="12" r="2"/>',
  cab: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>',
  pedal: '<circle cx="15" cy="12" r="3"/><rect width="20" height="14" x="2" y="5" rx="7"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  wall: '<path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>',
  loop: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  mouse: '<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  turn: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  cable: '<path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z"/><path d="M17 21v-2"/><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"/><path d="M21 21v-2"/><path d="M3 5V3"/><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z"/><path d="M7 5V3"/>',
  knob: '<path d="M15.6 2.7a10 10 0 1 0 5.7 5.7"/><circle cx="12" cy="12" r="2"/><path d="M13.4 10.6 19 5"/>',
  unplug: '<path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
  sheet: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  board: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M11 9h4a2 2 0 0 0 2-2V3"/><circle cx="9" cy="9" r="2"/><path d="M7 21v-4a2 2 0 0 1 2-2h4"/><circle cx="15" cy="15" r="2"/>',
  speakers: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  desk: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  out: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  muted: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
} as const;
type Icon = keyof typeof I;

const svg = (i: Icon) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[i]}</svg>`;
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const tip = (inner: string, words: string, cls = "") => `<span class="tip ${cls}" tabindex="0" role="img" aria-label="${attr(words)}" data-tip="${attr(words)}">${inner}</span>`;
const gear = (i: Icon, words: string) => tip(svg(i), words, "ico");
const to = '<i class="to" aria-hidden="true"></i>';

/** Each goal: a chain of gear, and what it does in a few words. */
const GOALS: readonly { chain: string; words: string }[] = [
  { chain: [gear("guitar", "Guitar, on its stand"), gear("amp", "Amp, on the rack"), gear("cab", "Cab, on the floor")].join(to), words: "Guitar → amp → cab: you hear it" },
  { chain: [gear("guitar", "Guitar"), gear("pedal", "Pedal, off the pedal wall"), gear("pedal", "Another pedal"), gear("amp", "Amp")].join(to), words: "Pedals in a row" },
  { chain: [gear("split", "Q Split"), gear("pedal", "Pedal"), gear("pedal", "Pedal")].join(to), words: "Two pedals side by side on Q Split" },
  { chain: gear("wall", "Sound wall, right of the rack: sequencer, oscillator, filter, VCA, envelope, LFO, mixer, out"), words: "Patch the sound wall" },
  { chain: [gear("wall", "A mixer send"), gear("pedal", "A pedal or Q Spring"), gear("loop", "Back into its return")].join(to), words: "Send through a pedal and back" },
];

/** Each key: a keycap (or a symbol for a pointer move), an icon, and what it does. */
const KEYS: readonly { key: string; icon?: Icon; words: string }[] = [
  { key: "WASD", icon: "mouse", words: "Walk, mouse look" },
  { key: "Click", icon: "hand", words: "Pick a box up, click again to set it down" },
  { key: "Q E", icon: "turn", words: "Turn what you hold" },
  { key: "Click", icon: "cable", words: "Take a cable from a jack, click another jack" },
  { key: "Drag", icon: "knob", words: "Turn a knob" },
  { key: "G", icon: "unplug", words: "Let go of a cable (or right-click)" },
  { key: "B", icon: "sheet", words: "Build sheet of a pedal: schematic, board, parts, kit" },
  { key: "N", icon: "plus", words: "A new sound wall module" },
  { key: "Drop", icon: "board", words: "Drop a tscircuit board's JSON: it stands as a pedal" },
  { key: "M", icon: "speakers", words: "Speakers up or down" },
  { key: "Tab", icon: "desk", words: "The desk: your strip, sends to its returns" },
  { key: "Esc", icon: "out", words: "Let go of the mouse" },
];

/** The card's markup. */
export function menuCard(): string {
  const goals = GOALS.map((g, n) => `<li>${tip(String(n + 1), g.words, "num")}<span class="chain">${g.chain}</span></li>`).join("");
  const keys = KEYS.map((k) => tip(`${k.icon ? svg(k.icon) : ""}${k.key ? `<kbd>${k.key}</kbd>` : ""}`, k.words, "key")).join("");
  return `<div class="lvl"><span class="lvl-no">01</span><h1>Gear room</h1><span class="lvl-at">Warehouse bay</span></div>
<ol class="goals" aria-label="Goals">${goals}</ol>
<div class="keys-grid" aria-label="Keys">${keys}</div>
<button id="play" type="button" aria-label="Walk in">${svg("play")}<span>Walk in</span></button>`;
}

/** The speakers button: an icon and its key, the words in its tip. */
export function speakersButton(el: HTMLElement, up: boolean): void {
  const words = up ? "Speakers up: M brings them down" : "Speakers down: click or M brings them up";
  el.innerHTML = `${svg(up ? "speakers" : "muted")}<kbd>M</kbd>`;
  el.classList.add("tip", "below");
  el.dataset.tip = words;
  el.setAttribute("aria-label", words);
}

/** Tap a tip to show it (touch has no hover); tap anywhere else to hide it. */
export function tapTips(root: Document): void {
  root.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest(".tip") : null;
    for (const on of root.querySelectorAll(".tip.on")) if (on !== t) on.classList.remove("on");
    t?.classList.toggle("on");
  });
}
