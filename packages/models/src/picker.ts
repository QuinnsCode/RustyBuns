// The character picker every Q app mounts (#4987, #5009, #5819): your figure (the human body, worn from your avatar by
// `fromAvatar`, #5802) large on a framed stage, turning slowly, drag to spin (a "Drag to turn" hint until you do), with the
// poses to try under it and a button for a close look at the face. Four tabs of choices: Face (its shape, eyes, brows,
// nose, mouth, cheeks, facial hair, glasses, skin, and sliders to size and move them; the camera comes in close on the
// head), Hair, Clothes and Body (build and height). Shuffle and Save (and Cancel, in a dialog) sit right under the tabs,
// so they're in sight at every size.
// It neither fetches nor stores: the app hands it `load` and `save` (eqosys's Me tab calls GET and PUT /me/avatar with
// its session cookie; Qollab Studio's dialog sends its eqosys token as a bearer, or keeps a guest's look in the browser),
// so the same picker works on eqosys's page and over a game, with no page to leave. The body has no face maker yet
// (#5716), so the Face tab shows yours in 2D beside it, and the hair and hats it wears as the nearest it has say "soon".
// The DOM is plain elements with `ch-` classes; each app brings its own stylesheet for them. DOM and WebGL: a page only.
import * as THREE from "three";
import { AvatarReply, drawAvatar, FACE, faceY, PARTS, randomAvatar, TUNE, TUNE_STEPS, type Avatar } from "@rustybuns/util/avatar";
import type { Of } from "@rustybuns/util/guard";
import type { Play } from "./character.ts";
import { fromAvatar, human, playArms, seatOf, sit, wearsAsIs, type Human } from "./human.ts";

/** What `load` and `save` answer: the avatar and whether it is saved (false: made from their name), or null when they can't. */
export type Kept = Of<typeof AvatarReply>;
export type PickerOptions = {
  load: () => Promise<Kept | null>;
  save: (a: Avatar) => Promise<Kept | null>;
  /** Someone new: a welcome line over it, with a Later link to `later`. */
  first?: { later: string } | null;
  /** In a dialog: a Cancel button beside Save, and this runs on it. */
  cancel?: () => void;
  /** Runs after each save that took. */
  saved?: (a: Avatar) => void;
  /** Shown instead when `load` answers null. */
  signedOut?: string;
};

const OPTIONS = { ...PARTS, ...FACE };
type Part = keyof typeof OPTIONS;
type Slider = (typeof TUNE)[number];
type Row = [Part, string] | [Slider, string, "slider"];
// Lucide's icons (ISC), drawn here so the package needs no icon library
type Icon = string;
const ICONS = {
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  person: '<circle cx="12" cy="5" r="1"/><path d="m9 20 3-6 3 6"/><path d="m6 8 6 2 6-2"/><path d="M12 10v4"/>',
  move: '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  zoomIn: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  zoomOut: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
} satisfies Record<string, Icon>;
/** An 18 px line icon by name, hidden from screen readers (its button carries the word). */
export function icon(name: keyof typeof ICONS, size = 18): SVGSVGElement {
  const t = document.createElement("template");
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const svg = t.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) throw new Error(`icon ${name}`);
  return svg;
}

