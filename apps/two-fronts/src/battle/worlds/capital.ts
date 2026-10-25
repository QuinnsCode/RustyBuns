// The capital after the bombing, for the eye only: the sim's tall blocks become shattered high-rises
// (window bays peeled off the upper floors, slabs hanging, rebar), its low ones burning cars and heaps
// of masonry, with collapsed overpasses, smoke columns into the ash, scorch marks and cracked lane
// lines on the street. Everything repeated is instanced.
import * as THREE from "three";
import { foliageQuality } from "../foliage.ts";
import type { Kit } from "../landmarks.ts";
import { lumpy, texture } from "../models.ts";
import { EYE, POST_RADIUS } from "../sim.ts";

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const FLOOR = 3.2, BAY = 4; // a storey's height, and the width of a window bay

// One bay of facade: two window openings, glass gone from some, soot streaking up from each.
const facadeMap = () => texture("ruin-facade", 160, 128, [1, 1], (c, r) => {
  c.fillStyle = grey(165); c.fillRect(0, 0, 160, 128);
  for (let i = 0; i < 500; i++) { c.fillStyle = grey(70 + r() * 150, 0.2); c.fillRect(r() * 160, r() * 128, 1 + r() * 3, 1 + r() * 3); }
  c.fillStyle = grey(115); c.fillRect(0, 112, 160, 16);
  for (const x of [22, 90]) {
    c.fillStyle = grey(22); c.fillRect(x, 24, 48, 66);
    if (r() < 0.6) for (let i = 0; i < 5; i++) { c.fillStyle = grey(120 + r() * 80, 0.55); c.beginPath(); const sx = x + r() * 40, sy = 24 + r() * 50; c.moveTo(sx, sy); c.lineTo(sx + 4 + r() * 8, sy + 3); c.lineTo(sx + 2, sy + 10 + r() * 14); c.fill(); }
    c.strokeStyle = grey(95); c.lineWidth = 3; c.strokeRect(x, 24, 48, 66); c.beginPath(); c.moveTo(x + 24, 24); c.lineTo(x + 24, 90); c.stroke();
    const soot = c.createLinearGradient(0, 24, 0, -4); soot.addColorStop(0, grey(0, 0.6)); soot.addColorStop(1, grey(0, 0));
    c.fillStyle = soot; c.fillRect(x - 3, 0, 54, 24);
  }
  c.strokeStyle = grey(60, 0.6); c.lineWidth = 1;
  for (let i = 0; i < 3; i++) { c.beginPath(); let x = r() * 160, y = 0; c.moveTo(x, y); for (; y < 128; y += 12) { x += (r() - 0.5) * 12; c.lineTo(x, y); } c.stroke(); }
});
// Smoke in a tall soft column, flame as a teardrop, and a round glow.
const smokeMap = () => texture("ruin-smoke", 64, 256, [1, 1], (c, r) => {
  for (let i = 0; i < 70; i++) {
    const f = r(), y = 256 - f * 250, rad = 10 + f * 20 + r() * 8, x = 32 + (r() - 0.5) * (6 + f * 22);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, grey(255, 0.16 * (1 - f * 0.6))); g.addColorStop(1, grey(255, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
  }
});
const flameMap = () => texture("ruin-flame", 32, 64, [1, 1], (c) => {
  const g = c.createRadialGradient(16, 46, 1, 16, 42, 26);
  g.addColorStop(0, "rgba(255,240,170,1)"); g.addColorStop(0.35, "rgba(255,150,40,0.9)"); g.addColorStop(1, "rgba(200,40,0,0)");
  c.fillStyle = g; c.save(); c.scale(0.7, 1); c.fillRect(0, 0, 46, 64); c.restore();
});
const glowMap = () => texture("ruin-glow", 64, 64, [1, 1], (c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, grey(255, 1)); g.addColorStop(1, grey(255, 0));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});

