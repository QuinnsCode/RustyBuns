// How a venue looks lit, and a light at your eyes. Each room gets the lights the real one has: a garage's two
// fluorescent strips and a work light at the door, a bar's warm spots over the stage, neon words on its walls and the load-in work
// light. A soft light rides with your eyes so whatever is in reach reads. Your hands are
// src/hands/. View only: the sim never reads it.
import * as THREE from "three";
import type { GearLook } from "@rustybuns/models/gear";
import type { Level } from "./sim.ts";

/** Lift the near-black gear paint a step so faces, grilles and edges show under stage light (real gear is black too). */
export function readable(look: GearLook) {
  const tune = (m: THREE.Material, color: number, roughness?: number, metalness?: number) => {
    if (!(m instanceof THREE.MeshStandardMaterial)) return;
    m.color.setHex(color);
    if (roughness !== undefined) m.roughness = roughness;
    if (metalness !== undefined) m.metalness = metalness;
  };
  tune(look.paint, 0x2b2d31);
  tune(look.tolex, 0x26241f, 0.75);
  tune(look.grille, 0x4a4e55, 0.4, 0.75);
  tune(look.panel, 0x5a5e66);
  tune(look.knob, 0x1c1c1c);
  tune(look.rubber, 0x1e1e1e);
}

/** A neon's `word` is what its tubes spell; without one it is a plain looped tube. */
type Fixture = { kind: "strip" | "spot" | "neon" | "work" | "pendant" | "wash"; x: number; y: number; z: number; color: number; power: number; to?: [number, number, number]; word?: string };

/** The fixtures in a room, from its size: where a real one would hang them. */
export function fixtures(l: Level): Fixture[] {
  if (l.outdoor) return [];
  const r = l.room, cx = (r.x0 + r.x1) / 2, d = r.z1 - r.z0, top = r.height - 0.04;
  const work: Fixture = { kind: "work", x: r.x1 - 0.4, y: 1.9, z: r.z1 - 0.6, color: 0xf4f8ff, power: l.name === "dive-bar" ? 9 : 18, to: [cx, 0, r.z1 - 2.8] };
  if (l.name === "garage") return [
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.28, color: 0xeef4ff, power: 7 },
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.72, color: 0xeef4ff, power: 7 },
    work,
  ];
  // A club's DJ booth: one dim warm light over the decks (bright booth lights blind a DJ), coloured washes on the floor.
  if (l.name.startsWith("dj-booth")) return [
    { kind: "spot", x: cx, y: top, z: r.z0 + 2.6, color: 0xffd6a8, power: 6, to: [cx, 0.95, r.z0 + 1.5] },
    { kind: "spot", x: cx - 1.8, y: top, z: r.z0 + 4.5, color: 0xa24cff, power: 30, to: [cx - 0.6, 0, r.z0 + 5.5] },
    { kind: "spot", x: cx + 1.8, y: top, z: r.z0 + 4.5, color: 0x3fa8ff, power: 30, to: [cx + 0.6, 0, r.z0 + 5.5] },
    { kind: "neon", x: r.x1 - 0.03, y: 1.9, z: r.z0 + d * 0.55, color: 0xff3fa4, power: 5 },
    work,
  ];
  // A bar: warm spots on the stage end, one over the room, a neon sign on the long wall, the work light by the door.
  // The dive bar adds the lamps over its counter: warm pools on the bar top and the tiles, the stools' shadows under them.
  const pendants: Fixture[] = l.name === "dive-bar"
    ? [0.5, 0.68, 0.86].map((t) => ({ kind: "pendant", x: r.x0 + 0.85, y: top - 0.7, z: r.z0 + d * t, color: 0xffb871, power: 9, to: [r.x0 + 0.75, 0, r.z0 + d * t] }))
    : [];
  // And washes on its walls, no shadows (cheap): amber up the curtain behind the stage, a warm graze down each brick wall
  // past the crowd area, so the walk to the stage and the stage itself never fall to black.
  const washes: Fixture[] = l.name === "dive-bar"
    ? [
      { kind: "wash", x: cx, y: top, z: r.z0 + 2.9, color: 0xff9a66, power: 16, to: [cx, 1.5, r.z0 + 0.05] },
      { kind: "wash", x: r.x1 - 0.35, y: top, z: r.z0 + d * 0.3, color: 0xffc08a, power: 9, to: [r.x1, 0.9, r.z0 + d * 0.42] },
      { kind: "wash", x: r.x0 + 0.35, y: top, z: r.z0 + d * 0.22, color: 0xffc08a, power: 9, to: [r.x0, 0.9, r.z0 + d * 0.3] },
    ]
    : [];
  return [
    { kind: "spot", x: cx - 1.2, y: top, z: r.z0 + 2.6, color: 0xffc47a, power: 40, to: [cx - 0.6, 0, r.z0 + 1.2] },
    { kind: "spot", x: cx + 1.2, y: top, z: r.z0 + 2.6, color: 0xffb36a, power: 40, to: [cx + 0.6, 0, r.z0 + 1.2] },
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.6, color: 0xffd9a8, power: pendants.length ? 5 : 9 },
    { kind: "neon", x: r.x1 - 0.03, y: 1.9, z: r.z0 + d * 0.45, color: 0xff3fa4, power: 0.9, word: "LIVE MUSIC" },
    { kind: "neon", x: r.x0 + 0.03, y: 1.85, z: r.z0 + d * 0.7, color: 0x3fd8ff, power: 0.8, word: "Cold Beer" },
    ...pendants,
    ...washes,
    work,
  ];
}

