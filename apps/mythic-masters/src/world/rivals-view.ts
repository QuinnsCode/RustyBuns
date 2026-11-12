// The faction people on the open ground (posts.ts), drawn: a body and a head like the towns' staff (town-view.ts), in
// each faction's coat. The Office wears a grey suit and a dark tie, the Institute a white coat, the Lamplighters a
// brown coat with a small amber lamp at the side. Someone a quest step waits with has a diamond bobbing over their
// head; a beaten post, resting, is dimmer and has none. One pool of thirty, in one group: nothing is made per frame.
import * as THREE from "three";
import type { FactionId } from "../factions/model.ts";
import type { Spot } from "./posts.ts";

export interface Figure extends Spot { id: string; faction: FactionId; /** A quest step waits here. */ quest?: boolean; /** A beaten post, resting. */ resting?: boolean }

/** The most figures drawn at once: three factions' posts in a region and their quest people. */
const MAX = 30;
const COAT: Record<FactionId, number> = { office: 0x7d828c, institute: 0xe9ecee, lamplighters: 0x8a5a2e };
const SKIN = 0xc89a78, TIE = 0x22252b, LAMP = 0xffc46b;
/** How much of its colour a resting figure keeps. */
const DIM = 0.5;

interface Slot { group: THREE.Group; body: THREE.Mesh; head: THREE.Mesh; tie: THREE.Mesh; lamp: THREE.Mesh; mark: THREE.Mesh }

export function rivalsView(scene: THREE.Scene, groundY: (x: number, z: number) => number): { update(figures: readonly Figure[], clock: number): void; hide(): void } {
  const group = new THREE.Group();
  group.name = "rivals";
  group.visible = false;
  scene.add(group);

  // shared by every figure: about 1.8 m from the feet to the top of the head
  const bodyGeo = new THREE.CapsuleGeometry(0.27, 0.95, 4, 10), headGeo = new THREE.SphereGeometry(0.18, 12, 10);
  const tieGeo = new THREE.BoxGeometry(0.07, 0.42, 0.03), lampGeo = new THREE.SphereGeometry(0.09, 10, 8), markGeo = new THREE.OctahedronGeometry(0.16);
  const cloth = (color: number, dim: boolean) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(dim ? DIM : 1), roughness: 0.8 });
  const coats = new Map<string, THREE.Material>(), marks = new Map<FactionId, THREE.Material>();
  const coat = (f: FactionId, dim: boolean) => { const key = `${f}:${dim}`; let m = coats.get(key); if (!m) coats.set(key, (m = cloth(COAT[f], dim))); return m; };
  const mark = (f: FactionId) => { let m = marks.get(f); if (!m) marks.set(f, (m = new THREE.MeshBasicMaterial({ color: COAT[f] }))); return m; };
  const skin = [cloth(SKIN, false), cloth(SKIN, true)] as const;
  const tieMat = cloth(TIE, false), lampMat = new THREE.MeshBasicMaterial({ color: LAMP });

  const pool: Slot[] = [];
  const slot = (i: number): Slot => {
    const had = pool[i];
    if (had) return had;
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, coat("office", false)), head = new THREE.Mesh(headGeo, skin[0]);
    body.position.y = 0.78; head.position.y = 1.63;
    body.castShadow = head.castShadow = true;
    const tie = new THREE.Mesh(tieGeo, tieMat), lamp = new THREE.Mesh(lampGeo, lampMat), mk = new THREE.Mesh(markGeo, mark("office"));
    tie.position.set(0, 1.08, 0.265);
    lamp.position.set(0.38, 0.78, 0.06);
    mk.scale.set(1, 1.5, 1);
    g.add(body, head, tie, lamp, mk);
    group.add(g);
    return (pool[i] = { group: g, body, head, tie, lamp, mark: mk });
  };
  /** Which way a figure faces: its own, the same every time. */
  const yawOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return ((h % 360) / 180) * Math.PI; };

  return {
    update(figures, clock) {
      group.visible = true;
      const shown = Math.min(figures.length, MAX);
      for (let i = 0; i < shown; i++) {
        const f = figures[i]!, s = slot(i), resting = !!f.resting, yaw = yawOf(f.id);
        s.group.visible = true;
        s.group.position.set(f.x, Math.max(0, groundY(f.x, f.z)), f.z);
        s.group.rotation.y = yaw;
        s.body.material = coat(f.faction, resting);
        s.head.material = skin[resting ? 1 : 0];
        s.tie.visible = f.faction === "office";
        s.lamp.visible = f.faction === "lamplighters" && !resting; // a resting Lamplighter's lamp is out
        s.mark.visible = !!f.quest && !resting;
        if (s.mark.visible) {
          s.mark.material = mark(f.faction);
          s.mark.position.y = 2.25 + Math.sin(clock * 2.4 + yaw) * 0.09;
          s.mark.rotation.y = clock * 1.2;
        }
      }
      for (let i = shown; i < pool.length; i++) pool[i]!.group.visible = false;
    },
    hide() { group.visible = false; },
  };
}
