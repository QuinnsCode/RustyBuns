// The red-rock amphitheatre on the page, at golden hour: two great slanted sandstone slabs either side of the bowl and
// a third behind the stage, built from a seed (bedding stripes, weathered faces, a ragged top), the low sun lighting the
// right-hand wall and the left one in its own shade, seventy stone benches you climb, the stage roof with its two
// motors, the delay towers when they are up, the coverage map (H) as a tile at every seat, and the card: each point's
// load against its limit, the towers' time, the subs, the air, each part of the score and what is wrong in words.
// main.ts calls `amphitheatreView` once per world and then `key`, `hint` and `update`, as it does the small arena's.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import type { Answer, World } from "../sim.ts";
import { master, rig } from "./dive-bar.ts";
import { heatColour } from "./dive-bar-view.ts";
import {
  BACK_ROCK, DESK, HORNS, MAX_BRIGHT, PASS, POINTS, ROOF_Y, ROWS, RUN, TARGET, TOWERS, TOWER_H, WALLS, WEIGHTS, WINDOW, airOf, amp,
  atSubs, atTower, calc, check, delay, fly, frameY, halfWidth, hang, hear, land, loadKg, near, pin, rowFloor, rowZ, score, shade,
  show, subs, towers, aim, wantDelay, type Score, type Seat, type Show,
} from "./amphitheatre.ts";
import { type Face } from "@rustybuns/gear";

export type AmphitheatreView = {
  /** A key while playing; true when the amphitheatre used it. `say` shows a refusal under the crosshair. */
  key(code: string, say: (why: string) => void): boolean;
  hint(): string | null;
  update(): void;
  heatOn: boolean;
  setHeat(on: boolean): void;
  doors(): Show;
  dispose(): void;
};

/** Sandstone at golden hour: the deep red of the slabs, the paler bands between beds, the dark of desert varnish. */
const ROCK = [0x9a3b22, 0xb4532e, 0xc8693a, 0x8a3220, 0xa5462a, 0xd58a52];

/** Smooth seeded noise on a grid, summed over a few octaves: the rock's lumps and the ragged top. */
function noise2(seed: number) {
  const rnd = mulberry32(seed), table = Array.from({ length: 256 }, () => rnd());
  const h = (x: number, y: number) => table[((x * 73856093) ^ (y * 19349663)) & 255];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const one = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number) => one(x, y) * 0.55 + one(x * 2.1, y * 2.1) * 0.28 + one(x * 4.3, y * 4.3) * 0.17;
}

/**
 * A slab of rock: a sheet `w` wide and `h` tall standing on the ground along `along` (a unit vector on the floor),
 * leaning back along `back` (unit, out of the face), its face lumped by noise and its top cut ragged, and coloured in
 * horizontal beds as sandstone is laid down. Vertex colours, one material for every rock.
 */
