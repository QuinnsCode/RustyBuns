// Plays a cutscene (cutscene.ts) in the battle's own three.js scene: builds its cast from the
// battle's models, turns its frame onto the field at an origin, and each frame poses the actors,
// flies the camera and puts up the words, under letterbox bars in the storyteller's lettering.
// Space, Enter, Esc or a click skips it. The battle doesn't step while it plays.
import * as THREE from "three";
import { actorsAt, cameraAt, castOf, firedBetween, lengthOf, place, wordsAt, type Cutscene, type Noise, type Origin } from "./cutscene.ts";
import { animate, crate, dropship, marine, wooka } from "./models.ts";
import type { Sfx } from "./sfx.ts";
import { makeBubbles } from "../ui/bubbles.ts";

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render: () => void;
  ground: (x: number, z: number) => number;
  sfx: Sfx;
  host: HTMLElement; // what the letterbox and the words go over
}

// Whether a scene should play: once per browser unless ?cutscenes=always, never with ?cutscenes=off.
export function shouldPlay(id: string) {
  const q = new URLSearchParams(location.search).get("cutscenes");
  if (q === "off") return false;
  if (q === "always") return true;
  try {
    if (localStorage.getItem(`two-fronts:seen:${id}`)) return false;
    localStorage.setItem(`two-fronts:seen:${id}`, "1");
  } catch { /* private window: play it */ }
  return true;
}

// Which ride down this is, counted per browser, so each battle gets the next seat's story.
export function nextRide() {
  let n = 0;
  try {
    n = Number(localStorage.getItem("two-fronts:ride")) || 0;
    localStorage.setItem("two-fronts:ride", String(n + 1));
  } catch { n = Math.floor(Math.random() * 1000); }
  return n;
}

