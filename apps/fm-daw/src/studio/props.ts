// A room's set dressing (room.ts's `props`) as three.js meshes: shelves full of books and records, lamps, plants,
// racks of outboard gear, a console's knobs and meters, big monitors, stairs, a grand piano, tall mic stands. Each
// prop is its own group, its front facing -z before its yaw turns it, the same way a seat looks. What a surface is
// made of comes from `mat(name, color)`: the room's look (studio/look.ts) hands in its materials; left out, it's a
// plain one of that colour. Anything that glows (a lamp's shade, a meter, a screen) carries `userData.glow` for the
// look to light and bloom; shadows are the look's too, so none are set here.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";
import type { Prop } from "./room.ts";
import { speaker } from "./gear-models.ts";
import { dressing, type Item, type Kit } from "./set-dressing.ts";

/** A material by what it's made of (sound.ts's names, or metal, plastic, fabric, glass, screen) and its colour. */
export type Mat = (name: string, color: string) => THREE.Material;
export const plainMat: Mat = (_name, color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });

const BOOKS = ["#7a2e2a", "#2f4a6b", "#c9b27a", "#3e5a3a", "#8a6a3a", "#d8d2c4", "#4a3a5c", "#b8562e", "#1f2428", "#9a8a6a"];
const TOYS = ["#e0b02a", "#d0452e", "#3a8ad0", "#5ab04a", "#e07ab0"];

