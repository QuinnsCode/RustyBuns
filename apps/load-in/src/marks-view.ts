// The crew's spike marks on the floor (Level.marks): an X of white gaffer tape where each stand goes, with the stand's
// letter, and over it a ghost of the speaker that goes on top, drawn in light so it reads from the door in a dark room.
// The ghost fades once a speaker is up on that spot; the tape stays, as it does on a real stage.
import * as THREE from "three";
import { gear } from "@rustybuns/gear";
import type { World } from "./sim.ts";

/** Where a top sits on a stand, metres up (the dive bar's stands at their low setting). */
const TOP_Y = 1.2;

function tapeTexture(letter: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  g.fillStyle = "rgba(240, 236, 222, 0.95)";
  for (const a of [Math.PI / 4, -Math.PI / 4]) { g.save(); g.rotate(a); g.fillRect(-110, -15, 220, 30); g.restore(); }
  g.fillStyle = "rgba(20, 18, 16, 0.9)";
  g.font = "700 64px 'Permanent Marker', 'Comic Sans MS', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(letter, 0, 70);
  return new THREE.CanvasTexture(c);
}

export function marksView(scene: THREE.Scene) {
  let group = new THREE.Group();
  let ghosts: { key: string; x: number; z: number; fill: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial }[] = [];
  scene.add(group);
  return {
    /** Lay the level's tape (a new level, a new floor). */
    build(world: World) {
      scene.remove(group);
      group = new THREE.Group();
      ghosts = [];
      const s = gear("top-12-powered").size, box = new THREE.BoxGeometry(s.w, s.h, s.d).translate(0, s.h / 2, 0);
      for (const m of world.level.marks ?? []) {
        const floor = world.level.floorAt?.(m.x, m.z) ?? 0;
        const tape = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tapeTexture(m.key.split("-").pop()!.toUpperCase()), transparent: true, depthWrite: false }));
        tape.position.set(m.x, floor + 0.013, m.z);
        tape.renderOrder = 1;
        const fill = new THREE.MeshBasicMaterial({ color: 0xffb45a, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending });
        const line = new THREE.LineBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.8 });
        const ghost = new THREE.Mesh(box, fill), edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), line);
        ghost.position.set(m.x, floor + TOP_Y, m.z); edges.position.copy(ghost.position);
        // The stand it sits on, in the same light: a pole and three legs down to the tape.
        const legs = [0, 1, 2].flatMap((k) => { const a = (k * 2 * Math.PI) / 3; return [0, 0.45, 0, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3]; });
        const pole = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0.45, 0, 0, TOP_Y, 0, ...legs], 3)), line);
        pole.position.set(m.x, floor, m.z);
        group.add(tape, ghost, edges, pole);
        ghosts.push({ key: m.key, x: m.x, z: m.z, fill, line });
      }
      scene.add(group);
    },
    /** Each ghost breathes while its spot waits for a speaker, and goes once one is up there. */
    update(world: World, pulse: number) {
      for (const g of ghosts) {
        const up = world.items.some((i) => i.y > 0.9 && Math.hypot(i.x - g.x, i.z - g.z) < 0.45 && (gear(i.gear).speaker?.highCut ?? 0) > 500);
        g.fill.opacity = up ? 0 : 0.08 + 0.08 * pulse;
        g.line.opacity = up ? 0 : 0.5 + 0.4 * pulse;
      }
    },
  };
}
