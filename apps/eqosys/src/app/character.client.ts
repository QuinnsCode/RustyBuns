// The character picker on the Me tab (#4987, #5009): your figure (@rustybuns/models' human, the body Qollab Studio's
// rooms dress from your avatar, #5802) large on a framed
// stage, turning slowly, drag to spin (a "Drag to turn" hint until you do), with the poses to try under it and a button
// for a close look at the face. Four tabs of choices: Face (its shape, eyes, brows, nose, mouth, cheeks, facial hair,
// glasses, skin, and sliders to size and move them; the camera comes in close on the head), Hair, Clothes and Body
// (build and height). Someone new (signed up, or signed in without one: ?new=1) is welcomed to it, with a Later link. Shuffle and Save sit right under the tabs, so they're in sight at every size. It reads and saves through GET and PUT
// /me/avatar (avatar.ts) with the session cookie. Its own module script, on the Me tab alone, so three.js loads only
// here. The body has no face maker yet (#5716), so the Face tab shows yours in 2D beside it, and the hair and hats it
// wears as the nearest it has say "soon". `window.__character` is its handle: `bun run probe eqosys "/?tab=account" --js "__character.state()"`.
import * as THREE from "three";
import { createElement, MoveHorizontal, PersonStanding, Save, Scissors, Shirt, Shuffle, Smile, ZoomIn, ZoomOut } from "lucide";
import { AvatarReply, drawAvatar, FACE, faceY, PARTS, randomAvatar, TUNE, TUNE_STEPS, type Avatar } from "@rustybuns/util/avatar";
import { getJson } from "@rustybuns/util/http";
import type { Play } from "@rustybuns/models/character";
import { fromAvatar, human, playArms, seatOf, sit, wearsAsIs, type Human } from "@rustybuns/models/human";

const OPTIONS = { ...PARTS, ...FACE };
type Part = keyof typeof OPTIONS;
type Slider = (typeof TUNE)[number];
type Row = [Part, string] | [Slider, string, "slider"];
/** The tabs, and the rows on each in the order shown; colours are swatches, sliders are -3..3, the rest are named choices. */
const TABS = {
  face: { word: "Face", icon: Smile, rows: [
    ["face", "Face"], ["skin", "Skin"], ["eyes", "Eyes"], ["eyeSize", "Eye size", "slider"], ["eyeGap", "Eye spacing", "slider"],
    ["eyeHeight", "Eye height", "slider"], ["brows", "Brows"], ["browHeight", "Brow height", "slider"], ["nose", "Nose"],
    ["noseSize", "Nose size", "slider"], ["mouth", "Mouth"], ["mouthSize", "Mouth size", "slider"], ["mouthHeight", "Mouth height", "slider"],
    ["cheeks", "Cheeks"], ["beard", "Facial hair"], ["glasses", "Glasses"],
  ] },
  hair: { word: "Hair", icon: Scissors, rows: [["hair", "Hair"], ["hairColor", "Colour"], ["hat", "Hat"]] },
  clothes: { word: "Clothes", icon: Shirt, rows: [["top", "Top"], ["topColor", "Top colour"], ["bottomColor", "Trousers"]] },
  body: { word: "Body", icon: PersonStanding, rows: [["build", "Build"], ["height", "Height", "slider"]] },
} satisfies Record<string, { word: string; icon: Parameters<typeof createElement>[0]; rows: Row[] }>;
type TabName = keyof typeof TABS;
const COLOUR = new Set<Part>(["skin", "hairColor", "topColor", "bottomColor"]);
/** What the figure does while you dress it: a row under the stage, so you see the clothes walk, sit and play. */
const POSES = { stand: "Stand", walk: "Walk", sit: "Sit", keys: "Keys", sticks: "Drums", strings: "Guitar" } as const;
type PoseName = keyof typeof POSES;
const WORDS: Record<string, string> = { vr: "VR", none: "None", full: "Full beard", "flat-top": "Flat top" };
const word = (v: string) => WORDS[v] ?? v[0]!.toUpperCase() + v.slice(1).replaceAll("-", " ");