export function playCutscene(cut: Cutscene, stage: Stage, origin: Origin): Promise<void> {
  const { scene, camera, render, ground, sfx, host } = stage;
  const len = lengthOf(cut);
  const meshes = new Map<string, THREE.Group>();
  for (const c of castOf(cut)) {
    const g = "marine" in c.as ? marine(false, c.as.marine) : "wooka" in c.as ? wooka(false, c.as.wooka) : c.as.prop === "dropship" ? dropship() : crate();
    g.userData.last = null;
    g.userData.chute = g.getObjectByName("chute") ?? null;
    g.visible = false;
    scene.add(g);
    meshes.set(c.id, g);
  }
  const ui = document.createElement("div");
  ui.className = `cut ${cut.faction}`;
  ui.innerHTML = `<div class="cut-bar top"></div><div class="cut-bar bottom"></div><div class="cut-title"><b></b><small></small></div><div class="cut-caption"><b></b><span></span></div><div class="cut-skip">Space to skip</div>`;
  host.append(ui);
  const bubbles = makeBubbles(ui);
  const titleEl = ui.querySelector<HTMLElement>(".cut-title")!, captionEl = ui.querySelector<HTMLElement>(".cut-caption")!;
  const fov = camera.fov, head = new THREE.Vector3(), look = new THREE.Vector3();
  let shake = 0;

  const at = (x: number, z: number, y = 0) => {
    const p = place(origin, x, z);
    return new THREE.Vector3(p.x, ground(p.x, p.z) + y, p.z);
  };
  return new Promise((resolve) => {
    let t = 0, last = performance.now(), raf = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", key, true);
      host.removeEventListener("pointerdown", finish);
      for (const g of meshes.values()) scene.remove(g);
      bubbles.remove();
      ui.remove();
      camera.fov = fov;
      camera.updateProjectionMatrix();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (![" ", "Enter", "Escape"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      finish();
    };
    addEventListener("keydown", key, true);
    host.addEventListener("pointerdown", finish);
    const noise = (n: Noise, p: { x: number; z: number } | null) => {
      if (n === "chatter") sfx.chatter(p, 0.5);
      else if (n === "hoot") sfx.hoot(p, 0.55);
      else if (n === "bark") sfx.bark(p, 0.6);
      else if (n === "howl") sfx.howl(p, 0.8, 0.8);
      else if (n === "thump") sfx.thump(p, 0.7);
      else if (n === "whoop") sfx.whoop(p, 0.55);
      else if (n === "squeal") sfx.hurt("wooka", p, true, 0.6);
      else if (n === "grunt") sfx.hurt("marines", p, true, 0.6);
      else if (n === "boom") sfx.boom(p ?? { x: origin.x, z: origin.z }, false);
      else if (n === "drum") sfx.drum();
      else if (n === "rotor") sfx.rotor();
      else if (n === "warn") sfx.warn();
      else sfx.chime();
    };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000), t0 = t;
      last = now;
      t += dt;
      if (t >= len) return finish();
      const actors = actorsAt(cut, t), byId = new Map(actors.map((a) => [a.id, a]));
      for (const c of firedBetween(cut, t0, t)) {
        if (c.do === "shake") shake = Math.max(shake, c.amount);
        else if (c.do === "sound") {
          const a = c.id ? byId.get(c.id) : undefined, who = c.id ? meshes.get(c.id) : undefined;
          if (who && ["howl", "hoot", "bark", "thump"].includes(c.noise)) who.userData.calledAt = performance.now();
          noise(c.noise, a ? place(origin, a.x, a.z) : null);
        }
      }
      for (const [id, g] of meshes) {
        const a = byId.get(id);
        g.visible = !!a;
        if (!a) continue;
        const p = at(a.x, a.z, a.y);
        const lastAt = g.userData.last as THREE.Vector3 | null, moved = lastAt ? Math.hypot(p.x - lastAt.x, p.z - lastAt.z) : 0;
        g.userData.last = p.clone();
        g.position.copy(p);
        g.scale.setScalar(a.scale);
        g.rotation.set(a.flying ? now / 90 : 0, a.yaw + origin.yaw, a.flying ? now / 130 : a.roll);
        const chute = g.userData.chute as THREE.Object3D | null;
        if (chute) chute.visible = a.chute;
        animate(g, { t: now / 1000, dt, moved: a.moving && moved < 3 ? moved : 0, since: 1, call: (performance.now() - ((g.userData.calledAt as number | undefined) ?? -1e9)) / 1000 });
      }
      // Shots are framed for a wide screen. On a tall one, open the view up so the sides stay in.
      const wide = camera.aspect < 1.2 ? Math.min(100, (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * (1.2 / camera.aspect)) * 180) / Math.PI) : fov;
      if (camera.fov !== wide) { camera.fov = wide; camera.updateProjectionMatrix(); }
      const cam = cameraAt(cut, t);
      if (cam) {
        const [px, py, pz] = cam.pos, [lx, ly, lz] = cam.look;
        camera.position.copy(at(px, pz, py));
        camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.4);
        look.copy(at(lx, lz, ly));
        if (shake > 0) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
        camera.lookAt(look);
      }
      shake = Math.max(0, shake - dt * 2.5);
      render();
      // The words: a title card, a caption, and bubbles over whoever is talking.
      const w = wordsAt(cut, t);
      titleEl.classList.toggle("show", !!w.title);
      if (w.title) { titleEl.firstElementChild!.textContent = w.title.text; titleEl.lastElementChild!.textContent = w.title.sub ?? ""; }
      captionEl.classList.toggle("show", !!w.caption);
      if (w.caption) { captionEl.firstElementChild!.textContent = w.caption.who ?? ""; captionEl.lastElementChild!.textContent = w.caption.text; }
      const W = host.clientWidth, H = host.clientHeight;
      for (const s of w.bubbles) {
        const a = byId.get(s.id), g = meshes.get(s.id);
        if (!a || !g) continue;
        head.copy(g.position).setY(g.position.y + 2.1 * a.scale).project(camera);
        bubbles.put(s.id, s.text, head.z < 1 ? { x: (head.x * 0.5 + 0.5) * W, y: (-head.y * 0.5 + 0.5) * H } : null, cut.faction);
      }
      bubbles.sweep();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
