// What makes the dive bar a bar and not a box: brick walls, a scuffed tile floor, a black ceiling with its duct, stools
// at the counter, beer taps on it and bottles on the shelves over it, a curtain behind the stage with a mic waiting, and
// a real street door (steel leaves propped open, a push bar, an EXIT sign). Every surface is drawn on a canvas here, so
// nothing is downloaded. View only, nothing in it is solid: the sim never reads it. `barView` adds it to its group.
import * as THREE from "three";
import type { Level } from "../sim.ts";
import { ZONES } from "./dive-bar.ts";

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A canvas texture `w` by `h` pixels, painted by `paint`, repeating `rx` by `ry` times over its surface. */
function canvasTex(w: number, h: number, paint: Paint, rx = 1, ry = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

/** A small seeded stream, so the bricks and scuffs are the same on every load. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Old red brick in running bond, 4 courses by 2 bricks a tile (about 30 by 46 cm), mortar a shade of grime. */
const brick: Paint = (ctx, w, h) => {
  const r = seeded(7), rows = 4, cols = 2, bh = h / rows, bw = w / cols;
  ctx.fillStyle = "#3b322c";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < rows; y++) for (let x = -1; x < cols + 1; x++) {
    const ox = (y % 2) * bw / 2, k = r();
    ctx.fillStyle = `hsl(${8 + k * 12}, ${30 + r() * 14}%, ${15 + k * 9}%)`;
    ctx.fillRect(x * bw + ox + 5, y * bh + 5, bw - 10, bh - 10);
    // Soot and wear on each brick.
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,220,190"},${0.05 + r() * 0.08})`;
      ctx.fillRect(x * bw + ox + 5 + r() * (bw - 20), y * bh + 5 + r() * (bh - 16), 4 + r() * 18, 2 + r() * 6);
    }
  }
};