function slab(seed: number, origin: THREE.Vector3, along: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const n = noise2(seed), nx = 72, ny = 48, pos: number[] = [], col: number[] = [], idx: number[] = [];
  const beds = mulberry32(seed + 7), bands = Array.from({ length: 40 }, () => ROCK[Math.floor(beds() * ROCK.length)]);
  const c = new THREE.Color(), dark = new THREE.Color(0x3a1810);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny;
    // The top is ragged and the ends round off, as a weathered fin does.
    const ends = Math.sin(Math.PI * u) ** 0.35, top = h * ends * (0.78 + 0.32 * n(u * 5, 9.3));
    const y = v * top, bulge = (n(u * 9, v * 6) - 0.5) * 7 + (n(u * 30, v * 22) - 0.5) * 1.6;
    const p = origin.clone().addScaledVector(along, u * w).addScaledVector(up, y).addScaledVector(back, -bulge);
    pos.push(p.x, p.y, p.z);
    // Beds by height, wavy; varnish streaks run down from the top; the foot is darker with shade and dust.
    const bed = bands[Math.floor((y / 2.6 + n(u * 3, 0.5) * 3) % bands.length)];
    c.setHex(bed).lerp(dark, Math.max(0, n(u * 40, 3.1) - 0.62) * 1.6 + (y < 3 ? 0.15 : 0));
    col.push(c.r, c.g, c.b);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A wall's slab from the sim's face: along the bowl's edge from past the stage to past the top row, leaning out. */
function wallSlab(seed: number, f: Face): THREE.BufferGeometry {
  const inward = new THREE.Vector3(f.normal.x, 0, f.normal.z).normalize();
  const along = new THREE.Vector3(-inward.z, 0, inward.x);
  if (along.z > 0) along.negate();
  const lean = Math.asin(f.normal.y), up = new THREE.Vector3(0, Math.cos(lean), 0).addScaledVector(inward, -Math.sin(lean));
  // From 20 m behind the stage lip down the whole bowl and past the top row; its foot a little under the ground.
  const back = (20 - f.at.z) / -along.z, start = new THREE.Vector3(f.at.x, -4, f.at.z).addScaledVector(along, -back);
  return slab(seed, start, along, up, inward.clone().negate(), back + (f.at.z - f.z0) / -along.z + 30, f.top + 4);
}

export function amphitheatreView(scene: THREE.Scene, hud: HTMLElement, getWorld: () => World): AmphitheatreView {
  const g = new THREE.Group();
  const mat = (color: number, roughness = 0.92) => new THREE.MeshStandardMaterial({ color, roughness });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };

  // The sky at golden hour: amber at the horizon, rose, then deep blue overhead, on a dome round the whole valley.
  const skyGeo = new THREE.SphereGeometry(600, 32, 16), sc: number[] = [], c = new THREE.Color();
  const sp = skyGeo.getAttribute("position");
  for (let k = 0; k < sp.count; k++) {
    const t = Math.max(0, sp.getY(k) / 600), west = Math.max(0, -sp.getX(k) / 600);
    if (t < 0.12) c.setHex(0xf7a35c).lerp(new THREE.Color(0xd9786a), t / 0.12);
    else c.setHex(0xd9786a).lerp(new THREE.Color(0x2a3a6e), Math.min(1, (t - 0.12) / 0.6));
    c.lerp(new THREE.Color(0xffc070), west * (1 - t) * 0.5);
    sc.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3));
  g.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
  // The sun, low in the west, and its warm light; the sky's fill; a bounce off the red ground.
  const sun = new THREE.DirectionalLight(0xffa860, 3.2);
  sun.position.set(-300, 70, -60);
  sun.target.position.set(0, 0, -50);
  g.add(sun, sun.target);
  g.add(new THREE.HemisphereLight(0x9fb0e8, 0x9a4a2a, 2.4));
  // The afterglow off the bright western sky and the walls, filling the steps' faces from the stage side.
  const glow = new THREE.DirectionalLight(0xffb080, 1.2);
  glow.position.set(40, 60, 200);
  g.add(glow);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }));
  disc.position.set(-560, 50, -110);
  g.add(disc);

  // The ground round the bowl, the valley falling away behind the stage, and the far mesas on the plain.
  const dirt = mat(0x8c4a2c);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), dirt);
  ground.position.set(0, -2, 0);
  g.add(ground);
  const plain = new THREE.Mesh(new THREE.PlaneGeometry(1400, 900).rotateX(-Math.PI / 2), mat(0x7a5a3a));
  plain.position.set(0, -60, 600);
  g.add(plain);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  for (let k = 0; k < 7; k++) {
    const r = mulberry32(90 + k), x = -500 + k * 160 + r() * 60, z = 380 + r() * 200, w = 60 + r() * 90, h = 25 + r() * 35;
    g.add(new THREE.Mesh(slab(200 + k, new THREE.Vector3(x, -60, z), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), w, h), rockMat));
  }

  // The two walls and the rock behind the stage.
  g.add(new THREE.Mesh(wallSlab(11, WALLS.left), rockMat), new THREE.Mesh(wallSlab(23, WALLS.right), rockMat));
  const backGeo = slab(37, new THREE.Vector3(70, -2, BACK_ROCK.z), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0.96, 0.28).normalize(), new THREE.Vector3(0, 0.28, -0.96), 140, BACK_ROCK.top);
  g.add(new THREE.Mesh(backGeo, rockMat));

  // The bowl: seventy stone steps, each with its bench, and the pit before the stage.
  const step = mat(0xb87452), bench = mat(0x6b4630, 0.8), aisle = mat(0x9a5c3e);
  box(halfWidth(1) * 2 + 8, 0.8, 6, step, 0, rowFloor(1) - 0.4, -3);
  for (let r = 1; r <= ROWS; r++) {
    const hw = halfWidth(r), y = rowFloor(r), z = rowZ(r);
    box(hw * 2 + 8, y + 2, RUN, step, 0, (y - 2) / 2, z);
    box(hw * 2 - 1, 0.42, 0.38, bench, 0, y + 0.21, z - RUN * 0.18);
    for (const x of [-hw * 0.5, hw * 0.5]) box(1.2, 0.02, RUN, aisle, x, y + 0.01, z);
  }
  // The top walk past row 70.
  box(halfWidth(ROWS) * 2 + 8, rowFloor(ROWS) + 2.4, 8, step, 0, (rowFloor(ROWS) + 0.4) / 2 - 1, rowZ(ROWS) - RUN / 2 - 4);

  // The stage: the deck, its skirt to the pit, the roof on four towers with the grid under it, and the desk's tent.
  const steel = mat(0x5c6068, 0.6);
  box(28, 1.2, 14, mat(0x2a201a), 0, -0.6, 7);
  for (const [x, z] of [[-14.5, 0.5], [14.5, 0.5], [-14.5, 13.5], [14.5, 13.5]]) box(0.6, ROOF_Y + 1.5, 0.6, steel, x, ROOF_Y / 2 + 0.15, z);
  box(31, 0.5, 15, mat(0x1d1f24), 0, ROOF_Y + 1, 7);
  box(30, 0.3, 0.3, steel, 0, ROOF_Y, 1);
  const tent = new THREE.Mesh(new THREE.ConeGeometry(3.4, 2.2, 4), mat(0xe9e2d4));
  tent.position.set(DESK.x, rowFloor(30) + 3.2, DESK.z);
  tent.rotation.y = Math.PI / 4;
  g.add(tent);
  // Motors and chains at the two points; a frame goes yellow while it waits for its check.
  const frameMat = mat(0xd24a3a), unchecked = mat(0xf2c230);
  const rigs = new Map<string, { chain: THREE.Mesh; frame: THREE.Mesh }>();
  for (const p of POINTS) {
    box(0.4, 0.6, 0.4, mat(0x1c1f24), p.x, ROOF_Y - 0.45, p.z);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1).translate(0, -0.5, 0), mat(0x9aa0a8));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.8), frameMat);
    g.add(chain, frame);
    rigs.set(p.key, { chain, frame });
  }
  // The delay towers: a truss mast in the side aisle, shown once the crew has it up.
  const masts = TOWERS.map((t) => {
    const m = box(0.5, TOWER_H, 0.5, steel, t.x, t.y - TOWER_H / 2, t.z);
    m.visible = false;
    return m;
  });

  // The coverage map: a tile at every seat on the map, coloured against the target.
  const seats = hear(getWorld());
  const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }), seats.length);
  const m4 = new THREE.Matrix4(), colour = new THREE.Color();
  seats.forEach((s, k) => {
    m4.makeScale(((halfWidth(s.row) - 1.5) * 2) / 8.4, 1, RUN * 0.92).setPosition(s.x, s.y - 1.05, s.z);
    tiles.setMatrixAt(k, m4);
  });
  tiles.visible = false;
  g.add(tiles);

  scene.add(g);
  const was = { fog: scene.fog, background: scene.background };
  scene.fog = new THREE.Fog(0xd98a66, 160, 650);
  scene.background = new THREE.Color(0xd98a66);

  const card = document.createElement("div");
  card.className = "bar-card";
  hud.appendChild(card);

  let seen = "", last: Score | null = null, opened: Show | null = null;
  const signature = (w: World) => JSON.stringify([amp(w), rig(w).master, airOf(w)]);
  function paint(w: World) {
    const now: Seat[] = hear(w);
    now.forEach((s, k) => { const [r, gg, b] = heatColour(s.mid, TARGET, WINDOW); tiles.setColorAt(k, colour.setRGB(r / 255, gg / 255, b / 255)); });
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    last = score(w, now);
    for (const p of POINTS) {
      const h = amp(w).hangs[p.key], r = rigs.get(p.key)!, y = frameY(h);
      r.frame.position.set(p.x, y + 0.06, p.z);
      r.chain.position.set(p.x, ROOF_Y - 0.75, p.z);
      r.chain.scale.y = Math.max(0.01, ROOF_Y - 0.75 - y);
      r.frame.material = h.boxes && !h.checked && h.trim === null ? unchecked : frameMat;
    }
    masts.forEach((m) => (m.visible = amp(w).towers));
  }

  const said = (a: Answer, say: (why: string) => void) => { if (!a.ok) say(a.why); return true; };
  const atDesk = (w: World) => Math.hypot(w.you.x - DESK.x, w.you.z - DESK.z) < 3;
  const view: AmphitheatreView = {
    heatOn: false,
    setHeat(on) { view.heatOn = on; tiles.visible = on; },
    key(code, say) {
      const w = getWorld(), p = near(w), t = atTower(w), r = amp(w);
      if (p) {
        const h = r.hangs[p.key];
        if (code === "KeyU" || code === "KeyJ") return said(hang(w, p.key, h.boxes + (code === "KeyU" ? 1 : -1)), say);
        if (code === "KeyK") { const c = calc(w, p.key)!; return said(pin(w, p.key, c.tilt, c.splays), say); }
        if (code === "KeyI") return said(check(w, p.key), say);
        if (code === "KeyO") return said(h.trim === null ? fly(w, p.key) : land(w, p.key), say);
        if (code === "Comma" || code === "Period") return said(aim(w, p.key, h.toe + (code === "Period" ? 2 : -2)), say);
        if (code === "KeyN") return said(aim(w, p.key, h.toe, h.horn === "wide" ? "narrow" : "wide"), say);
        if (code === "KeyB") return said(shade(w, p.key, h.bright >= MAX_BRIGHT ? 0 : h.bright + 3), say);
      }
      if (t) {
        if (code === "KeyG") return said(towers(w, !r.towers), say);
        if (code === "KeyU" || code === "KeyJ") return said(delay(w, r.delayMs + (code === "KeyU" ? 2 : -2)), say);
        if (code === "KeyB") return said(shade(w, "towers", r.towerBright >= MAX_BRIGHT ? 0 : r.towerBright + 3), say);
      }
      if (code === "KeyV" && atSubs(w)) return said(subs(w, r.subs === "cardioid" ? "forward" : "cardioid"), say);
      if (code === "KeyH") return view.setHeat(!view.heatOn), true;
      if (code === "BracketLeft" || code === "BracketRight") {
        if (!atDesk(w)) return say("the fader is on the desk, in the tent at row 30"), true;
        return master(w, rig(w).master + (code === "BracketLeft" ? -1 : 1)), true;
      }
      if (code === "Enter") return view.doors(), true;
      return false;
    },
    hint() {
      const w = getWorld(), p = near(w);
      if (p) return `${p.name}: U / J boxes, K pins, I check, O fly, < > toe, N horn, B brighter`;
      if (atTower(w)) return `Delay tower: G ${amp(w).towers ? "take it down" : "put it up"}, U / J time, B brighter`;
      if (atSubs(w)) return `Subs: V ${amp(w).subs === "cardioid" ? "all forward" : "cardioid"}`;
      if (atDesk(w)) return "Desk: [ ] fader";
      return null;
    },
    update() {
      const w = getWorld(), sig = signature(w);
      if (sig !== seen) { seen = sig; paint(w); }
      const s = last!, r = amp(w), air = airOf(w), db = (v: number) => (Number.isFinite(v) ? `${v} dB` : "silent");
      const rows = POINTS.map((q) => {
        const h = r.hangs[q.key], kg = loadKg(h), over = kg > q.limitKg;
        const state = h.trim !== null ? `flown ${h.trim.toFixed(1)} m` : h.checked ? "checked" : h.boxes ? "not checked" : "empty";
        return `<span class="${over ? "warn" : ""}">${q.name}: ${h.boxes} box, ${kg} / ${q.limitKg} kg, ${state}, toe ${h.toe}, ${HORNS[h.horn]}°, +${h.bright} dB</span>`;
      }).join("");
      const parts = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => `${k} ${Math.round(s.parts[k] * 100)}%`).join(", ");
      card.innerHTML = `<b>${opened ? "Doors open" : "Red-rock amphitheatre"}</b>` + rows
        + `<span>Towers ${r.towers ? `up, ${r.delayMs} ms (the mains need about ${wantDelay(w)})` : "down"}, subs ${r.subs}</span>`
        + `<span>${air.label}: ${air.tempC} C, ${air.humidity}% damp, breeze ${Math.abs(air.wind)} m/s ${air.wind < 0 ? "down" : "up"} the bowl</span>`
        + `<span>Row 5 ${db(s.rows.front)}, desk ${db(s.rows.desk)}, row ${ROWS} ${db(s.rows.top)}; houses ${db(s.house.db)}</span>`
        + `<span>${parts}</span>`
        + s.why.map((y) => `<span class="warn">${y}</span>`).join("")
        + (opened
          ? `<span class="${opened.pass ? "pass" : ""}">Show ${opened.score} / ${PASS} to pass${opened.cut ? `, ${opened.cut} min cut at curfew` : ""}</span><span>Paid $${opened.pay} of $${opened.fee}</span>`
          : `<span class="${s.pass ? "pass" : ""}">Score ${s.score} / ${PASS} to pass</span>`)
        + `<small>At a point: U / J boxes, K pins, I check, O fly, &lt; &gt; toe, N horn, B bright. Row 36: G towers. Lip: V subs. H map, [ ] fader at the desk, Enter doors</small>`;
    },
    doors() {
      view.update();
      return (opened = show(getWorld()));
    },
    dispose() { scene.remove(g); scene.fog = was.fog; scene.background = was.background; card.remove(); },
  };
  return view;
}