/** A neon word on a wall at `x` (facing into the room): the tubes drawn glowing on a canvas, on a dark backing board. */
function neonWord(word: string, color: number, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group(), c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!, hex = `#${color.toString(16).padStart(6, "0")}`;
  ctx.font = `italic bold 150px "Trebuchet MS", "Segoe Script", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // Glow, then the tube, then its hot white core.
  for (const [blur, width, style] of [[18, 12, hex], [8, 8, hex], [0, 2.5, "#ffffff"]] as const) {
    ctx.shadowColor = hex;
    ctx.shadowBlur = blur;
    ctx.lineWidth = width;
    ctx.strokeStyle = style;
    ctx.strokeText(word, 512, 128, 960);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const w = 1.3, h = w / 4, turn = x > 0 ? -Math.PI / 2 : Math.PI / 2, out = x > 0 ? -1 : 1;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.8), new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.3 }));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: 0xb0b0b0, transparent: true, depthWrite: false, toneMapped: false }));
  board.position.set(x + out * 0.02, y, z);
  sign.position.set(x + out * 0.035, y, z);
  board.rotation.y = sign.rotation.y = turn;
  g.add(board, sign);
  return g;
}

/** A spot that throws shadows, at a map size the room can afford. */
function shadows(s: THREE.SpotLight, size: number) {
  s.castShadow = true;
  s.shadow.mapSize.set(size, size);
  s.shadow.bias = -0.0004;
  s.shadow.normalBias = 0.02;
  s.shadow.camera.near = 0.1;
  s.shadow.camera.far = 8;
}

/** How much the sky-and-floor fill lights a room: a bar runs dark between its lamps, the rest as they were. */
export function fill(l: Level) {
  return l.name === "dive-bar" ? 0.6 : 0.85;
}

/** Every solid mesh casts and takes shadows; glows (unlit, see-through) don't, so a sign never darkens its own wall. */
export function shade(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.shaded) return;
    o.userData.shaded = true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const solid = !(m instanceof THREE.MeshBasicMaterial) && !m?.transparent;
    o.castShadow = solid;
    o.receiveShadow = solid;
  });
}

/** The lights and the fixtures you see for a level, as one group to add and remove with the room. */
export function venueLights(l: Level): THREE.Group {
  const g = new THREE.Group();
  const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };
  for (const f of fixtures(l)) {
    if (f.kind === "strip") {
      box(1.25, 0.05, 0.14, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.6 }), f.x, f.y, f.z);
      // The tube reads lit without burning white: a warm grey that the tone mapping keeps under the top.
      box(1.18, 0.02, 0.09, glow(new THREE.Color(f.color).multiplyScalar(Math.min(1, 0.35 + f.power / 14)).getHex()), f.x, f.y - 0.03, f.z);
      for (const dx of [-0.4, 0.4]) {
        const p = new THREE.PointLight(f.color, f.power, 9, 1.4);
        p.position.set(f.x + dx, f.y - 0.12, f.z);
        g.add(p);
      }
    } else if (f.kind === "neon" && f.word) {
      g.add(neonWord(f.word, f.color, f.x, f.y, f.z));
      const p = new THREE.PointLight(f.color, f.power, 3, 2);
      p.position.set(f.x + (f.x > 0 ? -0.35 : 0.35), f.y, f.z);
      g.add(p);
    } else if (f.kind === "pendant") {
      // A bar lamp: a cord from the ceiling, an enamel shade, the bulb under it, a cone of warm light with shadows.
      const to = new THREE.Vector3(...(f.to ?? [f.x, 0, f.z]));
      box(0.008, l.room.height - f.y - 0.12, 0.008, new THREE.MeshStandardMaterial({ color: 0x111111 }), f.x, (l.room.height + f.y + 0.12) / 2, f.z);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x24402f, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }));
      shade.position.set(f.x, f.y + 0.06, f.z);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glow(0xffd9a0));
      bulb.position.set(f.x, f.y - 0.01, f.z);
      g.add(shade, bulb);
      const s = new THREE.SpotLight(f.color, f.power, 5, 0.85, 0.7, 1.6);
      s.position.set(f.x, f.y - 0.03, f.z);
      s.target.position.copy(to);
      shadows(s, 512);
      g.add(s, s.target);
    } else if (f.kind === "wash") {
      // A wall washer: a small can on the ceiling and a wide soft cone, no shadow map.
      const s = new THREE.SpotLight(f.color, f.power, 7, 0.95, 0.9, 1.2);
      s.position.set(f.x, f.y - 0.08, f.z);
      s.target.position.set(...(f.to ?? [f.x, 0, f.z]));
      g.add(s, s.target);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
      can.position.set(f.x, f.y - 0.05, f.z);
      g.add(can);
    } else if (f.kind === "neon") {
      // A sign of our own: a looped tube on a backing, washing the wall in its colour.
      const tube = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.018, 6, 28), glow(f.color));
      tube.position.set(f.x, f.y, f.z);
      tube.rotation.y = Math.PI / 2;
      tube.scale.set(1, 0.6, 1);
      g.add(tube);
      const bar = box(0.02, 0.03, 0.6, glow(f.color), f.x, f.y - 0.28, f.z);
      bar.position.x += f.x > 0 ? -0.01 : 0.01;
      const p = new THREE.PointLight(f.color, f.power, 5, 1.6);
      p.position.set(f.x + (f.x > 0 ? -0.35 : 0.35), f.y, f.z);
      g.add(p);
    } else {
      const s = new THREE.SpotLight(f.color, f.power, 14, f.kind === "work" ? 0.75 : 0.55, 0.5, 1.3);
      s.position.set(f.x, f.y, f.z);
      // The stage spots throw the band's shadows on the curtain and the boards; the work light the gear's on the floor.
      shadows(s, f.kind === "work" ? 512 : 1024);
      s.target.position.set(...(f.to ?? [f.x, 0, f.z]));
      g.add(s, s.target);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
      can.position.set(f.x, f.y - (f.kind === "work" ? 0 : 0.06), f.z);
      can.lookAt(s.target.position);
      can.rotateX(Math.PI / 2);
      g.add(can);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), glow(f.color));
      lens.position.copy(can.position).lerp(s.target.position, 0.09 / can.position.distanceTo(s.target.position));
      lens.lookAt(s.target.position);
      g.add(lens);
    }
  }
  // A lamp's own can and shade would shadow its own beam: the fixtures stay out of the shadow pass.
  g.traverse((o) => { o.userData.shaded = true; });
  return g;
}

/** A soft light at your eyes: what you can reach reads, however dark the corner. */
export function eyeFill(camera: THREE.Camera) {
  const p = new THREE.PointLight(0xfff1dc, 2.6, 4, 1.2);
  p.position.set(0, 0.1, 0.05);
  camera.add(p);
  return p;
}