/** The tabs, and the rows on each in the order shown; colours are swatches, sliders are -3..3, the rest are named choices. */
const TABS = {
  face: { word: "Face", icon: "smile", rows: [
    ["face", "Face"], ["skin", "Skin"], ["eyes", "Eyes"], ["eyeSize", "Eye size", "slider"], ["eyeGap", "Eye spacing", "slider"],
    ["eyeHeight", "Eye height", "slider"], ["brows", "Brows"], ["browHeight", "Brow height", "slider"], ["nose", "Nose"],
    ["noseSize", "Nose size", "slider"], ["mouth", "Mouth"], ["mouthSize", "Mouth size", "slider"], ["mouthHeight", "Mouth height", "slider"],
    ["cheeks", "Cheeks"], ["beard", "Facial hair"], ["glasses", "Glasses"],
  ] },
  hair: { word: "Hair", icon: "scissors", rows: [["hair", "Hair"], ["hairColor", "Colour"], ["hat", "Hat"]] },
  clothes: { word: "Clothes", icon: "shirt", rows: [["top", "Top"], ["topColor", "Top colour"], ["bottomColor", "Trousers"]] },
  body: { word: "Body", icon: "person", rows: [["build", "Build"], ["height", "Height", "slider"]] },
} satisfies Record<string, { word: string; icon: keyof typeof ICONS; rows: Row[] }>;
type TabName = keyof typeof TABS;
/** What each tab's fold says, when there is something to explain. */
const SOON: Partial<Record<TabName, string>> = {
  face: "Faces on the 3D body are coming. Until then, the one you make here shows in the corner and on your 2D card.",
  hair: "Styles marked soon show as the nearest the 3D body has for now.",
};
const COLOUR = new Set<Part>(["skin", "hairColor", "topColor", "bottomColor"]);
/** What the figure does while you dress it: a row under the stage, so you see the clothes walk, sit and play. */
const POSES = { stand: "Stand", walk: "Walk", sit: "Sit", keys: "Keys", sticks: "Drums", strings: "Guitar" } as const;
type PoseName = keyof typeof POSES;
const WORDS: Record<string, string> = { vr: "VR", none: "None", full: "Full beard", "flat-top": "Flat top" };
const word = (v: string) => WORDS[v] ?? v[0]!.toUpperCase() + v.slice(1).replaceAll("-", " ");

export type Picker = NonNullable<Awaited<ReturnType<typeof mountPicker>>>;

