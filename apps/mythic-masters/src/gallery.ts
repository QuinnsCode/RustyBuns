// The gallery: sixteen of the roster at a time, standing in a 4 × 4 grid at their fight size, each in its own
// beast, facing the camera. For judging the art as a set: does each read from
// its silhouette, and do the sizes make sense next to each other? `?gallery=<page>` opens it (pages 0-3).
import * as THREE from "three";
import { loadBeast, Puppet, reloadBeast, type Beast } from "./beasts.ts";
import { clamp } from "@rustybuns/util";
import { FX_AMOUNT } from "./effects.ts";
import { tierOf } from "./tiers.ts";
import type { Creature } from "./roster.ts";
import { newMatch, type Fighter } from "./sim.ts";

export const PAGE = 16;
const SPACING = 4.2;

export function gallery(scene: THREE.Scene, camera: THREE.PerspectiveCamera, roster: Creature[], page: number) {
  const group = new THREE.Group(), stands: Stand[] = [];
  let dark = false;
  const FOV = camera.fov;
  scene.add(group);
  const pending: Promise<void>[] = [];
  const shown = roster.slice(page * PAGE, page * PAGE + PAGE);
  shown.forEach((c, i) => {
    const f = newMatch(c, c).f[0];
    f.pos = { x: ((i % 4) - 1.5) * SPACING, y: 0, z: (Math.floor(i / 4) - 1.5) * SPACING };
    f.yaw = Math.PI / 4; // three-quarter: half profile, half toward the camera
    const stand: Stand = { id: c.id, f, p: null, beast: null, hidden: false };
    stands.push(stand);
    pending.push(loadBeast(c.id).then((beast) => put(stand, beast, c.archetype, c.fields, FX_AMOUNT[tierOf(c.id)])).catch(() => {}));
  });
  function put(stand: Stand, beast: Beast | null, archetype: Creature["archetype"], fields: Creature["fields"], fx = 1) {
    if (!beast || !group.parent) return;
    if (stand.p) group.remove(stand.p.group);
    stand.beast = beast;
    stand.p = new Puppet(beast, stand.f.b, archetype, fields, fx);
    stand.p.wearTile(fields);
    stand.p.group.visible = !stand.hidden;
    group.add(stand.p.group);
    paint(stand.p.group, dark);
  }
  // Orbit: stays null (the camera is whatever home() or focus() put there) until the first drag, wheel or click.
  const aim = new THREE.Vector3(0, 0.6, 0.5), orbit = { target: new THREE.Vector3(), yaw: 0, pitch: 0, dist: 1 };
  let orbiting = false;
  const home = () => { camera.position.set(0, 13, 17); aim.set(0, 0.6, 0.5); camera.lookAt(aim); orbiting = false; };
  home();
  const place = () => {
    const c = Math.cos(orbit.pitch);
    camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * c * orbit.dist, orbit.target.y + Math.sin(orbit.pitch) * orbit.dist, orbit.target.z + Math.cos(orbit.yaw) * c * orbit.dist);
    camera.lookAt(orbit.target);
  };
  const begin = () => {
    if (orbiting) return;
    orbiting = true;
    orbit.target.copy(aim);
    const dx = camera.position.x - aim.x, dy = camera.position.y - aim.y, dz = camera.position.z - aim.z;
    orbit.dist = Math.hypot(dx, dy, dz);
    orbit.yaw = Math.atan2(dx, dz);
    orbit.pitch = Math.asin(dy / orbit.dist);
  };
  const zoom = (k: number) => { begin(); orbit.dist = clamp(orbit.dist * k, 1.5, 60); };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), box = new THREE.Box3(), mid = new THREE.Vector3();
  /** Centre and zoom on the beast under the pointer, if there is one. */
  const centre = (e: PointerEvent, canvas: HTMLElement) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const s of stands) {
      if (!s.p || !s.beast || s.hidden || !ray.intersectObject(s.p.group, true).length) continue;
      begin();
      box.setFromObject(s.p.group).getCenter(mid);
      orbit.target.copy(mid);
      orbit.dist = clamp(Math.max(s.beast.sheet.height, s.beast.sheet.extent) * 2.2, 3, 60);
      return;
    }
  };
  // Window listeners that only react to events on the canvas; one pointer orbits, two pinch.
  const pts = new Map<number, { x: number; y: number }>();
  let moved = 0, pinch = 0;
  const onCanvas = (e: Event) => e.target instanceof HTMLCanvasElement;
  const gap = () => { const [a, b] = [...pts.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  const down = (e: PointerEvent) => {
    if (!onCanvas(e)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) moved = 0;
    if (pts.size === 2) pinch = gap();
  };
  const move = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size === 2) { const g = gap(); if (pinch > 0 && g > 0) zoom(pinch / g); pinch = g; return; }
    if (moved < 4) return;
    begin();
    orbit.yaw -= dx * 0.008;
    orbit.pitch = clamp(orbit.pitch + dy * 0.008, 0.05, 1.5);
  };
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (e.type === "pointerup" && pts.size === 0 && moved < 4 && onCanvas(e)) centre(e, e.target as HTMLElement);
  };
  const wheel = (e: WheelEvent) => { if (!onCanvas(e)) return; e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); };
  const dbl = (e: MouseEvent) => { if (onCanvas(e)) home(); };
  const view = document.querySelector<HTMLElement>("canvas#view"), touch = view?.style.touchAction ?? "";
  if (view) view.style.touchAction = "none";
  window.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("dblclick", dbl);
  let tick = 0;
  return {
    /** Settles once every beast on the page has loaded (or failed to), so a shot is taken of a full grid. */
    ready: () => Promise.all(pending).then(() => stands.filter((s) => !s.beast).map((s) => s.id)),
    names: shown.map((c) => c.name),
    /** Each beast on the page: what its files say (null until they load). */
    stands: stands as readonly Stand[],
    /** One beast filling the frame from `view` (the rest hidden); "grid" puts them all back. */
    focus(id: string, view: View) {
      const s = stands.find((x) => x.id === id);
      if (!s || !s.beast) return false;
      if (view === "grid") { for (const o of stands) { o.hidden = false; if (o.p) o.p.group.visible = true; } home(); return true; }
      for (const o of stands) { o.hidden = o !== s; if (o.p) o.p.group.visible = o === s; }
      s.f.yaw = YAW[view];
      const { height, extent } = s.beast.sheet, size = Math.max(height, extent);
      const d = (size * 1.0) / Math.tan((FOV * Math.PI) / 360) * Math.max(1, camera.aspect < 1 ? 1 / camera.aspect : 1) + extent / 2;
      camera.position.set(s.f.pos.x, s.f.pos.y + height * 0.55, s.f.pos.z + d);
      aim.set(s.f.pos.x, s.f.pos.y + height * 0.45, s.f.pos.z);
      camera.lookAt(aim);
      orbiting = false;
      return true;
    },
    /** Every beast flat black against the sky, to read each from its outline alone. */
    silhouette(on: boolean) { dark = on; for (const s of stands) if (s.p) paint(s.p.group, on); },
    /** Fetch one beast's files again and stand the new puppet where the old one was. */
    async reload(id: string) {
      const s = stands.find((x) => x.id === id), c = roster.find((x) => x.id === id);
      if (s && c) put(s, await reloadBeast(id), c.archetype, c.fields, FX_AMOUNT[tierOf(c.id)]);
    },
    update(dt: number) {
      tick++;
      if (orbiting) place();
      for (const s of stands) s.p?.update(s.f, dt, tick, { x: s.f.pos.x, y: 1, z: s.f.pos.z + 10 });
    },
    dispose() {
      scene.remove(group);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("dblclick", dbl);
      if (view) view.style.touchAction = touch;
    },
  };
}

export type View = "side" | "front" | "three-quarter" | "grid";
// A beast faces +x at yaw 0 (side-on to the camera) and +z, toward it, at a quarter turn.
const YAW: Record<Exclude<View, "grid">, number> = { side: 0, front: Math.PI / 2, "three-quarter": Math.PI / 4 };
interface Stand { id: string; f: Fighter; p: Puppet | null; beast: Beast | null; hidden: boolean }

const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const was = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
/** Swap every mesh under `o` to flat black, or back to what it was. */
function paint(o: THREE.Object3D, black: boolean) {
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    if (black) { if (!was.has(m)) was.set(m, m.material); m.material = BLACK; }
    else { const w = was.get(m); if (w) { m.material = w; was.delete(m); } }
  });
}