export async function mountCharacter(box: HTMLElement) {
  const got = await getJson("/me/avatar", AvatarReply, { credentials: "same-origin" });
  if (!got) { box.textContent = "Sign in to make your character."; return null; }
  let avatar: Avatar = got.avatar, saved = got.saved, dirty = false, pose: PoseName = "stand", status = "", tab: TabName = "face";
  /** The close look at the face: null follows the tab (Face and Hair come in close), true or false is the button's say. */
  let zoom: boolean | null = null, turned = false;
  const first = new URLSearchParams(location.search).get("new") === "1";

  box.textContent = "";
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => { const e = document.createElement(tag); e.className = cls; parent.append(e); return e; };
  if (first) {
    const hi = el("p", "ch-first", box), later = document.createElement("a");
    hi.textContent = "Welcome. Make your character first: you wear it in every Q app. ";
    later.href = "/"; later.textContent = "Later"; later.className = "ch-later"; hi.append(later);
  }
  const left = el("div", "ch-left", box), stage = el("div", "ch-stage", left), side = el("div", "ch-side", box);
  stage.setAttribute("aria-label", "Your character. Drag to turn it round.");
  const hint = el("span", "ch-hint", stage);
  hint.append(createElement(MoveHorizontal, { width: 16, height: 16, "aria-hidden": "true" }), document.createTextNode("Drag to turn"));
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
  new ResizeObserver(fit).observe(stage);
  fit();
  // the camera eases between the whole figure and a close look at the head and shoulders (a life-size head: the head bone
  // is its base, the face about 10 cm over it)
  const eye = new THREE.Vector3(0, 0.9, -3.6), aim = new THREE.Vector3(0, 0.7, 0), headAt = new THREE.Vector3();
  let last = performance.now();
  function isClose() { return zoom ?? (tab === "face" || tab === "hair"); }
  const frame = (now: number) => {
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
    b.append(createElement(t.icon, { width: 18, height: 18, "aria-hidden": "true" }), document.createTextNode(t.word));
    b.addEventListener("click", () => { tab = name; zoom = null; show(); });
    tabButtons.push(b);
    const panel = el("div", "ch-panel", rows);
    panel.setAttribute("role", "tabpanel");
    if (name === "face") el("p", "ch-soon", panel).textContent = "Faces on the 3D body are coming. Until then, the one you make here shows in the corner and on your 2D card.";
    if (name === "hair") el("p", "ch-soon", panel).textContent = "Styles marked soon show as the nearest the 3D body has for now.";
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
        b.type = "button"; b.dataset.value = v;
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
  const action = (icon: Parameters<typeof createElement>[0], text: string, primary: boolean, go: () => void) => {
    const b = el("button", primary ? "ui-btn primary" : "ui-btn", bar);
    b.type = "button"; b.append(createElement(icon, { width: 18, height: 18, "aria-hidden": "true" }), document.createTextNode(text));
    b.addEventListener("click", go);
    return b;
  };
  action(Shuffle, "Shuffle", false, () => shuffle());
  const saveButton = action(Save, "Save", true, () => void save());
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
    zoomButton.replaceChildren(createElement(near ? ZoomOut : ZoomIn, { width: 18, height: 18, "aria-hidden": "true" }));
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
    const r = await getJson("/me/avatar", AvatarReply, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(avatar) });
    if (r) { avatar = r.avatar; saved = true; dirty = false; status = ""; } else status = "Couldn't save. Try again.";
    show();
    return state();
  }
  const state = () => ({ avatar, saved, dirty, pose, tab, status, turn: Math.round(THREE.MathUtils.radToDeg(turn) % 360), first, close: isClose(), turned, height: fig ? Math.round(fig.height * 100) / 100 : 0 });
  show();
  /** Stop turning, facing `deg` (0: its face to you), for a picture; a drag sets it spinning again. */
  const turnTo = (deg: number) => { turn = THREE.MathUtils.degToRad(deg); held = true; return state(); };
  const open = (t: TabName) => { if (!(t in TABS)) throw new Error(`tab is one of ${Object.keys(TABS).join(", ")}`); tab = t; zoom = null; show(); return state(); };
  /** The close look at the face: true, false, or null to follow the tab. */
  const closeUp = (on: boolean | null) => { zoom = on; show(); return state(); };
  return { state, pick, tune, shuffle, save, turnTo, tab: open, zoom: closeUp, pose: (p: PoseName) => { if (!(p in POSES)) throw new Error(`pose is one of ${Object.keys(POSES).join(", ")}`); pose = p; zoom = false; show(); return state(); } };
}

if (typeof document !== "undefined") {
  const box = document.getElementById("character");
  if (box) void mountCharacter(box).then((h) => Object.assign(window, { __character: h }));
}
