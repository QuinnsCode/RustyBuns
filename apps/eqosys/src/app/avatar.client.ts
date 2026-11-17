// The character picker on the Account tab (#4987): your figure large in the middle (packages/models' character), turning
// slowly, drag to spin; a row of choices for each part, colour swatches, poses, Shuffle and Save. It keeps the look on
// your account (GET/PUT /me/avatar, read through AvatarReply), so every Q app dresses you the same. commands.client.ts
// imports this only when the page has an #avatar box, so three.js loads on that tab alone. Its handle is
// `window.__avatar` (`bun run probe eqosys /?tab=account --js "__avatar.state()"`).
import * as THREE from "three";
import { createElement, Save, Shuffle } from "lucide";
import { character, type Character, type CharacterPose } from "@rustybuns/models";
import { AvatarReply, PARTS, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { getJson, readJson } from "@rustybuns/util/http";

type Part = keyof typeof PARTS;
const LABELS: Record<Part, string> = {
  build: "Build", skin: "Skin", hair: "Hair", hairColor: "Hair colour", eyes: "Eyes", mouth: "Mouth", glasses: "Glasses",
  hat: "Hat", top: "Top", topColor: "Top colour", bottomColor: "Trousers",
};
const ORDER: Part[] = ["build", "skin", "hair", "hairColor", "eyes", "mouth", "glasses", "hat", "top", "topColor", "bottomColor"];
const COLOURS = new Set<Part>(["skin", "hairColor", "topColor", "bottomColor"]);
const POSES = [["stand", "Stand"], ["walk", "Walk"], ["sit", "Sit"], ["keys", "Keys"], ["sticks", "Drums"], ["strings", "Guitar"]] as const;
type PoseId = (typeof POSES)[number][0];
const word = (v: string) => v.replaceAll("-", " ");
/** The same name hash the figure's face varies by, so you look the same everywhere. */
const seedOf = (name: string) => { let h = 2166136261; for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

export async function mountAvatar(box: HTMLElement) {
  const got = await getJson("/me/avatar", AvatarReply, { credentials: "same-origin" });
  if (!got) { box.textContent = "Sign in to make your character."; return null; }
  const name = box.dataset.name ?? "";
  let look: Avatar = got.avatar, saved: Avatar = got.avatar, chosen = got.chosen, pose: PoseId = "stand", status = "";
  let spin = 0.5, dragging = false, lastX = 0, idle = 0, zoom = 1;

  // ---- the stage
  const stage = el("div", { cls: "av-stage" });
  const canvas = el("canvas", { cls: "av-canvas", ariaLabel: "Your character. Drag to turn it round." });
  stage.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  scene.add(new THREE.HemisphereLight("#fff6ea", "#5a6470", 1.6));
  const key = new THREE.DirectionalLight("#ffffff", 2.4);
  key.position.set(-1.1, 4, -1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 2.2, bottom: -0.2 });
  const rim = new THREE.DirectionalLight("#9fd8ff", 1.2);
  rim.position.set(2, 2, 2);
  scene.add(key, rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.75, 48), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const turntable = new THREE.Group();
  scene.add(turntable);
  let fig: Character | null = null;
  const dress = () => {
    if (fig) { turntable.remove(fig.group); fig.dispose(); }
    fig = character(look, seedOf(name));
    turntable.add(fig.group);
  };
  dress();

  const fit = () => {
    const w = stage.clientWidth || 320, h = stage.clientHeight || 420;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // the whole figure, head to toe, with room for a tall hat
    const dist = 2.05 / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect * 1.6) * 0.47;
    // zoomed in, the camera slides up to the face
    const lift = Math.min(1, zoom - 1), y = 0.85 + lift * ((fig?.height ?? 1.6) - 0.3 - 0.85);
    camera.position.set(0, y + 0.2 * (1 - lift), -dist / zoom);
    camera.lookAt(0, y, 0);
  };
  new ResizeObserver(fit).observe(stage);
  fit();

  stage.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener("pointermove", (e) => { if (!dragging) return; spin += (e.clientX - lastX) * 0.012; lastX = e.clientX; idle = 0; });
  const up = () => { dragging = false; };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);

  // ---- the rows
  const rows = el("div", { cls: "av-rows" });
  const buttons = new Map<Part, HTMLButtonElement[]>();
  for (const p of ORDER) {
    const strip = el("div", { cls: COLOURS.has(p) ? "av-strip swatches" : "av-strip", role: "radiogroup", ariaLabel: LABELS[p] });
    const opts = PARTS[p].map((v) => {
      const b = el("button", { type: "button", title: word(v), ariaLabel: `${LABELS[p]}: ${word(v)}`, role: "radio" });
      if (COLOURS.has(p)) b.style.setProperty("--sw", v);
      else b.textContent = word(v);
      b.addEventListener("click", () => set(p, v));
      strip.append(b);
      return b;
    });
    buttons.set(p, opts);
    rows.append(el("div", { cls: "av-row" }, el("span", { cls: "av-label" }, LABELS[p]), strip));
  }

  const poses = el("div", { cls: "av-strip av-poses", role: "radiogroup", ariaLabel: "Pose" });
  const poseButtons = POSES.map(([id, label]) => {
    const b = el("button", { type: "button", role: "radio", title: label }, label);
    b.addEventListener("click", () => { pose = id; paint(); });
    poses.append(b);
    return [id, b] as const;
  });
  const icon = (i: Parameters<typeof createElement>[0]) => createElement(i, { width: 18, height: 18, "aria-hidden": "true" });
  const shuffleBtn = el("button", { type: "button", cls: "ui-btn", title: "Shuffle" }, icon(Shuffle), el("span", {}, "Shuffle"));
  const saveBtn = el("button", { type: "button", cls: "ui-btn primary", title: "Save" }, icon(Save), el("span", {}, "Save"));
  const note = el("span", { cls: "av-note mut", role: "status" });
  shuffleBtn.addEventListener("click", () => shuffle());
  saveBtn.addEventListener("click", () => void save());
  const bar = el("div", { cls: "av-bar" }, shuffleBtn, saveBtn, note);

  box.replaceChildren(el("div", { cls: "av" }, el("div", { cls: "av-left" }, stage, poses), el("div", { cls: "av-right" }, rows, bar)));

  const same = (a: Avatar, b: Avatar) => ORDER.every((k) => a[k] === b[k]);
  function paint() {
    for (const [p, list] of buttons) for (const [i, b] of list.entries()) b.ariaChecked = String(PARTS[p][i] === look[p]);
    for (const [id, b] of poseButtons) b.ariaChecked = String(id === pose);
    const dirty = !same(look, saved);
    saveBtn.disabled = !dirty && chosen;
    note.textContent = status || (dirty ? "Not saved yet" : chosen ? "Saved on your account" : "Made from your name. Save it to keep it.");
  }
  function set(p: Part, v: string) {
    if (look[p] === v) return;
    look = { ...look, [p]: v };
    status = "";
    dress(); paint();
  }
  function shuffle() { look = randomAvatar(Math.random); status = ""; dress(); paint(); }
  async function save() {
    saveBtn.disabled = true;
    status = "Saving...";
    paint();
    const r = await fetch("/me/avatar", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(look) }).catch(() => null);
    const back = r?.ok ? await readJson(r, AvatarReply) : null;
    if (back) { saved = back.avatar; chosen = true; status = ""; } else status = "Couldn't save. Try again.";
    paint();
    if (back && box.dataset.first) box.dispatchEvent(new CustomEvent("avatar-saved", { bubbles: true }));
    return !!back;
  }
  paint();

  // ---- the loop: turning slowly, posed, only while the page shows
  const clock = new THREE.Clock();
  let running = true, t = 0;
  const frame = () => {
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;
    idle += dt;
    if (!dragging && idle > 1.5) spin += dt * 0.35;
    turntable.rotation.y = spin;
    const p: CharacterPose = { t, walk: pose === "walk" ? 1.3 : 0, seated: pose === "sit" || pose === "keys" || pose === "sticks" || pose === "strings", play: pose === "keys" || pose === "sticks" || pose === "strings" ? pose : null };
    fig?.pose(p);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener("pagehide", () => { running = false; fig?.dispose(); renderer.dispose(); }, { once: true });

  return {
    state: () => ({ avatar: look, saved, chosen, dirty: !same(look, saved), pose, spin: Number(spin.toFixed(2)), status: note.textContent, height: fig ? Number(fig.height.toFixed(3)) : 0 }),
    set, shuffle, save,
    pose: (id: PoseId) => { pose = id; paint(); },
    spin: (radians: number) => { spin = radians; idle = 0; },
    /** 1 is head to toe, 3 the face up close: for a probe shot. */
    zoom: (f: number) => { zoom = Math.max(1, Math.min(4, f)); fit(); },
    parts: () => PARTS,
  };
}
