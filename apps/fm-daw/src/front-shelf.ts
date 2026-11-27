// The front door's shelf (#6019): once a lane is open, each of its paths stands as a thing turning slowly in the dark,
// the way a console's memory card screen turns its saves' icons: the guitar for Learn the setup, a speaker stack for the
// Event Planner, the desk's own screen for QDAW, a turntable, an amp on its cab, a real pedal's board (circuits/
// drive.pcb.svg) for Q Builder, and a mic for The Event. One WebGL renderer draws them all, only the ones on the screen,
// at 30 frames a second at most, into a 2D canvas each. Each swings like a pendulum, a quarter turn each way of its
// front, rather than spinning round to its back. The one nearest the middle of the screen swings fastest, and
// scrolling swings them all a little faster. With reduced motion each is drawn once, facing you.
import * as THREE from "three";
import { GEAR_SIZES, gear, gearLook, type GearId } from "@rustybuns/models/gear";
import pcbUrl from "../circuits/drive.pcb.svg?url";

export type ShelfItem = "guitar" | "stack" | "screen" | "turntable" | "amp" | "board" | "mic";

/** The desk's own screen, as it opens with the demo beat (public/door/daw.jpg). */
const DAW_SHOT = "/door/daw.jpg";
/** The pixels each item is drawn at before its canvas scales it: square, enough for a card's thing at 2x. */
const PX = 512;
/** How far each thing swings from its front, each way: a quarter turn, so it sweeps half a turn and back; the flat
 *  screen and board swing less, so they never turn edge-on. Everything is built facing you (+z). */
const SWING: Record<ShelfItem, number> = { guitar: Math.PI / 2, stack: Math.PI / 2, turntable: Math.PI / 2, amp: Math.PI / 2, mic: Math.PI / 2, screen: 0.85, board: 0.85 };

/** Pieces of gear stood one on another, bottom first, each centred over the one under it. */
function stacked(ids: readonly GearId[]) {
  const g = new THREE.Group(), look = gearLook();
  let y = 0;
  for (const id of ids) {
    const m = gear(id, { look }), b = new THREE.Box3().setFromObject(m);
    m.position.set(-(b.min.x + b.max.x) / 2, y - b.min.y, -(b.min.z + b.max.z) / 2);
    g.add(m); y += GEAR_SIZES[id][1];
  }
  return g;
}

/** An image on a canvas texture, cropped to [x, y, w, h] of its own width and height (0 to 1), and filled in once it loads. */
function picture(url: string, crop: readonly [number, number, number, number] = [0, 0, 1, 1]) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 640;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    // drawn into the canvas at the size it was made (an uploaded texture keeps its size); the face's UVs stretch it back
    const [x, y, w, h] = crop, sw = img.naturalWidth || 800, sh = img.naturalHeight || 600;
    c.getContext("2d")!.drawImage(img, x * sw, y * sh, w * sw, h * sh, 0, 0, c.width, c.height);
    tex.needsUpdate = true;
  };
  // a drawing with only a viewBox has no size of its own and draws as nothing: give it the viewBox's
  if (url.endsWith(".svg")) void fetch(url).then((r) => r.text()).then((svg) => {
    const box = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    img.src = URL.createObjectURL(new Blob([box ? svg.replace("<svg ", `<svg width="${box[1]}" height="${box[2]}" `) : svg], { type: "image/svg+xml" }));
  });
  else img.src = url;
  return tex;
}

/** The desk's screen: a slim monitor on a foot, the DAW on its face. */
function screen() {
  const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.4, roughness: 0.45 });
  const w = 1.6, h = 1.0;
  const face = new THREE.MeshBasicMaterial({ map: picture(DAW_SHOT), toneMapped: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.05), [dark, dark, dark, dark, face, face]); // the DAW on both faces, so it never turns its back
  body.position.y = 0.75;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.05), dark); neck.position.set(0, 0.25, -0.06);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.35), dark); foot.position.set(0, 0.015, -0.02);
  g.add(body, neck, foot);
  return g;
}

/** A pedal's board: the drive's own copper (circuits/drive.pcb.svg) on green, its pots and its jacks standing up from it. */
function board() {
  const g = new THREE.Group(), w = 1.3, d = 1.1, t = 0.04; // the board is 650 x 550 of the drawing's 800 x 600
  const edge = new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.7 });
  const copper = picture(pcbUrl, [75 / 800, 25 / 600, 650 / 800, 550 / 600]); // the copper glows a little, so it reads in the dark
  const top = new THREE.MeshStandardMaterial({ map: copper, emissiveMap: copper, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.55, metalness: 0.2 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, t, d), [edge, edge, top, edge, edge, edge]));
  const pot = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.8, roughness: 0.3 }), knob = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 });
  for (const x of [-0.4, 0, 0.4]) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 24), pot); can.position.set(x, t / 2 + 0.04, -d / 2 + 0.16);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 24), knob); cap.position.set(x, t / 2 + 0.15, -d / 2 + 0.16);
    g.add(can, cap);
  }
  for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
    const jack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.18), knob); jack.position.set(x, t / 2 + 0.07, d / 2 - 0.16);
    g.add(jack);
  }
  g.rotation.x = 1.2; // stood up, its copper toward you, as a card is held up to show it
  return g;
}