/** Black and cream tiles, 30 cm, scuffed and stained where people stand. */
const tiles: Paint = (ctx, w, h) => {
  const r = seeded(11), n = 4, s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = (x + y) % 2 ? "#141312" : "#857a66";
    ctx.fillRect(x * s, y * s, s, s);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(40,28,16,${0.06 + r() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(r() * w, r() * h, 6 + r() * 40, 4 + r() * 22, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** A heavy stage curtain: deep red folds, lit at the crests. */
const curtain: Paint = (ctx, w, h) => {
  const folds = 6, fw = w / folds, g = ctx.createLinearGradient(0, 0, fw, 0);
  g.addColorStop(0, "#1e0306"); g.addColorStop(0.35, "#6b0f18"); g.addColorStop(0.55, "#8a1a22"); g.addColorStop(1, "#1e0306");
  ctx.fillStyle = g;
  for (let i = 0; i < folds; i++) { ctx.save(); ctx.translate(i * fw, 0); ctx.fillRect(0, 0, fw, h); ctx.restore(); }
  const shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, "rgba(0,0,0,0.55)"); shade.addColorStop(0.25, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
};

/** The EXIT sign's face: red letters on white, lit. */
const exitFace: Paint = (ctx, w, h) => {
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#e01b1b";
  ctx.font = `bold ${h * 0.7}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EXIT", w / 2, h / 2 + 2);
};

export type Dressing = { group: THREE.Group; dispose(): void };

/** The dive bar's dressing for `l` (its room and door), to add to the scene with the bar's other marks. */
export function diveBarDressing(l: Level): Dressing {
  const g = new THREE.Group(), r = l.room, made: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (made.push(x), x);
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial({ roughness: 0.85, ...o }));
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const mesh = new THREE.Mesh(keep(geo), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    g.add(mesh);
    return mesh;
  };
  /** A flat plane `w` by `h` centred at (x, y, z), turned `ry` about y (0 faces +z). */
  const plane = (w: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0) => add(new THREE.PlaneGeometry(w, h), m, x, y, z, ry);

  const W = r.x1 - r.x0, D = r.z1 - r.z0, H = r.height, cx = (r.x0 + r.x1) / 2;
  // Brick on the long walls and the street wall (a tile is 0.92 m by 1.2 m), the curtain on the stage wall.
  const bricks = (len: number) => std({ map: keep(canvasTex(512, 512, brick, len / 0.92, H / 1.2)), roughness: 0.95 });
  plane(D, H, bricks(D), r.x0 + 0.003, H / 2, (r.z0 + r.z1) / 2, Math.PI / 2);
  plane(D, H, bricks(D), r.x1 - 0.003, H / 2, (r.z0 + r.z1) / 2, -Math.PI / 2);
  const side = (W - r.door) / 2, doorTop = 2.1, front = bricks(side);
  plane(side, H, front, r.x0 + side / 2, H / 2, r.z1 - 0.003, Math.PI);
  plane(side, H, front, r.x1 - side / 2, H / 2, r.z1 - 0.003, Math.PI);
  plane(r.door, H - doorTop, bricks(r.door), cx, (H + doorTop) / 2, r.z1 - 0.003, Math.PI);
  plane(W, H, std({ map: keep(canvasTex(512, 256, curtain, 2, 1)), roughness: 1 }), cx, H / 2, r.z0 + 0.004);
  // A dark skirting along the walls, where the brick meets the tiles.
  const skirt = std({ color: 0x17120f, roughness: 0.6 });
  add(new THREE.BoxGeometry(0.02, 0.12, D), skirt, r.x0 + 0.012, 0.06, (r.z0 + r.z1) / 2);
  add(new THREE.BoxGeometry(0.02, 0.12, D), skirt, r.x1 - 0.012, 0.06, (r.z0 + r.z1) / 2);

  // The floor: tiles 30 cm square (a texture tile is four), the ceiling painted black with a silver duct down it.
  const floor = plane(W, D, std({ map: keep(canvasTex(512, 512, tiles, W / 1.2, D / 1.2)), roughness: 0.55 }), cx, 0.003, (r.z0 + r.z1) / 2);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = plane(W, D, std({ color: 0x141416, roughness: 1 }), cx, H - 0.004, (r.z0 + r.z1) / 2);
  ceiling.rotation.x = Math.PI / 2;
  const duct = add(new THREE.CylinderGeometry(0.16, 0.16, D - 0.4, 18), std({ color: 0x8d9298, metalness: 0.55, roughness: 0.7 }), r.x1 - 0.8, H - 0.26, (r.z0 + r.z1) / 2);
  duct.rotation.x = Math.PI / 2;
  const pipe = add(new THREE.CylinderGeometry(0.025, 0.025, D - 0.2, 8), std({ color: 0x5a3b22, metalness: 0.5, roughness: 0.5 }), r.x0 + 0.5, H - 0.12, (r.z0 + r.z1) / 2);
  pipe.rotation.x = Math.PI / 2;

  // The stage: a front edge in white tape, and a mic on its stand in the middle, waiting for the band.
  const st = ZONES.stage, tape = std({ color: 0xe8e2cf, roughness: 0.7 });
  add(new THREE.BoxGeometry(st.x1 - st.x0, 0.004, 0.05), tape, cx, 0.014, st.z1 - 0.03);
  const chrome = std({ color: 0xc9ced4, metalness: 0.9, roughness: 0.25 }), black = std({ color: 0x111111, roughness: 0.5 });
  add(new THREE.CylinderGeometry(0.14, 0.15, 0.02, 20), black, cx, 0.02, 1.1);
  add(new THREE.CylinderGeometry(0.011, 0.011, 1.45, 8), chrome, cx, 0.75, 1.1);
  const mic = add(new THREE.CylinderGeometry(0.024, 0.016, 0.17, 12), black, cx, 1.5, 1.17);
  mic.rotation.x = Math.PI / 2.6;
  add(new THREE.SphereGeometry(0.03, 12, 10), std({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.4 }), cx, 1.53, 1.25);

  // The counter: a brass foot rail, stools in front, the taps on top and bottles on two shelves over it.
  const c = ZONES.counter, brass = std({ color: 0xb08a3e, metalness: 0.85, roughness: 0.35 });
  const rail = add(new THREE.CylinderGeometry(0.025, 0.025, c.z1 - c.z0, 10), brass, c.x1 + 0.12, 0.18, (c.z0 + c.z1) / 2);
  rail.rotation.x = Math.PI / 2;
  const vinyl = std({ color: 0x8e1b1b, roughness: 0.45 }), steel = std({ color: 0x2b2b2e, metalness: 0.6, roughness: 0.4 });
  for (let z = c.z0 + 0.6; z < c.z1 - 1.2; z += 0.9) {
    const x = c.x1 + 0.38;
    add(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 20), vinyl, x, 0.76, z);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 10), steel, x, 0.36, z);
    add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), steel, x, 0.015, z);
    const ring = add(new THREE.TorusGeometry(0.15, 0.012, 6, 20), chrome, x, 0.3, z);
    ring.rotation.x = Math.PI / 2;
  }
  // The tap tower: a chrome bar on two posts, five handles in brewery colours, a drip tray under them.
  const top = 1.1, tx = c.x1 - 0.2, tz = 7.4;
  add(new THREE.BoxGeometry(0.12, 0.02, 0.8), black, tx + 0.08, top + 0.01, tz);
  add(new THREE.BoxGeometry(0.06, 0.06, 0.74), chrome, tx, top + 0.34, tz);
  for (const dz of [-0.34, 0.34]) add(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 10), chrome, tx, top + 0.17, tz + dz);
  [0xf2c230, 0x1f6fd1, 0xe0541b, 0x2aa35a, 0xeeeeee].forEach((col, i) => {
    const z = tz - 0.28 + i * 0.14;
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), chrome, tx + 0.05, top + 0.3, z).rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(0.03, 0.15, 0.035), std({ color: col, roughness: 0.4 }), tx, top + 0.45, z);
  });
  // Glasses upside down on a mat at the end of the counter.
  const glass = std({ color: 0xcfe6ee, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 });
  for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.035, 0.03, 0.14, 12), glass, c.x0 + 0.2 + (i % 2) * 0.1, top + 0.07, c.z1 - 0.5 - Math.floor(i / 2) * 0.1);

  // Two shelves of bottles over the counter, either side of the Cold Beer sign (look.ts hangs it).
  const wood = std({ color: 0x3c2516, roughness: 0.7 }), rnd = seeded(3);
  const tints = [0x2f6a2c, 0x7a4a12, 0xd8e4e8, 0x5a1a12, 0x1d3f6b, 0xc9a43a];
  const bottle = (geoBody: THREE.BufferGeometry, geoNeck: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = std({ color: tints[Math.floor(rnd() * tints.length)], transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.2 });
    const b = new THREE.Mesh(geoBody, m), n = new THREE.Mesh(geoNeck, m);
    b.position.set(x, y + 0.1, z);
    n.position.set(x, y + 0.24, z);
    g.add(b, n);
  };
  const body = keep(new THREE.CylinderGeometry(0.038, 0.038, 0.2, 10)), neck = keep(new THREE.CylinderGeometry(0.012, 0.03, 0.09, 8));
  const signZ = r.z0 + D * 0.7;
  for (const [z0, z1] of [[c.z0 + 0.1, signZ - 0.8], [signZ + 0.8, c.z1 - 0.1]]) for (const y of [1.42, 1.82]) {
    if (z1 - z0 < 0.3) continue;
    add(new THREE.BoxGeometry(0.2, 0.025, z1 - z0), wood, r.x0 + 0.1, y, (z0 + z1) / 2);
    for (let z = z0 + 0.06; z < z1 - 0.05; z += 0.09 + rnd() * 0.04) bottle(body, neck, r.x0 + 0.08 + rnd() * 0.06, y + 0.012, z);
  }

  // The street door: a frame, two steel leaves propped open outward, a push bar on each, an EXIT sign over it.
  const half = r.door / 2, frame = std({ color: 0x1f3a2c, roughness: 0.6 }), leaf = std({ color: 0x2e5240, roughness: 0.55, metalness: 0.3 });
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.07, doorTop, 0.16), frame, cx + s * (half - 0.035), doorTop / 2, r.z1);
    add(new THREE.BoxGeometry(0.045, doorTop - 0.04, half - 0.04), leaf, cx + s * (half + 0.04), (doorTop - 0.04) / 2, r.z1 + 0.06 + (half - 0.04) / 2);
    const bar = add(new THREE.CylinderGeometry(0.018, 0.018, half - 0.2, 8), chrome, cx + s * (half + 0.075), 1.0, r.z1 + 0.06 + half / 2);
    bar.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.05, 0.25, 0.6), std({ color: 0x9aa0a6, metalness: 0.8, roughness: 0.5 }), cx + s * (half + 0.04), 0.13, r.z1 + 0.06 + (half - 0.04) / 2);
  }
  add(new THREE.BoxGeometry(r.door, 0.07, 0.16), frame, cx, doorTop + 0.035, r.z1);
  const exit = keep(new THREE.MeshBasicMaterial({ map: keep(canvasTex(256, 96, exitFace)), toneMapped: false }));
  add(new THREE.BoxGeometry(0.4, 0.15, 0.05), std({ color: 0xdedede }), cx, doorTop + 0.22, r.z1 - 0.03);
  plane(0.38, 0.13, exit, cx, doorTop + 0.22, r.z1 - 0.056, Math.PI);
  // A clip light on the door frame, pointed down at where the gear is stacked as it comes in, so the pile reads from the stage.
  add(new THREE.CylinderGeometry(0.05, 0.07, 0.12, 10), black, cx + half - 0.1, doorTop - 0.02, r.z1 - 0.12).rotation.x = -0.6;
  const key = new THREE.SpotLight(0xfff0dc, 16, 6, 0.7, 0.6, 1.4);
  key.position.set(cx + half - 0.1, doorTop - 0.08, r.z1 - 0.2);
  key.target.position.set(cx, 0.3, r.z1 - 1.5);
  g.add(key, key.target);
  const glow = new THREE.PointLight(0xff3030, 0.6, 2.5, 2);
  glow.position.set(cx, doorTop + 0.2, r.z1 - 0.3);
  g.add(glow);

  return { group: g, dispose: () => made.forEach((x) => x.dispose()) };
}
