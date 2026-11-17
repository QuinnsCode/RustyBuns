// The character picker on the Me tab (#4987): your figure (@rustybuns/models' character) large in the middle, turning
// slowly, drag to spin; a row of choices for each part, colour swatches, Shuffle and Save. It reads and saves through
// GET and PUT /me/avatar (avatar.ts) with the session cookie. Its own module script, on the Me tab alone, so three.js
// loads only here. `window.__character` is its handle: `bun run probe eqosys "/?tab=account" --js "__character.state()"`.
import * as THREE from "three";
import { createElement, Save, Shuffle } from "lucide";
import { AvatarReply, PARTS, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { getJson } from "@rustybuns/util/http";
import { character, type Character, type Play } from "@rustybuns/models/character";

type Part = keyof typeof PARTS;
/** The rows in the order they are shown, with the word on each; colours are swatches, the rest are named choices. */
const ROWS: [Part, string][] = [
  ["skin", "Skin"], ["hair", "Hair"], ["hairColor", "Hair colour"], ["hat", "Hat"], ["eyes", "Eyes"], ["mouth", "Mouth"],
  ["glasses", "Glasses"], ["top", "Top"], ["topColor", "Top colour"], ["bottomColor", "Trousers"], ["build", "Build"],
];
const COLOUR = new Set<Part>(["skin", "hairColor", "topColor", "bottomColor"]);
/** What the figure does while you dress it: a row of its own, so you see the clothes walk, sit and play. */
const POSES = { stand: "Stand", walk: "Walk", sit: "Sit", keys: "Keys", sticks: "Drums", strings: "Guitar" } as const;
type PoseName = keyof typeof POSES;
const word = (v: string) => v === "vr" ? "VR" : v === "none" ? "None" : v[0]!.toUpperCase() + v.slice(1).replaceAll("-", " ");

export async function mountCharacter(box: HTMLElement) {
  const got = await getJson("/me/avatar", AvatarReply, { credentials: "same-origin" });
  if (!got) { box.textContent = "Sign in to make your character."; return null; }
  let avatar: Avatar = got.avatar, saved = got.saved, dirty = false, pose: PoseName = "stand", status = "";
  const first = new URLSearchParams(location.search).get("new") === "1";

  box.textContent = "";
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) => { const e = document.createElement(tag); e.className = cls; parent.append(e); return e; };
  if (first) el("p", "ch-first", box).textContent = "Welcome. Make your character first: you wear it in every Q app.";
  const stage = el("div", "ch-stage", box), side = el("div", "ch-side", box);
  const rows = el("div", "ch-rows", side), bar = el("div", "ch-bar", side);

  // the scene: the figure on a soft shadow, lit from above and the front, the camera on its face (a figure faces -z)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.append(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.15, -4.4);
  camera.lookAt(0, 0.95, 0);
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f94", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 1.8);
  sun.position.set(-2, 4, -3);
  scene.add(sun);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.14 }));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const turntable = new THREE.Group();
  scene.add(turntable);
  // a stool for the seated poses, its top at the height character() sits at (shins straight down to the floor)
  const stool = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#6b4a2c", roughness: 0.8 });
  const put = (m: THREE.Mesh, x: number, y: number, z: number) => { m.position.set(x, y, z); stool.add(m); };
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), wood), 0, 0.43, 0.06);
  for (const [x, z] of [[-0.13, -0.07], [0.13, -0.07], [-0.13, 0.19], [0.13, 0.19]] as const) put(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), wood), x, 0.21, z);
  turntable.add(stool);
  let fig: Character | null = null;
  const dress = () => { if (fig) { turntable.remove(fig.group); fig.dispose(); } fig = character(avatar); turntable.add(fig.group); stool.scale.y = fig.seat / 0.45; };
  dress();

  // drag to spin, and it keeps turning slowly when let go
  let turn = 0, spin = 0.35, held = false, drag: { x: number; at: number } | null = null;
  stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, at: performance.now() }; stage.setPointerCapture(e.pointerId); spin = 0; held = false; });
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
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!drag && !held) { spin += (0.35 * Math.sign(spin || 1) - spin) * Math.min(1, dt * 1.5); turn += spin * dt; }
    turntable.rotation.y = turn;
    stool.visible = pose === "sit" || pose === "keys" || pose === "sticks";
    const play: Play | null = pose === "keys" || pose === "sticks" || pose === "strings" ? pose : null;
    fig?.pose({ t: now / 1000, speed: pose === "walk" ? 1.4 : 0, seated: pose === "sit" || pose === "keys" || pose === "sticks", play });
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // the rows: one button a choice, the chosen one pressed; colour rows are round swatches
  const buttons = new Map<Part, HTMLButtonElement[]>();
  const row = (label: string, parent: HTMLElement) => { const r = el("div", "ch-row", parent); el("span", "ch-label", r).textContent = label; return el("div", "ch-choices", r); };
  for (const [part, label] of ROWS) {
    const list = row(label, rows), bs: HTMLButtonElement[] = [];
    for (const v of PARTS[part]) {
      const b = el("button", COLOUR.has(part) ? "ch-swatch" : "ch-chip", list);
      b.type = "button"; b.dataset.value = v;
      if (COLOUR.has(part)) { b.style.background = v; b.title = v; b.setAttribute("aria-label", `${label} ${v}`); } else b.textContent = word(v);
      b.addEventListener("click", () => pick(part, v));
      bs.push(b);
    }
    buttons.set(part, bs);
  }
  const poses = row("Try it", rows), poseButtons: HTMLButtonElement[] = [];
  for (const [k, w] of Object.entries(POSES) as [PoseName, string][]) {
    const b = el("button", "ch-chip", poses);
    b.type = "button"; b.dataset.value = k; b.textContent = w;
    b.addEventListener("click", () => { pose = k; show(); });
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
    for (const [part, bs] of buttons) for (const b of bs) {
      const on = b.dataset.value === avatar[part];
      b.setAttribute("aria-pressed", String(on));
      // the chosen one in sight in its row (a row scrolls sideways rather than wrap), without moving the page
      const list = b.parentElement;
      if (on && list && (b.offsetLeft < list.scrollLeft || b.offsetLeft + b.offsetWidth > list.scrollLeft + list.clientWidth)) list.scrollLeft = b.offsetLeft - list.clientWidth / 2 + b.offsetWidth / 2;
    }
    for (const b of poseButtons) b.setAttribute("aria-pressed", String(b.dataset.value === pose));
    saveButton.disabled = !dirty && saved;
    note.textContent = status || (dirty ? "Not saved yet" : saved ? "Saved" : "Not saved yet: this one is made from your name");
  }
  function pick(part: Part, value: string) {
    if (!(PARTS[part] as readonly string[]).includes(value)) throw new Error(`${part} is one of ${PARTS[part].join(", ")}`);
    avatar = { ...avatar, [part]: value }; dirty = true; status = ""; dress(); show();
  }
  function shuffle() { avatar = randomAvatar(Math.random); dirty = true; status = ""; dress(); show(); }
  async function save() {
    status = "Saving…"; show();
    const r = await getJson("/me/avatar", AvatarReply, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(avatar) });
    if (r) { avatar = r.avatar; saved = true; dirty = false; status = ""; } else status = "Couldn't save. Try again.";
    show();
    return state();
  }
  const state = () => ({ avatar, saved, dirty, pose, status, turn: Math.round(THREE.MathUtils.radToDeg(turn) % 360), first, height: fig ? Math.round(fig.height * 100) / 100 : 0 });
  show();
  /** Stop turning, facing `deg` (0: its face to you), for a picture; a drag sets it spinning again. */
  const turnTo = (deg: number) => { turn = THREE.MathUtils.degToRad(deg); held = true; return state(); };
  return { state, pick, shuffle, save, turnTo, pose: (p: PoseName) => { if (!(p in POSES)) throw new Error(`pose is one of ${Object.keys(POSES).join(", ")}`); pose = p; show(); return state(); } };
}

if (typeof document !== "undefined") {
  const box = document.getElementById("character");
  if (box) void mountCharacter(box).then((h) => Object.assign(window, { __character: h }));
}
