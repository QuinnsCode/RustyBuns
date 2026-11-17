// Your feet (#5029 step 11): a pair of canvas high-tops you see when you look down. Rubber sole and toe cap, canvas
// upper to the ankle, white laces, a round patch on the inside of each ankle, and a jeans leg above. They step with
// your walk: one foot swings while the other is planted, a stride every 1.4 m.
import * as THREE from "three";

/** The six colours, by name. */
export const SHOE_COLOURS = { black: 0x1b1b1d, red: 0xa3262b, navy: 0x1d2b52, cream: 0xe6dcc3, green: 0x2f5d3a, yellow: 0xd9a81e } as const;
export type ShoeColour = keyof typeof SHOE_COLOURS;

const LEN = 0.29, WIDE = 0.105, STRIDE = 1.4, APART = 0.11;

function shoe(side: 1 | -1, canvas: THREE.Material, rubber: THREE.Material, denim: THREE.Material): THREE.Group {
  const g = new THREE.Group(), add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  // Toe forward is -z. The sole with its foxing stripe, the toe cap, the vamp, and the collar up the ankle.
  add(new THREE.BoxGeometry(WIDE, 0.032, LEN), rubber, 0, 0.016, 0);
  add(new THREE.SphereGeometry(WIDE / 2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.98, 0.8, 1.15), rubber, 0, 0.03, -LEN / 2 + 0.065);
  add(new THREE.BoxGeometry(WIDE * 0.92, 0.05, 0.15), canvas, 0, 0.056, -0.01);
  add(new THREE.CylinderGeometry(0.047, 0.052, 0.12, 14), canvas, 0, 0.11, 0.075);
  add(new THREE.BoxGeometry(WIDE * 0.92, 0.06, 0.07), canvas, 0, 0.06, 0.1);
  // The tongue and five laces up the front.
  add(new THREE.BoxGeometry(0.04, 0.006, 0.13).rotateX(0.45), rubber, 0, 0.1, 0.0);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.062, 0.005, 0.008).rotateX(0.45), rubber, 0, 0.085 + i * 0.013, -0.045 + i * 0.026);
  // The round patch, on the inside of the ankle.
  add(new THREE.CircleGeometry(0.02, 16).rotateY((-side * Math.PI) / 2), rubber, -side * 0.051, 0.115, 0.075);
  // The jeans leg leans back to the knee, so from your eyes the shoe shows in front of it.
  add(new THREE.CylinderGeometry(0.068, 0.058, 0.5, 12).translate(0, 0.25, 0).rotateX(0.6), denim, 0, 0.15, 0.085);
  return g;
}

export function shoesView(scene: THREE.Scene) {
  const canvas = new THREE.MeshStandardMaterial({ color: SHOE_COLOURS.black, roughness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0xece8dd, roughness: 0.6 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.9 });
  const feet = ([1, -1] as const).map((side) => ({ side, g: shoe(side, canvas, rubber, denim) }));
  const root = new THREE.Group();
  root.add(...feet.map((f) => f.g));
  scene.add(root);
  let phase = 0, swing = 0;
  return {
    /** Each frame: where you stand (the floor under you), the way you face, how fast you walk, and the seconds since last time. */
    update(x: number, floor: number, z: number, yaw: number, speed: number, dt: number) {
      root.position.set(x, floor, z);
      root.rotation.y = yaw;
      phase += (speed * dt * Math.PI * 2) / STRIDE;
      // The swing eases in and out with your pace, so your feet settle side by side when you stop.
      swing += (Math.min(1, speed / 0.8) - swing) * Math.min(1, dt * 8);
      for (const f of feet) {
        const a = phase + (f.side > 0 ? 0 : Math.PI);
        f.g.position.set(f.side * APART, Math.max(0, Math.cos(a)) * 0.05 * swing, -0.24 + Math.sin(a) * 0.17 * swing);
        f.g.rotation.x = Math.max(0, Math.cos(a)) * 0.35 * swing;
      }
    },
    setColour(c: ShoeColour) { canvas.color.setHex(SHOE_COLOURS[c]); },
  };
}