/** Fills `box` with the picker, or with `signedOut` (and answers null) when `load` can't. `dispose` stops it and lets go of the GPU. */
export async function mountPicker(box: HTMLElement, o: PickerOptions) {
  const got = await o.load();
  if (!got) { box.textContent = o.signedOut ?? "Sign in to make your character."; return null; }
  let avatar: Avatar = got.avatar, saved = got.saved, dirty = false, pose: PoseName = "stand", status = "", tab: TabName = "face";
  /** The close look at the face: null follows the tab (Face and Hair come in close), true or false is the button's say. */
  let zoom: boolean | null = null, turned = false, live = true;
  const first = !!o.first;

  box.textContent = "";
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => { const e = document.createElement(tag); e.className = cls; parent.append(e); return e; };
  if (o.first) {
    const hi = el("p", "ch-first", box), later = document.createElement("a");
    hi.textContent = "Welcome. Make your character first: you wear it in every Q app. ";
    later.href = o.first.later; later.textContent = "Later"; later.className = "ch-later"; hi.append(later);
  }
  const left = el("div", "ch-left", box), stage = el("div", "ch-stage", left), side = el("div", "ch-side", box);
  stage.setAttribute("aria-label", "Your character. Drag to turn it round.");
  const hint = el("span", "ch-hint", stage);
  hint.append(icon("move", 16), document.createTextNode("Drag to turn"));
  const zoomButton = el("button", "ch-zoom", stage);
  zoomButton.type = "button";
  zoomButton.addEventListener("pointerdown", (e) => e.stopPropagation());
  zoomButton.addEventListener("click", () => { zoom = !isClose(); show(); });
  const tabs = el("div", "ch-tabs", side), bar = el("div", "ch-bar", side), rows = el("div", "ch-rows", side);
  tabs.setAttribute("role", "tablist");

  // the scene: the figure on a soft shadow, lit from above and the front, the camera on it (a figure faces -z)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f94", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 1.8);
  sun.position.set(-2, 4, -3);
  scene.add(sun);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.14 }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const turntable = new THREE.Group();
  scene.add(turntable);
  // a stool for the seated poses, its top where the body's thighs rest
  const stool = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.8 });
  const put = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); stool.add(m); };
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), wood), 0, 0.43, 0.04);
  for (const [x, z] of [[-0.14, -0.09], [0.14, -0.09], [-0.14, 0.17], [0.14, 0.17]] as const) put(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), wood), x, 0.21, z);
  turntable.add(stool);
  // the body faces +z: turned half round, it faces the camera as the old figure did
  let fig: Human | null = null;
  const dress = () => {
    if (fig) { turntable.remove(fig.root); fig.dispose(); }
    const { build, outfit, palette } = fromAvatar(avatar);
    fig = human(build, outfit, palette);
    fig.root.rotation.y = Math.PI;
    turntable.add(fig.root);
    stool.scale.y = seatOf(fig).seat / 0.45;
    drawFacePreview();
  };

  // the face as it is in 2D (the body's own faces are #5716): on the Face tab, in the stage's corner
  const facePreview = el("canvas", "ch-face", stage);
  facePreview.width = facePreview.height = 192;
  facePreview.setAttribute("role", "img");
  function drawFacePreview() {
    const g = facePreview.getContext("2d");
    if (!g) return;
    const size = facePreview.width, u = size / 60;
    g.clearRect(0, 0, size, size);
    drawAvatar(g, avatar, size / 2, size / 2 + (faceY(avatar) - 2) * u, 100 * u);
    facePreview.setAttribute("aria-label", "Your face. On the 3D body soon.");
  }
  dress();

  // drag to spin, and it keeps turning slowly when let go; on the Face tab it turns only a little, to show the face
  let turn = 0, spin = 0.35, held = false, drag: { x: number; at: number } | null = null;
  stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, at: performance.now() }; stage.setPointerCapture(e.pointerId); spin = 0; held = false; turned = true; hint.hidden = true; });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / Math.max(1, stage.clientWidth) * Math.PI * 2, dt = Math.max(1, performance.now() - drag.at) / 1000;
    turn += dx; spin = THREE.MathUtils.clamp(dx / dt, -6, 6); drag = { x: e.clientX, at: performance.now() };
  });
  const letGo = () => { drag = null; if (Math.abs(spin) < 0.2) spin = 0.35 * Math.sign(spin || 1); };
  stage.addEventListener("pointerup", letGo);
  stage.addEventListener("pointercancel", letGo);

  const fit = () => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const sized = new ResizeObserver(fit);
  sized.observe(stage);
  fit();
  // the camera eases between the whole figure and a close look at the head and shoulders (a life-size head: the head bone
  // is its base, the face about 10 cm over it)
  const eye = new THREE.Vector3(0, 0.9, -3.6), aim = new THREE.Vector3(0, 0.7, 0), headAt = new THREE.Vector3();
  let last = performance.now();
  function isClose() { return zoom ?? (tab === "face" || tab === "hair"); }
  const frame = (now: number) => {
    if (!live) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const close = isClose();
    if (!drag && !held) {
      if (close) { const back = Math.atan2(Math.sin(turn), Math.cos(turn)); spin = 0; turn -= back * Math.min(1, dt * 2); turn += Math.sin(now / 1400) * 0.12 * dt; }
      else { spin += (0.35 * Math.sign(spin || 1) - spin) * Math.min(1, dt * 1.5); turn += spin * dt; }
    }
    turntable.rotation.y = turn;
    const seated = pose === "sit" || pose === "keys" || pose === "sticks";
    stool.visible = seated && !close;
    const play: Play | null = !close && (pose === "keys" || pose === "sticks" || pose === "strings") ? pose : null;
    if (fig) {
      const sat = seated && !close;
      fig.pose({ speed: !close && pose === "walk" ? 1.4 : 0 }, dt);
      if (sat) sit(fig, play !== null);
      if (sat || play) playArms(fig, now / 1000, play);
      fig.root.updateMatrixWorld(true);
      fig.bones.head.getWorldPosition(headAt);
      const h = fig.height + 0.25, k = Math.min(1, dt * 4);
      eye.lerp(close ? new THREE.Vector3(headAt.x * 0.3, headAt.y + 0.1, -1.7) : new THREE.Vector3(0, h * 0.62, -h * 2.4 - 0.4), k);
      aim.lerp(close ? new THREE.Vector3(headAt.x * 0.3, headAt.y + 0.04, 0) : new THREE.Vector3(0, h * 0.46, 0), k);
    }
    camera.position.copy(eye); camera.lookAt(aim);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // the rows: one button a choice, the chosen one pressed; colour rows are round swatches; sliders step -3..3
  const buttons = new Map<Part, HTMLButtonElement[]>(), sliders = new Map<Slider, HTMLInputElement>(), panels = new Map<TabName, HTMLElement>();
  const tabButtons: HTMLButtonElement[] = [];
  const row = (label: string, parent: HTMLElement, cls = "ch-choices") => { const r = el("div", "ch-row", parent); el("span", "ch-label", r).textContent = label; return el("div", cls, r); };
  for (const [name, t] of Object.entries(TABS) as [TabName, (typeof TABS)[TabName]][]) {
    const b = el("button", "ch-tab", tabs);
    b.type = "button"; b.dataset.value = name; b.setAttribute("role", "tab"); b.title = t.word;
    b.append(icon(t.icon), document.createTextNode(t.word));
    b.addEventListener("click", () => { tab = name; zoom = null; show(); });
    tabButtons.push(b);
    const panel = el("div", "ch-panel", rows);
    panel.setAttribute("role", "tabpanel");
    const soon = SOON[name];
    if (soon) { const fold = el("details", "ch-soon", panel); el("summary", "", fold).textContent = "Soon"; el("p", "", fold).textContent = soon; }
    panels.set(name, panel);
    for (const r of t.rows as Row[]) {
      if (r.length === 3) {
        const [k, label] = r, holder = row(label, panel, "ch-slider"), input = el("input", "", holder);
        input.type = "range"; input.min = String(-TUNE_STEPS); input.max = String(TUNE_STEPS); input.step = "1"; input.setAttribute("aria-label", label);
        input.addEventListener("input", () => tune(k, Number(input.value)));
        sliders.set(k, input);
        continue;
      }
      const [part, label] = r, list = row(label, panel), bs: HTMLButtonElement[] = [];
      for (const v of OPTIONS[part]) {
        const b = el("button", COLOUR.has(part) ? "ch-swatch" : "ch-chip", list);
        b.type = "button"; b.dataset.value = v; b.dataset.part = part;
        if (COLOUR.has(part)) { b.style.background = v; b.title = v; b.setAttribute("aria-label", `${label} ${v}`); } else b.textContent = word(v);
        if ((part === "hair" || part === "hat") && !wearsAsIs(part, v)) { b.dataset.soon = ""; b.title = `${word(v)}: the 3D body wears the nearest it has until it grows this one`; }
        b.addEventListener("click", () => pick(part, v));
        bs.push(b);
      }
      buttons.set(part, bs);
    }
  }
  const poses = el("div", "ch-poses", left), poseButtons: HTMLButtonElement[] = [];
  poses.setAttribute("aria-label", "Try it");
  for (const [k, w] of Object.entries(POSES) as [PoseName, string][]) {
    const b = el("button", "ch-chip", poses);
    b.type = "button"; b.dataset.value = k; b.textContent = w;
    b.addEventListener("click", () => { pose = k; zoom = k === "stand" ? zoom : false; show(); });
    poseButtons.push(b);
  }
  const action = (name: keyof typeof ICONS, text: string, primary: boolean, go: () => void) => {
    const b = el("button", primary ? "ui-btn primary" : "ui-btn", bar);
    b.type = "button"; b.dataset.do = text.toLowerCase(); b.append(icon(name), document.createTextNode(text));
    b.addEventListener("click", go);
    return b;
  };
  action("shuffle", "Shuffle", false, () => shuffle());
  const saveButton = action("save", "Save", true, () => void save());
  if (o.cancel) action("x", "Cancel", false, o.cancel);
  const note = el("span", "ch-note", bar);

  function show() {
    for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.value === tab));
    for (const [name, p] of panels) p.hidden = name !== tab;
    facePreview.hidden = tab !== "face";
    for (const [part, bs] of buttons) for (const b of bs) {
      const on = b.dataset.value === avatar[part];
      b.setAttribute("aria-pressed", String(on));
      // the chosen one in sight in its row (a row scrolls sideways rather than wrap), without moving the page
      const list = b.parentElement;
      if (on && list && list.clientWidth && (b.offsetLeft < list.scrollLeft || b.offsetLeft + b.offsetWidth > list.scrollLeft + list.clientWidth)) list.scrollLeft = b.offsetLeft - list.clientWidth / 2 + b.offsetWidth / 2;
    }
    for (const [k, input] of sliders) input.value = String(avatar[k]);
    for (const b of poseButtons) b.setAttribute("aria-pressed", String(b.dataset.value === pose));
    const near = isClose();
    zoomButton.replaceChildren(icon(near ? "zoomOut" : "zoomIn"));
    zoomButton.title = near ? "Whole figure" : "Close-up of the face"; zoomButton.setAttribute("aria-label", zoomButton.title);
    zoomButton.setAttribute("aria-pressed", String(near));
    saveButton.disabled = !dirty && saved;
    note.textContent = status || (dirty ? "Not saved yet" : saved ? "Saved" : "Not saved yet: this one is made from your name");
  }
  const changed = (next: Avatar) => { avatar = next; dirty = true; status = ""; dress(); show(); return state(); };
  function pick(part: Part, value: string) {
    if (!(OPTIONS[part] as readonly string[]).includes(value)) throw new Error(`${part} is one of ${OPTIONS[part].join(", ")}`);
    return changed({ ...avatar, [part]: value });
  }
  function tune(k: Slider, n: number) {
    if (!TUNE.includes(k) || !Number.isInteger(n) || Math.abs(n) > TUNE_STEPS) throw new Error(`a slider (${TUNE.join(", ")}) to a whole number from -${TUNE_STEPS} to ${TUNE_STEPS}`);
    return changed({ ...avatar, [k]: n });
  }
  function shuffle() { return changed(randomAvatar(Math.random)); }
  async function save() {
    status = "Saving…"; show();
    const r = await o.save(avatar);
    if (r) { avatar = r.avatar; saved = true; dirty = false; status = ""; } else status = "Couldn't save. Try again.";
    show();
    if (r) o.saved?.(r.avatar);
    return state();
  }
  const state = () => ({ avatar, saved, dirty, pose, tab, status, turn: Math.round(THREE.MathUtils.radToDeg(turn) % 360), first, close: isClose(), turned, height: fig ? Math.round(fig.height * 100) / 100 : 0 });
  show();
  /** Stop turning, facing `deg` (0: its face to you), for a picture; a drag sets it spinning again. */
  const turnTo = (deg: number) => { turn = THREE.MathUtils.degToRad(deg); held = true; return state(); };
  const open = (t: TabName) => { if (!(t in TABS)) throw new Error(`tab is one of ${Object.keys(TABS).join(", ")}`); tab = t; zoom = null; show(); return state(); };
  /** The close look at the face: true, false, or null to follow the tab. */
  const closeUp = (on: boolean | null) => { zoom = on; show(); return state(); };
  const dispose = () => {
    live = false; sized.disconnect();
    fig?.dispose(); renderer.dispose(); renderer.forceContextLoss();
    box.textContent = "";
  };
  return { state, pick, tune, shuffle, save, turnTo, tab: open, zoom: closeUp, dispose, pose: (p: PoseName) => { if (!(p in POSES)) throw new Error(`pose is one of ${Object.keys(POSES).join(", ")}`); pose = p; zoom = false; show(); return state(); } };
}