export function ruinedCity(k: Kit): (t: number) => void {
  const { b, keep, heightAt, r, n, bare, std, add } = k, { inst, put, done } = k.inst;
  const m = new THREE.Matrix4(), tw = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color(), e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0), Q = foliageQuality();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const concrete = std(0xffffff, 0.95, { flatShading: true });
  const at = (x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx) => m.compose(p.set(x, y, z), q.setFromAxisAngle(UP, ry), s.set(sx, sy, sz));
  const jag = () => (r() - 0.5);

  // --- The high-rises: every tall block the sim laid out, and the palace by the keep. ---
  type Piece = { m: THREE.Matrix4; c: THREE.Color };
  const panels: Piece[] = [], cores: Piece[] = [], slabs: Piece[] = [], bars: Piece[] = [];
  const fires: { x: number; y: number; z: number; w: number; phase: number; smoke: number }[] = [];
  const piece = (list: Piece[], local: THREE.Matrix4, c: THREE.Color) => list.push({ m: tw.clone().multiply(local), c: c.clone() });
  for (const blk of b.blocks) {
    if (blk.h < EYE || blk.kind) continue;
    const palace = blk.x === keep.x && blk.z === keep.z - 18;
    const nf = palace ? 14 : Math.round((blk.h * 1.25 + 8) / FLOOR), W = blk.w, D = blk.d;
    const lean = palace ? 0.06 : r() < 0.25 ? jag() * 0.16 : 0;
    tw.compose(p.set(blk.x, heightAt(blk.x, blk.z) - 0.8, blk.z), q.setFromEuler(e.set(r() < 0.5 ? lean * 0.6 : 0, 0, lean)), s.set(1, 1, 1));
    // Each face stands to its own height, ragged along the top, with a bite or two blown out of it.
    const faces = [{ ry: 0, run: W, off: D / 2 }, { ry: Math.PI, run: W, off: D / 2 }, { ry: Math.PI / 2, run: D, off: W / 2 }, { ry: -Math.PI / 2, run: D, off: W / 2 }];
    let low = nf;
    for (const [fi, f] of faces.entries()) {
      const bays = Math.max(1, Math.round(f.run / BAY)), bw = f.run / bays;
      const top = palace && fi === 0 ? nf : Math.round(nf * (r() < 0.35 ? 1 : 0.3 + 0.55 * r()));
      const bite = { a: Math.floor(r() * bays), len: 1 + Math.floor(r() * 2), f0: 1 + Math.floor(r() * Math.max(1, top - 3)), f1: 0 };
      bite.f1 = bite.f0 + 2 + Math.floor(r() * 3);
      for (let i = 0; i < bays; i++) {
        const stand = Math.max(2, Math.min(nf, top + Math.round(jag() * 3)));
        low = Math.min(low, stand);
        for (let fl = 0; fl < stand; fl++) {
          if (i >= bite.a && i < bite.a + bite.len && fl >= bite.f0 && fl < bite.f1) continue;
          if (fl > 1 && r() < 0.08) continue;
          const along = (i + 0.5) * bw - f.run / 2;
          const x = Math.sin(f.ry) * f.off + Math.cos(f.ry) * along, z = Math.cos(f.ry) * f.off - Math.sin(f.ry) * along;
          col.setHSL(0.07 + r() * 0.04, 0.03 + r() * 0.06, 0.55 + r() * 0.35 - fl * 0.004);
          piece(panels, at(x, fl * FLOOR, z, f.ry, bw / BAY), col);
        }
      }
    }
    // The core behind the shell, and a ledge at every storey it reaches.
    col.setHSL(0.07, 0.1, 0.1 + r() * 0.05);
    piece(cores, at(0, (low * FLOOR) / 2, 0, 0, W - 0.8, low * FLOOR, D - 0.8), col);
    for (let fl = 1; fl <= low; fl++) piece(slabs, at(0, fl * FLOOR - 0.2, 0, 0, W - 0.2, 0.3, D - 0.2), col.setHSL(0.08, 0.06, 0.42 + r() * 0.1));
    // Above it, floors hanging half off, and rebar at their torn edges.
    for (let fl = low; fl < nf; fl++) {
      if (r() < 0.45) continue;
      const sx = 0.4 + r() * 0.5, sz = 0.4 + r() * 0.5;
      q.setFromEuler(e.set(jag() * 0.3, r() * 0.4, jag() * 0.3));
      const ox = (r() - 0.5) * W * 0.4, oz = (r() - 0.5) * D * 0.4;
      piece(slabs, m.compose(p.set(ox, fl * FLOOR, oz), q, s.set(W * sx, 0.3, D * sz)), col.setHSL(0.08, 0.06, 0.38 + r() * 0.1));
      for (let j = 0; j < 3; j++) {
        q.setFromEuler(e.set(jag() * 0.8, 0, jag() * 0.8));
        piece(bars, m.compose(p.set(ox + (r() - 0.5) * W * sx, fl * FLOOR + 0.6, oz + (r() - 0.5) * D * sz), q, s.set(1, 0.6 + r(), 1)), col.setHex(0x5b3a2a));
      }
    }
    for (let j = 0; j < 7; j++) {
      q.setFromEuler(e.set(jag() * 0.7, 0, jag() * 0.7));
      piece(bars, m.compose(p.set((r() - 0.5) * (W - 1), low * FLOOR + 0.5, (r() - 0.5) * (D - 1)), q, s.set(1, 1 + r() * 1.4, 1)), col.setHex(0x4a2f22));
    }
    if (palace || r() < 0.14) {
      p.set((r() - 0.5) * W * 0.5, low * FLOOR + 1, (r() - 0.5) * D * 0.5).applyMatrix4(tw);
      fires.push({ x: p.x, y: p.y, z: p.z, w: palace ? 3.2 : 2.2, phase: r() * 6, smoke: palace ? 110 : 80 });
    }
  }
  const shell = inst(new THREE.PlaneGeometry(BAY, FLOOR).translate(0, FLOOR / 2, 0), std(0xffffff, 0.9, { map: facadeMap(), side: THREE.DoubleSide }), panels.length);
  const kernel = inst(box, std(0xffffff, 1), cores.length, true);
  const ledges = inst(box, concrete, slabs.length, true);
  const rebar = inst(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 4).translate(0, 0.8, 0), std(0xffffff, 0.7, { metalness: 0.4 }), bars.length);
  for (const [mesh, list] of [[shell, panels], [kernel, cores], [ledges, slabs], [rebar, bars]] as const) for (const pc of list) put(mesh, pc.m, pc.c);
  done(shell, kernel, ledges, rebar);

  // --- The cars and the heaps of masonry the sim made cover of. ---
  const wrecks = b.blocks.filter((x) => x.kind === "wreck"), heaps = b.blocks.filter((x) => x.kind === "rubble");
  const bodies = inst(box, std(0xffffff, 0.8, { metalness: 0.25 }), wrecks.length * 2, true);
  const tyres = inst(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8).rotateX(Math.PI / 2), std(0x151515, 1), wrecks.length * 4, true);
  const scorch = inst(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), wrecks.length + 40, false, false);
  for (const w of wrecks) {
    const y = heightAt(w.x, w.z), ry = w.w >= w.d ? 0 : Math.PI / 2, flip = r() < 0.2, tilt = jag() * 0.2;
    q.setFromEuler(e.set(0, ry + jag() * 0.4, flip ? Math.PI + tilt : tilt, "YXZ"));
    const place = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
      p.set(lx, flip ? -ly : ly, lz).applyQuaternion(q).add(s.set(w.x, y + (flip ? 1.4 : 0), w.z));
      return m.compose(p, q, s.set(sx, sy, sz));
    };
    col.setHSL(r() < 0.5 ? 0.05 : r() < 0.5 ? 0.6 : 0.1, 0.2 + r() * 0.2, 0.1 + r() * 0.12);
    put(bodies, place(0, 0.65, 0, 4.4, 0.8, 1.9), col);
    put(bodies, place(-0.2, 1.3, 0, 2.3, 0.7, 1.7), col.offsetHSL(0, 0, -0.03));
    for (const [dx, dz] of [[1.4, 0.95], [1.4, -0.95], [-1.4, 0.95], [-1.4, -0.95]] as const) if (r() < 0.8) put(tyres, place(dx, 0.34, dz, 1, 1, 1));
    put(scorch, at(w.x, y + 0.06, w.z, ry, 3.4, 1, 2.6));
    if (r() < 0.4) fires.push({ x: w.x, y: y + 1.1, z: w.z, w: 1.4 + r(), phase: r() * 6, smoke: r() < 0.5 ? 70 : 0 });
  }
  const chunkGeo = lumpy(1, 1, 0.3, 4, false);
  const chunks = inst(chunkGeo, std(0xffffff, 1, { flatShading: true }), 2400, true), plates = inst(box, concrete, 900, true), wire = inst(rebar.geometry, rebar.material, 700);
  const heap = (x: number, z: number, rw: number, rd: number, rh: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = r() * 6.3, d = Math.sqrt(r()), px = x + Math.cos(a) * d * rw, pz = z + Math.sin(a) * d * rd, f = 1 - d * 0.7, sz = (0.5 + r() * 0.9) * Math.max(0.6, f);
      col.setHSL(0.08, 0.05 + r() * 0.05, 0.28 + r() * 0.2);
      put(chunks, m.compose(p.set(px, heightAt(px, pz) + rh * f * (0.25 + r() * 0.5), pz), q.setFromEuler(e.set(r(), r() * 6, r())), s.set(sz * 1.3, sz * 0.8, sz)), col);
    }
    for (let i = 0; i < Math.ceil(count / 4); i++) {
      const px = x + (r() - 0.5) * rw * 1.4, pz = z + (r() - 0.5) * rd * 1.4;
      col.setHSL(0.09, 0.05, 0.42 + r() * 0.12);
      put(plates, m.compose(p.set(px, heightAt(px, pz) + rh * (0.2 + r() * 0.5), pz), q.setFromEuler(e.set(jag() * 0.9, r() * 6, jag() * 0.9)), s.set(1.2 + r() * 1.8, 0.2, 0.9 + r() * 1.2)), col);
      q.setFromEuler(e.set(jag() * 1.2, 0, jag() * 1.2));
      if (r() < 0.6) put(wire, m.compose(p.set(px, heightAt(px, pz) + rh * 0.5, pz), q, s.set(1, 0.8 + r(), 1)), col.setHex(0x4a2f22));
    }
  };
  for (const h of heaps) heap(h.x, h.z, h.w * 0.55, h.d * 0.55, h.h, Math.round(h.w * h.d * 0.9));
  // Rubble fields: loose masonry strewn over the open ground.
  for (let i = 0, made = 0; i < 400 && made < Math.round(70 * Q); i++) {
    const a = k.anywhere(0.95);
    if (bare(a.x, a.z, 3)) continue;
    made++;
    heap(a.x, a.z, 2 + r() * 3, 2 + r() * 3, 0.9 + r(), 4 + Math.floor(r() * 5));
  }
  for (let i = 0; i < 40; i++) { const a = k.anywhere(0.95); put(scorch, at(a.x, heightAt(a.x, a.z) + 0.05, a.z, r() * 6, 2 + r() * 3.5, 1, 2 + r() * 3.5)); }
  done(bodies, tyres, scorch, chunks, plates, wire);

  // --- The street: worn lane lines down the trail, cracks across it. ---
  const route = [b.spawn.attacker, ...b.posts, b.spawn.defender];
  const lines = inst(new THREE.PlaneGeometry(0.28, 2.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 400, false, false);
  const cracks = inst(new THREE.PlaneGeometry(0.1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 500, false, false);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, c = route[i]!, len = Math.hypot(c.x - a.x, c.z - a.z), dir = Math.atan2(c.x - a.x, c.z - a.z);
    for (let d = 8; d < len - 8; d += 5) {
      const px = a.x + ((c.x - a.x) * d) / len, pz = a.z + ((c.z - a.z) * d) / len, x = px - n(pz / 40, 3.7) * 6;
      if (b.posts.some((o) => Math.hypot(o.x - px, o.z - pz) < POST_RADIUS + 3)) continue;
      if (r() > 0.3) put(lines, at(x, heightAt(x, pz) + 0.07, pz, dir, 1), col.setHSL(0.12, 0.3, 0.55 + r() * 0.3));
      if (r() < 0.8) {
        const cx = x + (r() - 0.5) * 6, cz = pz + (r() - 0.5) * 6;
        put(cracks, at(cx, heightAt(cx, cz) + 0.07, cz, r() * 6, 1, 1, 2 + r() * 5));
      }
    }
  }
  done(lines, cracks);

  // --- Collapsed overpasses: a span still on its piers, and the next one fallen to the street. ---
  const deckMat = std(0x77736d, 0.95, { flatShading: true }), spans: [number, number][] = [];
  for (let i = 0; i < 160 && spans.length < 3; i++) {
    const a = k.anywhere(0.7), ang = [0, Math.PI / 2][Math.floor(r() * 2)]! + jag() * 0.3, c = Math.cos(ang), sn = Math.sin(ang);
    const foot = [-14, -2, 10, 22].map((d) => ({ x: a.x + c * d, z: a.z - sn * d }));
    if ([...foot, a].some((f) => bare(f.x, f.z, 4) || Math.abs(f.x) > b.half - 15 || Math.abs(f.z) > b.half - 15 || [...b.posts, keep].some((o) => Math.hypot(o.x - f.x, o.z - f.z) < POST_RADIUS + 12))) continue;
    if (spans.some(([sx, sz]) => Math.hypot(sx - a.x, sz - a.z) < 70)) continue;
    spans.push([a.x, a.z]);
    const g = new THREE.Group(), y = heightAt(a.x, a.z), mesh = (geo: THREE.BufferGeometry, x: number, yy: number, z: number) => { const o = new THREE.Mesh(geo, deckMat); o.position.set(x, yy, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    for (const px of [-14, 10]) for (const pz of [-2.4, 2.4]) mesh(new THREE.BoxGeometry(1.6, 8, 1.6), px, 4 - 0.5, pz);
    mesh(new THREE.BoxGeometry(28, 1.1, 8), -2, 8, 0);
    for (const z of [-3.8, 3.8]) for (let x = -14; x < 11; x += 6) if (r() < 0.8) mesh(new THREE.BoxGeometry(5, 0.9, 0.35), x + 2.4, 8.9, z);
    const fell = mesh(new THREE.BoxGeometry(18, 1.1, 8), 12 + 9 * Math.cos(0.42), 8 - 9 * Math.sin(0.42), 0);
    fell.rotation.set(jag() * 0.2, 0, -0.42);
    for (let j = 0; j < 6; j++) { const o = new THREE.Mesh(rebar.geometry, rebar.material); o.position.set(12 + jag() * 1.5, 7.6, (r() - 0.5) * 7); o.rotation.set(jag(), 0, -0.4 + jag() * 0.5); g.add(o); }
    g.position.set(a.x, y, a.z);
    g.rotation.y = ang;
    add(g);
    heap(a.x + c * 22, a.z - sn * 22, 5, 5, 3, 14);
  }
  done(chunks, plates, wire);

  // --- The skyline past the edge: more broken towers, lost in the haze. ---
  const far = inst(box, std(0xffffff, 1), Math.round(70 * Q) * 2, false);
  for (let i = 0; i < Math.round(70 * Q); i++) {
    const a = r() * 6.3, d = b.half + 6 + r() * b.half * 0.9, x = Math.max(-1, Math.min(1, Math.cos(a) * 1.5)) * d, z = Math.max(-1, Math.min(1, Math.sin(a) * 1.5)) * d;
    const w = 9 + r() * 14, dd = 9 + r() * 14, h = 26 + r() * 60, y = heightAt(x, z) - 2;
    col.setHSL(0.07, 0.06, 0.2 + r() * 0.1);
    put(far, at(x, y + h / 2, z, r() * 3, w, h, dd), col);
    q.setFromEuler(e.set(jag() * 0.5, r() * 3, jag() * 0.5));
    put(far, m.compose(p.set(x, y + h + 1.5, z), q, s.set(w * 0.8, 6 + r() * 8, dd * 0.7)), col);
    if (r() < 0.35) fires.push({ x, y: y + h * 0.6, z, w: 0, phase: r() * 6, smoke: 140 });
  }
  done(far);

  // --- Fire and smoke. ---
  const burn = fires.filter((f) => f.w > 0);
  const flameGeo = new THREE.PlaneGeometry(1, 1.8).translate(0, 0.9, 0);
  const flames = inst(flameGeo, new THREE.MeshBasicMaterial({ map: flameMap(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }), burn.length * 2);
  const glows = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowMap(), color: 0xff7a22, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), burn.length, false, false);
  const columns = fires.filter((f) => f.smoke > 0);
  const smokeGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const smoke = inst(smokeGeo, new THREE.MeshBasicMaterial({ map: smokeMap(), color: 0x3a3532, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), columns.length * 2, false, false);
  const cols = columns.map((f) => ({ f, tilt: jag() * 0.12, spin: r() * 6 }));
  const frame = (t: number) => {
    flames.count = glows.count = smoke.count = 0;
    for (const f of burn) {
      const flick = 0.8 + 0.25 * Math.sin(t * 11 + f.phase) + 0.15 * Math.sin(t * 23 + f.phase * 3);
      put(flames, m.compose(p.set(f.x, f.y, f.z), q.setFromAxisAngle(UP, f.phase), s.set(f.w, f.w * flick, f.w)));
      put(flames, m.compose(p.set(f.x, f.y, f.z), q.setFromAxisAngle(UP, f.phase + 1.5), s.set(f.w * 0.8, f.w * flick * 1.1, f.w * 0.8)));
      put(glows, m.compose(p.set(f.x, f.y - 0.9, f.z), q.identity(), s.set(f.w * 7, 1, f.w * 7)));
    }
    for (const { f, tilt, spin } of cols) for (const turn of [0, Math.PI / 2]) {
      const sway = Math.sin(t * 0.15 + spin) * 0.05;
      const w = f.smoke * (0.17 + 0.03 * Math.sin(t * 0.4 + spin));
      put(smoke, m.compose(p.set(f.x, f.y, f.z), q.setFromEuler(e.set(tilt + sway, turn + spin, tilt - sway, "YXZ")), s.set(w, f.smoke, 1)));
    }
    done(flames, glows, smoke);
  };
  frame(0);
  return frame;
}