function model(kind: ShelfItem): THREE.Object3D {
  switch (kind) {
    case "guitar": return stacked(["guitar"]);
    case "stack": return stacked(["sub-18", "top-12-powered"]);
    case "turntable": return stacked(["turntable"]);
    case "amp": return stacked(["cab-4x12", "amp-head"]);
    case "mic": return stacked(["mic-stand"]);
    case "screen": return screen();
    case "board": return board();
  }
}

/** A model scaled so its largest side is 1 and its middle sits at the origin, inside a turntable group that spins. */
function onTurntable(kind: ShelfItem) {
  const m = model(kind), b = new THREE.Box3().setFromObject(m), size = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
  const s = 1 / Math.max(size.x, size.y, size.z, 1e-3);
  m.position.sub(mid).multiplyScalar(s); m.scale.multiplyScalar(s);
  const spin = new THREE.Group(); spin.add(m);
  return spin;
}

interface Slot { canvas: HTMLCanvasElement; kind: ShelfItem; tone: THREE.Color; spin: THREE.Group | null; seen: boolean; phase: number; focus: boolean; drawn: boolean }

export function mountShelf() {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 0.35, 2.6); camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2018, 2.2));
  const key = new THREE.DirectionalLight(0xfff1e0, 3.2); key.position.set(1.5, 2, 2.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8d4ff, 1.4); fill.position.set(-1.8, 0.4, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 2.4); rim.position.set(-2, 1, -2); scene.add(rim);
  const slots: Slot[] = [];
  let boost = 0, last = 0, frame = 0, frames = 0, lastY = scrollY;

  const seen = new IntersectionObserver((es) => { for (const e of es) { const s = slots.find((s) => s.canvas === e.target); if (s) s.seen = e.isIntersecting; } wake(); });

  function draw(s: Slot) {
    renderer ??= (() => { const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(PX, PX, false); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.5; return r; })();
    s.spin ??= onTurntable(s.kind);
    scene.add(s.spin); s.spin.rotation.y = SWING[s.kind] * Math.sin(s.phase); rim.color.copy(s.tone);
    renderer.render(scene, camera); scene.remove(s.spin);
    const c = s.canvas, g = c.getContext("2d")!;
    if (c.width !== PX) { c.width = PX; c.height = PX; }
    g.clearRect(0, 0, PX, PX); g.drawImage(renderer.domElement, 0, 0);
    s.drawn = true; frames++;
  }
  function tick(now: number) {
    frame = 0;
    const live = slots.filter((s) => s.seen);
    if (!live.length) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0);
    if (still) { for (const s of live) if (!s.drawn) { s.phase = 0; draw(s); } return; }
    if (now - last < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
    last = now;
    // the thing nearest the middle of the screen is the one picked, as on the memory card screen: it turns fastest
    const mid = innerHeight / 2;
    let best: Slot | null = null, bestD = Infinity;
    for (const s of live) { const r = s.canvas.getBoundingClientRect(), d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < bestD) { bestD = d; best = s; } }
    for (const s of live) {
      s.focus = s === best; s.canvas.closest(".path")?.classList.toggle("focus", s.focus);
      s.phase += dt * ((s.focus ? 1.1 : 0.35) + boost);
      draw(s);
    }
    boost *= 0.9;
    frame = requestAnimationFrame(tick);
  }
  function wake() { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); }
  addEventListener("scroll", () => { boost = Math.min(6, boost + Math.abs(scrollY - lastY) * 0.01); lastY = scrollY; wake(); }, { passive: true });
  document.addEventListener("visibilitychange", wake);

  return {
    /** Puts a thing on a card's canvas, lit at the back in `tone`; it is built and drawn once it comes onto the screen. */
    add(canvas: HTMLCanvasElement, kind: ShelfItem, tone: string) {
      const s: Slot = { canvas, kind, tone: new THREE.Color(tone), spin: null, seen: false, phase: 0, focus: false, drawn: false };
      slots.push(s); seen.observe(canvas);
    },
    /** What the shelf has drawn: each thing, whether it is on the screen, picked and drawn, and the frames drawn so far. */
    state: () => ({ items: slots.map((s) => ({ kind: s.kind, seen: s.seen, focus: s.focus, drawn: s.drawn })), frames }),
  };
}
