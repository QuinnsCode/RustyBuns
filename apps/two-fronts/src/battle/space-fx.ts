// The space battle's effects, all for the eye: bolts crossing the gap, sparks, fire and smoke as
// soft round points, engine trails, and the shock ring of a ship going up. Each is one draw call
// whatever how many there are, and the view (space-view.ts) feeds them every frame.
import * as THREE from "three";

const glowMat = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

// Bolts: a glow round a hot core, `len` long, at `at` (0 leaving the muzzle, 1 landing) of the way along.
export interface BoltDraw { ax: number; ay: number; az: number; bx: number; by: number; bz: number; at: number; len: number; w: number; color: THREE.Color }
export function makeBolts(scene: THREE.Scene, max = 600) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateX(Math.PI / 2);
  const glow = new THREE.InstancedMesh(geo, glowMat(0xffffff, 0.55), max), core = new THREE.InstancedMesh(geo, glowMat(0xfff6ee), max);
  for (const m of [glow, core]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; scene.add(m); }
  core.renderOrder = 1;
  const a = new THREE.Vector3(), d = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1), q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  return (list: BoltDraw[]) => {
    let n = 0;
    for (const f of list) {
      if (n >= max) break;
      d.set(f.bx - f.ax, f.by - f.ay, f.bz - f.az);
      const span = d.length();
      if (span < 1e-3) continue;
      d.divideScalar(span);
      const len = Math.min(f.len, span);
      // The bolt's middle, kept between the muzzle and where it lands.
      a.set(f.ax, f.ay, f.az).addScaledVector(d, len / 2 + (span - len) * f.at);
      q.setFromUnitVectors(z, d);
      glow.setMatrixAt(n, m.compose(a, q, s.set(f.w * 2.4, f.w * 2.4, len * 1.1)));
      glow.setColorAt(n, f.color);
      core.setMatrixAt(n, m.compose(a, q, s.set(f.w * 0.7, f.w * 0.7, len)));
      n++;
    }
    for (const x of [glow, core]) { x.count = n; x.instanceMatrix.needsUpdate = true; }
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  };
}

// Points that fly, slow, grow and fade: sparks and fire (added light) or smoke (laid over).
export interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; grow: number; color: number; drag?: number }
export function makeParticles(scene: THREE.Scene, max: number, additive: boolean) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { scale: { value: 400 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vColor; varying float vAlpha; uniform float scale;
      void main() { vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha;
      void main() { float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; float a = vAlpha * (1.0 - r * r); gl_FragColor = vec4(vColor * ${additive ? "a" : "1.0"}, ${additive ? "1.0" : "a"}); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const list: (Puff & { age: number; c: THREE.Color })[] = [];
  return {
    add(p: Puff) { if (list.length >= max) list.shift(); list.push({ ...p, age: 0, c: new THREE.Color(p.color) }); },
    // `scale` keeps a point's size in world units whatever the canvas height.
    step(dt: number, scale: number) {
      mat.uniforms.scale!.value = scale;
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]!;
        if ((p.age += dt) >= p.life) { list.splice(i, 1); continue; }
        const k = Math.exp(-(p.drag ?? 1) * dt);
        p.vx *= k; p.vy *= k; p.vz *= k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      for (const p of list) {
        const f = p.age / p.life;
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
        col[n * 3] = p.c.r; col[n * 3 + 1] = p.c.g; col[n * 3 + 2] = p.c.b;
        size[n] = p.size * (1 + p.grow * f);
        alpha[n] = additive ? (1 - f) * (1 - f) : (1 - f) * 0.55 * Math.min(1, f * 6);
        n++;
      }
      geo.setDrawRange(0, n);
      for (const k of ["position", "color", "size", "alpha"]) geo.getAttribute(k).needsUpdate = true;
    },
  };
}

// Engine trails: the last second or so of where each craft has been, fading out behind it.
export function makeTrails(scene: THREE.Scene, points = 18) {
  const MAX = 160 * points * 2;
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  scene.add(lines);
  const trails = new Map<number, { p: number[]; color: THREE.Color; seen: boolean }>();
  return {
    // A craft's place now; call once a sample (the view samples at a steady rate).
    push(id: number, x: number, y: number, z: number, color: THREE.Color) {
      let t = trails.get(id);
      if (!t) trails.set(id, (t = { p: [], color, seen: true }));
      t.seen = true;
      t.p.push(x, y, z);
      if (t.p.length > points * 3) t.p.splice(0, 3);
    },
    // Forget the ones not pushed since the last sweep (the craft is gone).
    sweep() { for (const [id, t] of trails) { if (!t.seen) trails.delete(id); t.seen = false; } },
    // Draw, with the newest point pinned to where the craft is this frame.
    draw(head: (id: number) => { x: number; y: number; z: number } | null) {
      let n = 0;
      for (const [id, t] of trails) {
        const h = head(id), k = t.p.length / 3;
        for (let i = 0; i < k && n < MAX - 2; i++) {
          const a = i === k - 1 && h ? [h.x, h.y, h.z] : [t.p[i * 3]!, t.p[i * 3 + 1]!, t.p[i * 3 + 2]!];
          const b = i === k - 1 ? null : i === k - 2 && h ? [h.x, h.y, h.z] : [t.p[i * 3 + 3]!, t.p[i * 3 + 4]!, t.p[i * 3 + 5]!];
          if (!b) break;
          const fa = i / k, fb = (i + 1) / k;
          pos.set(a, n * 3); pos.set(b, n * 3 + 3);
          col.set([t.color.r * fa, t.color.g * fa, t.color.b * fa], n * 3);
          col.set([t.color.r * fb, t.color.g * fb, t.color.b * fb], n * 3 + 3);
          n += 2;
        }
      }
      geo.setDrawRange(0, n);
      geo.getAttribute("position").needsUpdate = true;
      geo.getAttribute("color").needsUpdate = true;
    },
  };
}

// Shock rings: a flat ring of light that races out from a ship going up and fades.
export function makeRings(scene: THREE.Scene, max = 12) {
  const geo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
  const pool: { m: THREE.Mesh; t: number; life: number; r: number }[] = [];
  for (let i = 0; i < max; i++) {
    const m = new THREE.Mesh(geo, glowMat(0xffc888, 0));
    m.visible = false;
    (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
    scene.add(m);
    pool.push({ m, t: 0, life: 0, r: 0 });
  }
  return {
    add(x: number, y: number, z: number, r: number, life = 1.2) {
      const p = pool.find((q) => !q.m.visible) ?? pool[0]!;
      p.m.position.set(x, y, z);
      p.m.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
      p.t = 0; p.life = life; p.r = r; p.m.visible = true;
    },
    step(dt: number) {
      for (const p of pool) {
        if (!p.m.visible) continue;
        const f = (p.t += dt) / p.life;
        if (f >= 1) { p.m.visible = false; continue; }
        p.m.scale.setScalar(p.r * (1 - (1 - f) ** 3));
        (p.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      }
    },
  };
}