/** One prop, ready to add to the scene. */
export function prop(p: Prop, mat: Mat = plainMat): THREE.Group {
  const cache = new Map<string, THREE.Material>();
  const m = (name: string, color: string) => {
    const k = `${name}|${color}`;
    let x = cache.get(k);
    if (!x) cache.set(k, (x = mat(name, color)));
    return x;
  };
  const g = new THREE.Group();
  g.position.set(p.at[0], p.y ?? 0, p.at[1]);
  g.rotation.y = p.yaw;
  g.userData.prop = p.kind;
  const rnd = mulberry32(p.seed ?? 1);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const cyl = (r: number, h: number, x: number, y: number, z: number, material: THREE.Material, seg = 16) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const glow = <T extends THREE.Object3D>(o: T, k: number) => { o.userData.glow = k; return o; };
  /** Many small boxes (or cylinders, or balls) in one draw: each [w, h, d, x, y, z, colour, turn]. */
  const many = (name: string, items: Item[], k = 0, shape: "box" | "cyl" | "ball" = "box") => {
    if (!items.length) return;
    const geo = shape === "cyl" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 14) : shape === "ball" ? new THREE.SphereGeometry(0.5, 12, 8) : new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, m(name, "#ffffff"), items.length);
    const o = new THREE.Object3D(), c = new THREE.Color();
    items.forEach(([w, h, d, x, y, z, col, turn], i) => {
      o.position.set(x, y, z); o.rotation.set(0, turn ?? 0, 0); o.scale.set(w, h, d); o.updateMatrix();
      im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(col));
    });
    if (k) glow(im, k);
    g.add(im);
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const { w, d, h, color } = p;

  switch (p.kind) {
    case "shelf": {
      // a wooden case open at the front, a board every 35 cm, each filled with books, a run of records or a toy
      const wood = m("wood", color), t = 0.03, rows = Math.max(1, Math.floor((h - 0.1) / 0.36));
      box(w, h, t, 0, h / 2, d / 2 - t / 2, wood);
      for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) box(t, h, d, x, h / 2, 0, wood);
      const gap = (h - t) / rows, items: [number, number, number, number, number, number, string][] = [];
      for (let r = 0; r <= rows; r++) box(w - 2 * t, t, d, 0, t / 2 + r * gap, 0, wood);
      for (let r = 0; r < rows; r++) {
        const base = t + r * gap;
        for (let x = -w / 2 + t + 0.01; x < w / 2 - t - 0.06;) {
          const what = rnd();
          if (what < 0.12) {
            // a run of records, sleeves standing on edge
            const n = 6 + Math.floor(rnd() * 14), s = Math.min(0.31, gap - 0.03);
            for (let i = 0; i < n && x < w / 2 - t - 0.01; i++, x += 0.006) items.push([0.005, s, Math.min(s, d - 0.02), x, base + s / 2, 0, pick(BOOKS)]);
            x += 0.02;
          } else if (what < 0.2) {
            // a toy or an ornament, and some room either side of it
            const s = 0.06 + rnd() * 0.08;
            const o = new THREE.Mesh(rnd() < 0.5 ? new THREE.SphereGeometry(s / 2, 12, 8) : new THREE.BoxGeometry(s, s * 1.3, s), m("plastic", pick(TOYS)));
            o.position.set(x + s / 2 + 0.02, base + (o.geometry instanceof THREE.SphereGeometry ? s / 2 : s * 0.65), -d * 0.1);
            g.add(o);
            x += s + 0.05;
          } else if (what < 0.26) x += 0.06 + rnd() * 0.12;   // a gap
          else {
            const n = 3 + Math.floor(rnd() * 12);
            for (let i = 0; i < n && x < w / 2 - t - 0.04; i++) {
              const bw = 0.018 + rnd() * 0.03, bh = Math.min(gap - 0.03, 0.17 + rnd() * 0.13), bd = Math.min(d - 0.03, 0.13 + rnd() * 0.08);
              items.push([bw, bh, bd, x + bw / 2, base + bh / 2, d / 2 - t - bd / 2 - 0.005, pick(BOOKS)]);
              x += bw + 0.002;
            }
            x += 0.005;
          }
        }
      }
      many("fabric", items);
      break;
    }
    case "lamp": {
      // a floor or desk lamp: a heavy base, a thin stem, a cloth shade lit from inside
      const metal = m("metal", "#2a2622");
      cyl(Math.min(0.14, w / 2), 0.03, 0, 0.015, 0, metal, 20);
      cyl(0.012, h - 0.2, 0, (h - 0.2) / 2, 0, metal, 8);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w / 2, 0.26, 24, 1, true), m("fabric", color));
      shade.position.y = h - 0.13;
      (shade.material as THREE.Material).side = THREE.DoubleSide;
      g.add(glow(shade, 0.6));
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), m("glass", "#fff1d0"));
      bulb.position.y = h - 0.16;
      bulb.userData.lamp = true; // look.ts hangs a light in it
      g.add(glow(bulb, 1.5));
      break;
    }
    case "plant": {
      // a pot and a fan of leaves
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.24, h * 0.28, 18), m("concrete", color));
      pot.position.y = h * 0.14;
      g.add(pot);
      const leaf = m("fabric", "#3f6a35"), n = 9 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, tilt = 0.25 + rnd() * 0.6, len = h * (0.45 + rnd() * 0.35);
        const l = new THREE.Mesh(new THREE.ConeGeometry(0.045 + rnd() * 0.04, len, 5), leaf);
        l.position.set(Math.sin(a) * Math.sin(tilt) * len / 2, h * 0.26 + Math.cos(tilt) * len / 2, Math.cos(a) * Math.sin(tilt) * len / 2);
        l.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
        g.add(l);
      }
      break;
    }
    case "rug": {
      box(w, 0.012, d, 0, 0.006, 0, m("carpet", color));
      const edge = m("carpet", "#d8c8a0");
      for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) box(w - 0.1, 0.014, 0.05, 0, 0.007, z, edge);
      break;
    }
    case "rack": {
      // a cabinet of outboard gear: faceplates of 1, 2 and 3 rack units, a row of knobs and a lit meter or two each
      const metal = m("metal", color), t = 0.04;
      box(w, h, d - 0.02, 0, h / 2, 0.01, metal);
      const knobs: [number, number, number, number, number, number, string][] = [], leds: typeof knobs = [];
      const U = 0.0445, fw = w - 2 * t;
      for (let y = 0.12; y < h - 0.1;) {
        const units = pick([1, 1, 2, 2, 3]), fh = units * U - 0.003;
        if (y + fh > h - 0.06) break;
        const face = pick(["#2a2c30", "#b8b4aa", "#3a3020", "#1c2a3a", "#6a1e1e", "#c8c0a8"]);
        box(fw, fh, 0.01, 0, y + fh / 2, -d / 2 - 0.005, m("metal", face));
        const n = units === 1 ? 6 : 4 + Math.floor(rnd() * 5), ks = Math.min(0.03, fh * 0.6);
        for (let i = 0; i < n; i++) knobs.push([ks, ks, 0.02, -fw / 2 + 0.08 + (i + 0.5) * (fw * 0.72 / n), y + fh / 2, -d / 2 - 0.02, pick(["#1a1a1a", "#d0ccc0", "#8a1a1a"])]);
        if (units > 1 && rnd() < 0.6) leds.push([0.07, fh * 0.5, 0.005, fw / 2 - 0.1, y + fh / 2, -d / 2 - 0.012, rnd() < 0.5 ? "#f0c060" : "#80d070"]);
        else leds.push([0.006, 0.006, 0.006, fw / 2 - 0.05, y + fh / 2, -d / 2 - 0.012, "#ff4030"]);
        y += units * U;
      }
      many("plastic", knobs);
      many("screen", leds, 0.8);
      break;
    }
    case "console": {
      // a big analog desk's top: channel strips of knobs down a sloped face, a fader each, a lit meter bridge behind
      const body = m("wood", color), face = m("metal", "#2c2e32");
      const slope = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d * 0.72), face);
      slope.position.set(0, 0.06, d * 0.08);
      slope.rotation.x = 0.16;
      g.add(slope);
      box(w + 0.06, 0.08, d, 0, 0.02, 0, body);
      const strips = Math.max(8, Math.floor((w - 0.3) / 0.045)), sw = (w - 0.3) / strips;
      const knobs: [number, number, number, number, number, number, string][] = [], faders: typeof knobs = [], meters: typeof knobs = [];
      for (let i = 0; i < strips; i++) {
        const x = -w / 2 + 0.15 + (i + 0.5) * sw;
        for (let k = 0; k < 9; k++) {
          const z = -d * 0.24 + k * (d * 0.5 / 9);
          knobs.push([sw * 0.5, 0.018, sw * 0.5, x, 0.1 - (z - d * 0.08) * 0.16, z, k < 2 ? "#c8302a" : k < 5 ? "#d8d4c8" : k < 7 ? "#2a5a9a" : "#1a1a1a"]);
        }
        faders.push([sw * 0.4, 0.025, 0.035, x, 0.04, d * 0.36 - rnd() * 0.1, "#e8e4d8"]);
        if (i % 2 === 0) meters.push([sw * 1.6, 0.06, 0.008, x + sw / 2, 0.22, -d / 2 + 0.035, "#f0d080"]);
      }
      box(w, 0.16, 0.08, 0, 0.2, -d / 2 + 0.07, face);
      many("plastic", knobs);
      many("plastic", faders);
      many("screen", meters, 0.7);
      break;
    }
    case "monitor": {
      // a speaker: Sound Guy Simulator's detailed powered cabinet (gear-models.ts), fitted to the box, in the room's wood
      g.add(speaker(w, h, d, m("wood", color)));
      break;
    }
    case "stairs": {
      // steps rising toward the back (+z) to `h`, with a rail up the open side
      const n = Math.max(3, Math.round(h / 0.18)), rise = h / n, run = d / n, wood = m("wood", color);
      for (let i = 0; i < n; i++) box(w, rise * (i + 1), run, 0, rise * (i + 1) / 2, -d / 2 + run * (i + 0.5), wood);
      const metal = m("metal", "#3a3c40"), len = Math.hypot(d, h), ang = Math.atan2(h, d);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, len), metal);
      rail.position.set(-w / 2 + 0.03, h / 2 + 0.95, 0);
      rail.rotation.x = -ang;
      g.add(rail);
      for (let i = 0; i <= n; i += 3) box(0.025, 0.95, 0.025, -w / 2 + 0.03, rise * i + 0.475, -d / 2 + run * i, metal);
      break;
    }
    case "balcony": {
      // a raised floor (h is its slab) with a rail along its front and posts under it
      const wood = m("wood", color), metal = m("metal", "#3a3c40");
      box(w, h, d, 0, -h / 2, 0, wood);
      box(w, 0.05, 0.05, 0, 1, -d / 2 + 0.03, metal);
      for (let x = -w / 2 + 0.05; x <= w / 2; x += 1.2) box(0.04, 1, 0.04, x, 0.5, -d / 2 + 0.03, metal);
      const under = (p.y ?? 0) - h;
      if (under > 0.3) for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) box(0.18, under, 0.18, x, -h - under / 2, -d / 2 + 0.2, wood);
      break;
    }
    case "window": {
      // a lit window into another room: a frame, glass, and the glow of the room behind
      const frame = m("wood", color), t = 0.06;
      for (const y of [t / 2, h - t / 2]) box(w, t, d, 0, y, 0, frame);
      for (const x of [-w / 2 + t / 2, w / 2 - t / 2, 0]) box(t, h, d, x, h / 2, 0, frame);
      g.add(glow(box(w - 2 * t, h - 2 * t, 0.005, 0, h / 2, d / 2 - 0.005, m("screen", "#e8c890")), 0.35));
      box(w - 2 * t, h - 2 * t, 0.01, 0, h / 2, -d / 2 + 0.01, m("glass", "#9fc6d8"));
      break;
    }
    case "piano": {
      // a grand: the curved case, its lid propped open, three legs, the keys toward -z where the player sits
      const black = m("plastic", color), len = d, wid = w;
      const s = new THREE.Shape();
      s.moveTo(-wid / 2, 0);
      s.lineTo(wid / 2, 0);
      s.lineTo(wid / 2, len * 0.35);
      s.bezierCurveTo(wid / 2, len * 0.75, wid * 0.05, len * 0.55, -wid * 0.1, len);
      s.bezierCurveTo(-wid * 0.3, len * 1.08, -wid / 2, len, -wid / 2, len * 0.8);
      s.lineTo(-wid / 2, 0);
      const caseG = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
      caseG.rotateX(Math.PI / 2);
      const body = new THREE.Mesh(caseG, black);
      body.position.set(0, h, -d / 2 + 0.15);
      g.add(body);
      const lid = new THREE.Mesh(new THREE.ShapeGeometry(s), black);
      lid.rotation.order = "ZXY";
      lid.rotation.set(Math.PI / 2, 0, -0.6);
      lid.position.set(wid / 2, h + 0.02, -d / 2 + 0.15);
      g.add(lid);
      box(0.012, 0.6, 0.012, wid / 2 - 0.3, h + 0.28, -d / 2 + 0.15 + len * 0.45, m("metal", "#202020")).rotation.z = 0.3;
      for (const [x, z] of [[-wid / 2 + 0.12, -d / 2 + 0.3], [wid / 2 - 0.12, -d / 2 + 0.3], [-wid * 0.1, -d / 2 + 0.15 + len * 0.9]]) box(0.1, h - 0.3, 0.1, x, (h - 0.3) / 2, z, black);
      // the keyboard sticks out at the front
      box(wid, 0.08, 0.2, 0, h - 0.33, -d / 2 + 0.05, black);
      const keys: [number, number, number, number, number, number, string][] = [];
      for (let i = 0; i < 52; i++) {
        const kw = (wid - 0.1) / 52, x = -wid / 2 + 0.05 + (i + 0.5) * kw;
        keys.push([kw - 0.002, 0.02, 0.15, x, h - 0.28, -d / 2 + 0.02, "#f4f1ea"]);
        if ([0, 2, 3, 5, 6].includes(i % 7) && i < 51) keys.push([kw * 0.55, 0.02, 0.09, x + kw / 2, h - 0.26, -d / 2 + 0.05, "#111111"]);
      }
      many("plastic", keys);
      // the bench
      box(0.9, 0.06, 0.35, 0, 0.48, -d / 2 - 0.45, black);
      for (const x of [-0.4, 0.4]) box(0.05, 0.45, 0.3, x, 0.225, -d / 2 - 0.45, black);
      break;
    }
    case "micStand": {
      // a tall stand: three feet, the pole, a boom out front and the mic on its end
      const metal = m("metal", "#1c1c1e");
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3, leg = box(0.32, 0.02, 0.02, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15, metal);
        leg.rotation.set(0, -a, 0.2);
      }
      cyl(0.012, h, 0, h / 2, 0, metal, 8);
      const boomLen = Math.max(0.4, d), boom = cyl(0.009, boomLen, 0, h, -boomLen / 2 + 0.1, metal, 8);
      boom.rotation.x = Math.PI / 2 - 0.25;
      const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 6, 12), m("metal", color));
      mic.position.set(0, h - Math.sin(0.25) * boomLen / 2, -boomLen + 0.12);
      mic.rotation.x = Math.PI / 2;
      g.add(mic);
      break;
    }
    case "panel": {
      // an acoustic panel on a wall: woven cloth over a wooden frame
      box(w, h, d, 0, h / 2, 0, m("panel", color));
      box(w + 0.02, 0.02, d + 0.01, 0, h, 0, m("wood", "#6a4a30"));
      break;
    }
    case "frames": {
      // a wall of clutter: posters, framed records and pictures pinned up across w by h
      const items: [number, number, number, number, number, number, string][] = [];
      for (let i = 0, n = Math.round(w * h * 3); i < n; i++) {
        const fw = 0.2 + rnd() * 0.45, fh = rnd() < 0.3 ? fw : 0.2 + rnd() * 0.5;
        items.push([fw, fh, 0.02, -w / 2 + fw / 2 + rnd() * Math.max(0, w - fw), fh / 2 + rnd() * Math.max(0, h - fh), -i * 0.0005, pick([...BOOKS, ...TOYS])]);
      }
      many("fabric", items);
      break;
    }
    case "sampler": {
      // a drum machine or sampler on a table: a box, a grid of pads, a small lit screen
      box(w, h, d, 0, h / 2, 0, m("plastic", color));
      const pads: [number, number, number, number, number, number, string][] = [], s = Math.min(w * 0.5, d * 0.8) / 4;
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) pads.push([s * 0.85, 0.01, s * 0.85, w * 0.18 + (i - 1.5) * s, h + 0.005, (k - 1.5) * s + d * 0.05, rnd() < 0.2 ? "#d04030" : "#3a3a3a"]);
      many("plastic", pads);
      g.add(glow(box(w * 0.3, 0.004, d * 0.22, -w * 0.25, h + 0.002, -d * 0.25, m("screen", "#a0e0a0")), 0.5));
      break;
    }
    case "table": {
      const wood = m("wood", color);
      box(w, 0.04, d, 0, h - 0.02, 0, wood);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.05, h - 0.04, 0.05, x * (w / 2 - 0.05), (h - 0.04) / 2, z * (d / 2 - 0.05), wood);
      break;
    }
    default: {
      const kit: Kit = { g, m, rnd, pick, box, cyl, glow, many };
      dressing(p, kit);
    }
  }
  return g;
}
