// The code city: a mode of the game (play.html#c/<name>). Someone's public repos
// are districts and their files are buildings (city.ts lays them out): height is
// line count, orange windows are lines that landed lately, white stone is people's
// code and black glass is agents'. Kamino's clean white halls out in Blade Runner's
// rain, at blue hour. Whoever has one of its files open walks the streets, and the
// owner and their followers can walk them together (a GameRoom, "c/<name>").
// A file's kind picks its architecture (code is a tower, docs a hall, config the
// works, tests a lab, markup a round tower) and its path seeds the details, so a
// building looks the same to everyone. The traffic, the crowds under umbrellas,
// the code-birds and the blimp are only for the look of the place.
import * as THREE from "three";

const name = decodeURIComponent(location.hash.slice(3).split("?")[0] ?? "");
const API = `/api/users/${encodeURIComponent(name)}/city`;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (k, w) => `${k.toLocaleString()} ${w}${k === 1 ? "" : "s"}`;
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
addEventListener("hashchange", () => location.reload());

// ---- the page: the backrooms' panels make way for the city's ---------------------
for (const id of ["lobby", "lock", "over", "tr", "bl", "press", "banner", "hurt", "cross"]) $(`#${id}`).hidden = true;
document.title = `codeSplitter: @${name}'s code city`;
document.body.insertAdjacentHTML("beforeend", `
<div class="hud" id="city-what" hidden></div>
<div class="hud" id="city-cross" hidden></div>
<div class="panel" id="city-gate" style="background:transparent;backdrop-filter:none;place-items:end center;padding-bottom:9vh"><div class="card">
  <div class="label">code city</div><h1>@${esc(name)}</h1>
  <p class="muted" id="city-sum" style="margin:6px 0 0">…</p>
  <div class="legend"><span><i class="stone"></i>people's lines</span><span><i class="glass"></i>agents' lines</span><span><i class="lit"></i>lines landed lately</span></div>
  <div class="row"><button class="primary" id="city-walk">walk in</button><a class="btn" id="city-card" target="_blank" rel="noopener">postcard</a><span class="muted" id="city-msg"></span></div>
  <div class="keys"><kbd>WASD</kbd> walk · <kbd>mouse</kbd> look · <kbd>shift</kbd> run · <kbd>esc</kbd> back up to the skyline<br>a district per public repo, a building per file: tall is long, lit is lately</div>
  <p class="exits"><a href="/#/u/${encodeURIComponent(name)}">← @${esc(name)}'s profile</a></p>
</div></div>`);
$("#title").textContent = `@${name}'s city`;
$("#city-card").href = `${API}.png`;

// ---- three: blue hour, wet streets, rain ----------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $("#c"), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const HAZE = new THREE.Color("#aab3bb");
scene.background = HAZE;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight("#c9d6e2", "#3b4148", 1.5));
const sun = new THREE.DirectionalLight("#ffc79a", 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const label = (text, color = "#0a0a0a", bg = "rgba(255,255,255,.92)") => {
  const t = canvasTex(512, 64, (g, w, h) => {
    g.font = "500 30px 'Geist Mono', ui-monospace, monospace";
    const tw = Math.min(w - 8, g.measureText(text).width + 28);
    g.fillStyle = bg; g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, 48, 8); g.fill();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, 33, w - 36);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4, 0.5, 1);
  return s;
};

// A seeded hand: the same path draws the same building for everyone.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const rng = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

// ---- kits: every small thing is one instanced mesh per kind --------------------------
const kits = new Map();
const kit = (key, geo, mat, { shadow = true } = {}) => kits.set(key, { geo, mat, shadow, list: [] });
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const place = (m, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
/** One of a kit at x, y, z (its centre), scaled and turned; color tints that one. */
const put = (key, x, y, z, sx, sy, sz, ry, color, rx, rz) => kits.get(key).list.push({ m: place(new THREE.Matrix4(), x, y, z, sx, sy, sz, ry, rx, rz), color });
function buildKits() {
  for (const k of kits.values()) {
    if (!k.list.length) continue;
    const im = new THREE.InstancedMesh(k.geo, k.mat, k.list.length);
    k.list.forEach((p, i) => { im.setMatrixAt(i, p.m); if (p.color) im.setColorAt(i, new THREE.Color(p.color)); });
    if (k.list.some((p) => p.color) && im.instanceColor) for (let i = 0; i < k.list.length; i++) if (!k.list[i].color) im.setColorAt(i, new THREE.Color("#ffffff"));
    im.castShadow = k.shadow; im.receiveShadow = true;
    scene.add(im);
  }
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const glow = (color) => new THREE.MeshBasicMaterial({ color });
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14), BALL = new THREE.SphereGeometry(0.5, 14, 10);
const DOME = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), CONE = new THREE.ConeGeometry(0.5, 1, 14);
const GABLE = (() => { const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g; })();
const TREE = new THREE.IcosahedronGeometry(0.5, 1);
const WHITE = std("#f4f5f5", { roughness: 0.5 }), METAL = std("#2c3238", { roughness: 0.35, metalness: 0.7 }), GREY = std("#9aa2a8", { roughness: 0.7 });
kit("white", BOX, WHITE); kit("metal", BOX, METAL); kit("grey", BOX, GREY); kit("tint", BOX, std("#ffffff", { roughness: 0.55 }));
kit("cyl", CYL, WHITE); kit("cylMetal", CYL, METAL); kit("cylTint", CYL, std("#ffffff", { roughness: 0.5 }));
kit("dome", DOME, std("#1d2328", { roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.85 }));
kit("cone", CONE, WHITE); kit("gable", GABLE, std("#3a4148", { roughness: 0.5, metalness: 0.3 }));
kit("leaf", TREE, std("#ffffff", { roughness: 0.85, flatShading: true }));
kit("grass", BOX, std("#7f9a82", { roughness: 0.95 }));
kit("water", CYL, std("#5d7686", { roughness: 0.05, metalness: 0.4 }));
kit("lamp", BALL, glow("#ffe2b3"), { shadow: false });
kit("redLight", BALL, glow("#ff2a1a"), { shadow: false });
kit("orange", BOX, glow("#e8590c"), { shadow: false });
kit("go", BOX, glow("#41d17a"), { shadow: false });
kit("paint", BOX, std("#e9ecee", { roughness: 0.8 }), { shadow: false });
kit("skyline", BOX, std("#59626b", { roughness: 0.9 }), { shadow: false });
kit("panel", BOX, std("#24303b", { roughness: 0.15, metalness: 0.6 }));
const pool = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,190,120,.9)"); r.addColorStop(1, "rgba(255,190,120,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
kit("pool", new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }), { shadow: false });

// ---- facades: 8 bays by 8 storeys a tile, some windows lit, drawn once per style ------
const STOREY = 1.2, BAY = 0.55;
const STYLES = {
  // where each window sits in its 32px bay: x, y, w, h
  grid: [8, 8, 16, 16], ribbon: [0, 10, 32, 12], curtain: [2, 2, 28, 28], tall: [10, 3, 12, 26], shop: [2, 6, 28, 24],
};
const facades = new Map();
function facade(style, glassy, v) {
  const key = `${style}/${glassy}/${v}`;
  if (facades.has(key)) return facades.get(key);
  const r = rng(hash(key)), [wx, wy, ww, wh] = STYLES[style];
  const lit = Array.from({ length: 64 }, () => (style === "shop" ? 0.85 : 0.3) > r() ? 0.45 + r() * 0.55 : 0);
  const draw = (emit) => (g, w, h) => {
    g.fillStyle = emit ? "#000" : glassy ? "#171b1f" : "#f2f3f3"; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * 32, y = j * 32, l = lit[j * 8 + i];
      if (!emit && !glassy) { g.strokeStyle = "rgba(90,100,108,.18)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 31, 31); }
      if (emit) { if (l) { const c = Math.round(l * 255); g.fillStyle = `rgb(${c},${c},${c})`; g.fillRect(x + wx, y + wy, ww, wh); } continue; }
      g.fillStyle = l ? "#e9d9bd" : glassy ? "#2a3239" : "#46525c"; g.fillRect(x + wx, y + wy, ww, wh);
      if (glassy) { g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(x + wx, y + wy, ww / 3, wh); }
      if (style === "curtain" || style === "shop") { g.fillStyle = glassy ? "#0c0f12" : "#d9dcde"; g.fillRect(x + 15, y + wy, 2, wh); }
      if (style === "grid" && !glassy) { g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x + wx, y + wy + wh, ww, 2); }
    }
  };
  const out = { map: canvasTex(256, 256, draw(false)), emissiveMap: canvasTex(256, 256, draw(true)) };
  for (const t of Object.values(out)) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  facades.set(key, out);
  return out;
}
const WARM = new THREE.Color("#ffd29a"), ORANGE = new THREE.Color("#ff5a0a");
/** A facade material for a piece fw wide (round: its girth) and fh tall, its windows warm, and orange as lines land. */
function facadeMat(b, style, glassy, fw, fh, v) {
  const f = facade(style, glassy, v);
  const m = new THREE.MeshStandardMaterial(glassy
    ? { color: "#ffffff", roughness: 0.12, metalness: 0.75 }
    : { color: "#ffffff", roughness: 0.5, metalness: 0.02 });
  for (const k of ["map", "emissiveMap"]) { m[k] = f[k].clone(); m[k].repeat.set(Math.max(0.25, fw / (BAY * 8)), fh / (STOREY * 8)); m[k].needsUpdate = true; }
  m.emissive = WARM.clone().lerp(ORANGE, Math.min(1, b.glow * 1.5));
  m.emissiveIntensity = 0.55 + b.glow * 2.6;
  return m;
}

// ---- the city -------------------------------------------------------------------------
const res = await fetch(API);
const city = await res.json().catch(() => ({ error: "couldn't read the city" }));
if (!res.ok) {
  $("#city-sum").textContent = res.status === 404 ? `@${name} has no public city.` : city.error;
  $("#city-walk").hidden = $("#city-card").hidden = true;
  await new Promise(() => {});
}
const all = city.districts.flatMap((d) => d.buildings.map((b) => ({ ...b, repo: d.repo })));
$("#city-sum").textContent = all.length
  ? `${n(city.districts.length, "district")}, ${n(all.length, "building")}, ${n(city.lines, "line")}${city.present.length ? ` · ${n(city.present.length, "walker")} in town` : ""}${city.public ? "" : " · only you can see it"}`
  : `No public repos to build with yet.`;

// The street grid as city.ts lays it: districts on a square grid of blocks, a street between.
const CELL = 4.2, SIDEWALK = 1.7, CURB = 0.16, LANE = 1.6;
const size = city.districts[0]?.size ?? 10;
const xs = [...new Set(city.districts.map((d) => d.x))].sort((a, b) => a - b), zs = [...new Set(city.districts.map((d) => d.z))].sort((a, b) => a - b);
const STREET = xs.length > 1 ? xs[1] - xs[0] - size : zs.length > 1 ? zs[1] - zs[0] - size : 10;
const roadsX = xs.length ? [...xs.map((x) => x - STREET / 2), xs.at(-1) + size + STREET / 2] : [-size / 2 - STREET / 2, size / 2 + STREET / 2];
const roadsZ = zs.length ? [...zs.map((z) => z - STREET / 2), zs.at(-1) + size + STREET / 2] : [-size / 2 - STREET / 2, size / 2 + STREET / 2];
const [x0, x1, z0, z1] = [roadsX[0], roadsX.at(-1), roadsZ[0], roadsZ.at(-1)];
const extent = Math.max(20, Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1));
const maxH = Math.max(4, ...all.map((b) => b.h));

// The sky: a dome that fades from slate overhead to a sodium glow at the horizon.
const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, map: canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#2f3a46"); gr.addColorStop(0.36, "#6f7f8e"); gr.addColorStop(0.48, "#c9b6a3"); gr.addColorStop(0.52, "#aab3bb"); gr.addColorStop(1, "#7e878f");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}) }));
scene.add(sky);
scene.fog = new THREE.Fog(HAZE, 45, extent * 3.4 + 80);
sun.position.set(-extent * 1.2, extent * 0.9 + 20, extent * 0.7);
const sc = sun.shadow.camera; sc.left = sc.bottom = -extent * 1.5; sc.right = sc.top = extent * 1.5; sc.near = 1; sc.far = extent * 5 + 80; sc.updateProjectionMatrix();

// The ground: wet asphalt for the streets, the country beyond them.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 12, extent * 12), std("#4a5056", { roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
scene.add(ground);
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + STREET, z1 - z0 + STREET), std("#30353a", { roughness: 0.28, metalness: 0.35 }));
asphalt.rotation.x = -Math.PI / 2; asphalt.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); asphalt.receiveShadow = true;
scene.add(asphalt);
const paving = canvasTex(128, 128, (g, w) => { g.fillStyle = "#d4d8da"; g.fillRect(0, 0, w, w); g.strokeStyle = "rgba(60,70,78,.22)"; g.lineWidth = 2; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, w); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } });
paving.wrapS = paving.wrapT = THREE.RepeatWrapping;

// Lane paint: a dashed centre line down every street, zebra crossings at every junction.
const half = STREET / 2;
for (const rx of roadsX) for (let j = 0; j < roadsZ.length - 1; j++) {
  const a = roadsZ[j] + half + 1.6, b = roadsZ[j + 1] - half - 1.6;
  for (let z = a; z < b; z += 2.2) put("paint", rx, 0.01, z + 0.6, 0.12, 0.02, 1.2);
}
for (const rz of roadsZ) for (let i = 0; i < roadsX.length - 1; i++) {
  const a = roadsX[i] + half + 1.6, b = roadsX[i + 1] - half - 1.6;
  for (let x = a; x < b; x += 2.2) put("paint", x + 0.6, 0.01, rz, 1.2, 0.02, 0.12);
}
for (const rx of roadsX) for (const rz of roadsZ) for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
  // A crossing on each arm of the junction, just short of the sidewalks' corners.
  for (let k = -4; k <= 4; k++) {
    if (dz) put("paint", rx + k * 0.6, 0.012, rz + dz * (half - 0.6), 0.32, 0.02, 1.1);
    else put("paint", rx + dx * (half - 0.6), 0.012, rz + k * 0.6, 1.1, 0.02, 0.32);
  }
}
// Traffic lights on two corners of every junction, green for no one in particular.
for (const rx of roadsX) for (const rz of roadsZ) for (const [sx, sz] of [[1, 1], [-1, -1]]) {
  const x = rx + sx * (half - SIDEWALK * 0.35), z = rz + sz * (half - SIDEWALK * 0.35);
  put("cylMetal", x, 1.3, z, 0.09, 2.6, 0.09);
  put("metal", x, 2.45, z, 0.26, 0.7, 0.24);
  put("go", x - sx * 0.13, 2.25, z, 0.05, 0.12, 0.12);
  put("redLight", x, 2.65, z - sz * 0.13, 0.1, 0.1, 0.05);
}

// ---- the blocks: a kerb, a sidewalk, lamps, trees, benches, hydrants -------------------
const kerb = new THREE.LineBasicMaterial({ color: "#e8590c" });
const towers = [], solids = [], lamps = [], blocks = [];
for (const d of city.districts) {
  const cx = d.x + d.size / 2, cz = d.z + d.size / 2, e = d.size / 2 + SIDEWALK;
  blocks.push({ cx, cz, e });
  const p = paving.clone(); p.repeat.set(e * 0.9, e * 0.9); p.needsUpdate = true;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(e * 2, CURB, e * 2), std("#ffffff", { map: p, roughness: 0.75 }));
  slab.position.set(cx, CURB / 2, cz); slab.receiveShadow = true;
  scene.add(slab);
  // The streets' neon: an orange line round every block's kerb.
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-e, -e], [e, -e], [e, e], [-e, e]].map(([x, z]) => new THREE.Vector3(cx + x, CURB + 0.01, cz + z))), kerb));
  const sign = label(d.repo);
  sign.position.set(cx, 1.3, d.z + d.size + SIDEWALK + 0.4);
  scene.add(sign);
  // The district's gate: two white pylons with the repo's name strung between them.
  for (const s of [-1, 1]) { put("white", cx + s * 2.2, 1.1, d.z + d.size + SIDEWALK - 0.3, 0.3, 2.2, 0.3); put("orange", cx + s * 2.2, 2.25, d.z + d.size + SIDEWALK - 0.3, 0.32, 0.06, 0.32); }

  const r = rng(hash(d.repo));
  const along = (fn) => { for (const [ax, az, nx, nz] of [[1, 0, 0, -1], [0, 1, 1, 0], [-1, 0, 0, 1], [0, -1, -1, 0]]) for (let t = -e + 1.4; t <= e - 1.4; t += 2.6) fn(cx + ax * t + nx * (e - 0.35), cz + az * t + nz * (e - 0.35), nx, nz, t); };
  let i = 0;
  along((x, z, nx, nz) => {
    const k = i++ % 4;
    if (k === 0) {
      // A street lamp leaning out over the road, and its pool of light.
      put("cylMetal", x, 1.45, z, 0.08, 2.6, 0.08);
      put("metal", x + nx * 0.35, 2.72, z + nz * 0.35, nx ? 0.8 : 0.06, 0.06, nz ? 0.8 : 0.06);
      put("lamp", x + nx * 0.7, 2.62, z + nz * 0.7, 0.26, 0.14, 0.26);
      put("pool", x + nx * 1.2, 0.02 + CURB * 0.0, z + nz * 1.2, 5.5, 1, 5.5);
      lamps.push([x + nx * 0.7, z + nz * 0.7]);
    } else if (k === 2) {
      // A street tree in its grate.
      put("metal", x, CURB + 0.01, z, 0.9, 0.02, 0.9);
      put("cylTint", x, CURB + 0.6, z, 0.12, 1.2, 0.12, 0, "#5b4a3c");
      const s = 1 + r() * 0.5;
      put("leaf", x, CURB + 1.4 + s * 0.3, z, 1.0 * s, 1.15 * s, 1.0 * s, r() * 6, pick(r, ["#5f7f63", "#6d8a6a", "#4f6e58", "#7a956f"]));
    } else if (r() < 0.45) {
      // Something for the sidewalk: a bench, a bin, a hydrant, a bollard or a newsstand.
      const what = pick(r, ["bench", "bench", "bin", "hydrant", "bollards", "kiosk"]);
      const ry = nx ? Math.PI / 2 : 0;
      if (what === "bench") { put("tint", x - nx * 0.35, CURB + 0.28, z - nz * 0.35, nx ? 0.35 : 1.1, 0.06, nz ? 0.35 : 1.1, 0, "#7b6450"); put("metal", x - nx * 0.5, CURB + 0.45, z - nz * 0.5, nx ? 0.05 : 1.1, 0.3, nz ? 0.05 : 1.1); }
      else if (what === "bin") put("cylMetal", x, CURB + 0.3, z, 0.32, 0.6, 0.32);
      else if (what === "hydrant") { put("cylTint", x, CURB + 0.25, z, 0.2, 0.5, 0.2, 0, "#e8590c"); put("cylTint", x, CURB + 0.52, z, 0.14, 0.1, 0.14, 0, "#c24a0a"); }
      else if (what === "bollards") for (const o of [-0.6, 0, 0.6]) put("cyl", x + (nz ? o : 0), CURB + 0.25, z + (nx ? o : 0), 0.14, 0.5, 0.14);
      else { put("tint", x - nx * 0.3, CURB + 0.6, z - nz * 0.3, 0.8, 1.2, 0.6, ry, "#1e2328"); put("orange", x - nx * 0.3, CURB + 1.24, z - nz * 0.3, 0.9, 0.06, 0.7, ry); }
    }
  });

  // Empty cells of the district's grid are pocket parks: grass, a tree or a fountain, a bench.
  const k = Math.max(1, Math.ceil(Math.sqrt(d.buildings.length))), pad = (d.size - k * CELL) / 2;
  for (let j = d.buildings.length; j < k * k; j++) {
    const px = d.x + pad + (j % k) * CELL + CELL / 2, pz = d.z + pad + Math.floor(j / k) * CELL + CELL / 2;
    put("grass", px, CURB + 0.04, pz, CELL - 0.9, 0.08, CELL - 0.9);
    if (r() < 0.5) {
      put("cyl", px, CURB + 0.2, pz, 1.8, 0.3, 1.8); put("water", px, CURB + 0.3, pz, 1.6, 0.06, 1.6);
      put("cyl", px, CURB + 0.65, pz, 0.18, 0.9, 0.18); put("cyl", px, CURB + 1.1, pz, 0.6, 0.06, 0.6);
    } else for (const [ox, oz] of [[-0.8, -0.7], [0.9, 0.6], [-0.5, 0.9]]) {
      const s = 0.8 + r() * 0.5;
      put("cylTint", px + ox, CURB + 0.5, pz + oz, 0.1, 1, 0.1, 0, "#5b4a3c");
      put("leaf", px + ox, CURB + 1.2 + s * 0.3, pz + oz, 1.1 * s, 1.3 * s, 1.1 * s, r() * 6, pick(r, ["#5f7f63", "#6d8a6a", "#4f6e58"]));
    }
    put("tint", px, CURB + 0.28, pz + CELL / 2 - 0.7, 1.1, 0.06, 0.35, 0, "#7b6450");
  }
  for (const b of d.buildings) raise(b, d.repo, rng(hash(`${d.repo}/${b.path}`)));
}

/** What a file's building is: code is a tower, docs a hall, config the works, tests a lab, markup a round tower. */
function kindOf(path) {
  const base = path.split("/").pop().toLowerCase(), ext = base.includes(".") ? base.split(".").pop() : "";
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(path) || /\.(test|spec)\./.test(base)) return "lab";
  if (["md", "mdx", "txt", "rst", "adoc"].includes(ext) || /^(readme|license|changelog|notice|authors)/.test(base)) return "hall";
  if (["json", "jsonc", "yml", "yaml", "toml", "lock", "ini", "cfg", "conf", "xml", "csv", "env", "sh", "zsh", "bash", "ps1", "sql", "gradle", "mk"].includes(ext) || /^(makefile|dockerfile|procfile)/.test(base)) return "works";
  if (["html", "htm", "css", "scss", "sass", "less", "svg", "vue", "svelte", "astro"].includes(ext)) return "round";
  return "tower";
}

/** Raise one file's building: a lit shopfront at street level, then its body by kind, then its roof. */
function raise(b, repo, r) {
  const kind = kindOf(b.path), glassy = b.agent >= 0.5, v = Math.floor(r() * 3);
  const info = { ...b, repo, kind }, y0 = CURB, H = Math.max(0.8, b.h), w = b.w;
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData = info; scene.add(m); towers.push(m); return m; };
  solids.push({ x: b.x, z: b.z, r: w / 2 + 0.2 });
  const body = glassy ? "curtain" : kind === "works" ? "ribbon" : kind === "hall" ? "tall" : pick(r, ["grid", "grid", "ribbon"]);
  const roofCol = glassy ? "#2a3036" : "#dfe2e4";
  const face = pick(r, [[0, 1], [1, 0], [0, -1], [-1, 0]]);
  let top = y0, tw = w;

  // Street level: a storey of shop glass under an awning, a touch wider than the tower.
  const podium = H > 2.6 && kind !== "hall" && kind !== "round";
  if (podium) {
    const pw = w + 0.3, ph = STOREY;
    mesh(new THREE.BoxGeometry(pw, ph, pw), facadeMat(b, "shop", true, pw, ph, v), b.x, y0 + ph / 2, b.z);
    put("white", b.x, y0 + ph + 0.04, b.z, pw + 0.08, 0.08, pw + 0.08);
    const [fx, fz] = face;
    put("tint", b.x + fx * (pw / 2 + 0.25), y0 + ph * 0.82, b.z + fz * (pw / 2 + 0.25), fx ? 0.5 : pw * 0.8, 0.05, fz ? 0.5 : pw * 0.8, 0, pick(r, ["#e8590c", "#16191c", "#f4f5f5", "#e8590c"]), fz * 0.25, -fx * 0.25);
    top += ph;
  }

  if (kind === "round") {
    // A round tower, banded with balconies, a ring of light at its crown.
    const rad = w / 2, h = H;
    mesh(new THREE.CylinderGeometry(rad, rad, h, 24), facadeMat(b, glassy ? "curtain" : "ribbon", glassy, Math.PI * w, h, v), b.x, top + h / 2, b.z);
    for (let y = top + STOREY * 2; y < top + h - 0.5; y += STOREY * 2) put("cyl", b.x, y, b.z, w + 0.24, 0.06, w + 0.24);
    top += h;
    put("cyl", b.x, top + 0.06, b.z, w + 0.1, 0.12, w + 0.1);
    if (r() < 0.5) put("dome", b.x, top + 0.1, b.z, w * 0.8, w * 0.5, w * 0.8);
    else put("cylMetal", b.x, top + 0.5, b.z, w * 0.5, 0.9, w * 0.5);
  } else if (kind === "hall") {
    // A hall of docs: columns along its face, an entablature, a pitched roof.
    const h = Math.max(1.4, H);
    mesh(new THREE.BoxGeometry(w, h, w), facadeMat(b, body, glassy, w, h, v), b.x, top + h / 2, b.z);
    const [fx, fz] = face, ch = Math.min(h, 2.4);
    for (let k = -2; k <= 2; k++) put("cyl", b.x + fx * (w / 2 + 0.3) + (fz ? k * w / 5 : 0), top + ch / 2, b.z + fz * (w / 2 + 0.3) + (fx ? k * w / 5 : 0), 0.16, ch, 0.16);
    put("white", b.x + fx * 0.32, top + ch + 0.08, b.z + fz * 0.32, w + (fx ? 0.64 : 0.2), 0.16, w + (fz ? 0.64 : 0.2));
    for (let s = 0; s < 3; s++) put("white", b.x + fx * (w / 2 + 0.55 + s * 0.12), top + 0.04 + s * 0.06, b.z + fz * (w / 2 + 0.55 + s * 0.12), fx ? 0.14 : w, 0.08 + s * 0.12, fz ? 0.14 : w);
    top += h;
    put("white", b.x, top + 0.05, b.z, w + 0.16, 0.1, w + 0.16);
    put("gable", b.x, top + 0.1, b.z, w + 0.1, Math.min(1.4, w * 0.45), w + 0.1, fx ? 0 : Math.PI / 2);
  } else {
    // A tower in setbacks: the taller it is, the more times it steps in.
    const h = H - (podium ? STOREY : 0);
    const tiers = h > 18 ? [[0.55, 1], [0.3, 0.78], [0.15, 0.56]] : h > 9 ? [[0.68, 1], [0.32, 0.74]] : [[1, 1]];
    for (const [i, [f, s]] of tiers.entries()) {
      const th = h * f; tw = w * s;
      mesh(new THREE.BoxGeometry(tw, th, tw), facadeMat(b, body, glassy, tw, th, v + i), b.x, top + th / 2, b.z);
      // Ledges every few storeys on stone, fins down the faces of glass.
      if (!glassy) for (let y = top + STOREY * 3; y < top + th - 0.4; y += STOREY * 3) put("white", b.x, y, b.z, tw + 0.1, 0.06, tw + 0.1);
      else for (const s of [-1, 1]) for (const o of [-0.3, 0.3]) {
        put("metal", b.x + s * (tw / 2 + 0.03), top + th / 2, b.z + o * tw, 0.06, th, 0.05);
        put("metal", b.x + o * tw, top + th / 2, b.z + s * (tw / 2 + 0.03), 0.05, th, 0.06);
      }
      top += th;
      put("tint", b.x, top + 0.07, b.z, tw + 0.12, 0.14, tw + 0.12, 0, roofCol);
    }
    if (kind === "lab") {
      // Tests: an observatory's glass dome, ribbed in white.
      put("dome", b.x, top + 0.14, b.z, tw * 0.9, tw * 0.6, tw * 0.9);
      for (let a = 0; a < 4; a++) put("white", b.x, top + 0.14 + tw * 0.15, b.z, a % 2 ? 0.04 : tw * 0.92, tw * 0.32, a % 2 ? tw * 0.92 : 0.04, a * Math.PI / 4);
    }
  }
  roof(b, r, kind, glassy, top, tw);
  // Lines landing now: a ring of orange light round the roofline.
  if (b.glow > 0.6) for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put("orange", b.x + sx * (tw / 2 + 0.07), top + 0.17, b.z + sz * (tw / 2 + 0.07), sx ? 0.04 : tw + 0.14, 0.05, sz ? 0.04 : tw + 0.14);
  // Up on the tallest towers, a red light for the aircraft.
  if (b.h > 14) put("redLight", b.x, top + (b.h >= maxH - 0.01 ? 4.3 : 1.6), b.z, 0.22, 0.22, 0.22);
}

/** Roof furniture: what a flat top carries, by the kind of building and the luck of its path. */
function roof(b, r, kind, glassy, top, tw) {
  if (kind === "hall" || kind === "round" || kind === "lab") return;
  const y = top + 0.14, q = tw / 4;
  if (kind === "works") {
    // The works: tanks with conical caps, pipework, a chimney if it's big.
    for (const o of [-1, 1]) { put("cylTint", b.x + o * q, y + 0.45, b.z - q * 0.6, tw * 0.32, 0.9, tw * 0.32, 0, "#cfd4d7"); put("cone", b.x + o * q, y + 1.05, b.z - q * 0.6, tw * 0.32, 0.3, tw * 0.32); }
    put("cylMetal", b.x, y + 0.2, b.z + q, 0.1, tw * 0.8, 0.1, 0, undefined, 0, Math.PI / 2);
    if (b.h > 6) { put("cylTint", b.x + q, y + 1.6, b.z + q, 0.36, 3.2, 0.36, 0, "#d5d9db"); put("orange", b.x + q, y + 3.0, b.z + q, 0.38, 0.12, 0.38); }
    return;
  }
  if (b.h >= maxH - 0.01 && b.h > 10) {
    // The city's tallest: a spire with an antenna, or a helipad if agents built it.
    if (glassy) {
      put("cylTint", b.x, y + 0.04, b.z, tw * 0.8, 0.08, tw * 0.8, 0, "#2d3339");
      put("paint", b.x - 0.18, y + 0.1, b.z, 0.06, 0.02, 0.5); put("paint", b.x + 0.18, y + 0.1, b.z, 0.06, 0.02, 0.5); put("paint", b.x, y + 0.1, b.z, 0.36, 0.02, 0.06);
      for (let a = 0; a < 8; a++) put("orange", b.x + Math.cos(a * Math.PI / 4) * tw * 0.38, y + 0.1, b.z + Math.sin(a * Math.PI / 4) * tw * 0.38, 0.06, 0.04, 0.06);
      put("cylMetal", b.x + q * 1.4, y + 1.6, b.z + q * 1.4, 0.05, 3.2, 0.05);
    } else {
      put("cone", b.x, y + 1.5, b.z, tw * 0.55, 3, tw * 0.55);
      put("cylMetal", b.x, y + 3.6, b.z, 0.05, 1.6, 0.05);
    }
    return;
  }
  // Everyone else: air-con units, a water tank on stone, solar panels or a roof garden.
  for (let i = 0, k = 1 + Math.floor(r() * 3); i < k; i++) put("grey", b.x + (r() - 0.5) * tw * 0.6, y + 0.18, b.z + (r() - 0.5) * tw * 0.6, 0.38, 0.36, 0.3, r() * 3);
  const extra = r();
  if (!glassy && extra < 0.35) {
    const x = b.x + q, z = b.z + q;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put("cylMetal", x + lx * 0.16, y + 0.3, z + lz * 0.16, 0.04, 0.6, 0.04);
    put("cylTint", x, y + 0.9, z, 0.55, 0.6, 0.55, 0, "#8b6f55"); put("cone", x, y + 1.32, z, 0.6, 0.24, 0.6);
  } else if (extra < 0.6) {
    for (let i = -1; i <= 1; i++) put("panel", b.x + i * q * 0.9, y + 0.2, b.z - q * 0.4, q * 0.8, 0.04, tw * 0.35, 0, undefined, -0.4);
  } else if (extra < 0.8) {
    put("grass", b.x, y + 0.05, b.z, tw * 0.7, 0.1, tw * 0.7);
    put("leaf", b.x - q, y + 0.35, b.z + q, 0.6, 0.6, 0.6, 0, "#6d8a6a"); put("leaf", b.x + q * 0.6, y + 0.3, b.z - q * 0.5, 0.5, 0.5, 0.5, 0, "#5f7f63");
  }
  if (r() < 0.3) put("cylMetal", b.x - q, y + 0.9, b.z - q, 0.04, 1.8, 0.04);
}

// Signs on the four tallest towers' roofs: each file's name in orange on black, so the skyline reads.
for (const b of all.filter((b) => kindOf(b.path) === "tower" && b.h >= 6).sort((a, b) => b.h - a.h).slice(0, 4)) {
  const file = b.path.split("/").pop();
  const t = canvasTex(512, 128, (g, w, h) => { g.fillStyle = "#0d0f11"; g.fillRect(0, 0, w, h); g.font = "600 56px 'Geist Mono', ui-monospace, monospace"; g.fillStyle = "#ff6a1a"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(file, w / 2, h / 2, w - 30); });
  const tower = towers.filter((m) => m.userData.path === b.path && m.userData.repo === b.repo).at(-1);
  const top = tower.position.y + tower.geometry.parameters.height / 2, tw = tower.geometry.parameters.width ?? b.w;
  const s = new THREE.Mesh(new THREE.PlaneGeometry(tw * 1.1, tw * 0.28), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false }));
  s.position.set(b.x, top + 0.75 + tw * 0.14, b.z + tw * 0.42);
  scene.add(s);
  for (const o of [-0.4, 0.4]) put("cylMetal", b.x + o * tw, top + 0.5, b.z + tw * 0.42, 0.05, 1.0, 0.05);
}

// The rest of the world, far off in the haze: a ring of other people's towers.
{
  const r = rng(hash(name));
  for (let i = 0; i < 220; i++) {
    const a = r() * Math.PI * 2, d = extent * 2.4 + 30 + r() * (extent * 2 + 120), h = 4 + r() ** 2 * 50, s = 4 + r() * 8;
    put("skyline", Math.cos(a) * d, h / 2, Math.sin(a) * d, s, h, s * (0.6 + r() * 0.8), r() * 3);
  }
}
buildKits();

// ---- traffic: cars along both lanes of every street -------------------------------------
const car = {
  body: new THREE.BoxGeometry(0.9, 0.42, 1.9).translate(0, 0.33, 0),
  cabin: new THREE.BoxGeometry(0.78, 0.34, 0.95).translate(0, 0.71, -0.1),
  head: new THREE.BoxGeometry(0.74, 0.1, 0.04).translate(0, 0.42, 0.96),
  tail: new THREE.BoxGeometry(0.74, 0.08, 0.04).translate(0, 0.45, -0.96),
};
const lanes = [];
for (const rx of roadsX) { lanes.push({ x: rx + LANE, dir: 1, axis: "z", from: z0 - half, len: z1 - z0 + STREET }); lanes.push({ x: rx - LANE, dir: -1, axis: "z", from: z0 - half, len: z1 - z0 + STREET }); }
for (const rz of roadsZ) { lanes.push({ z: rz - LANE, dir: 1, axis: "x", from: x0 - half, len: x1 - x0 + STREET }); lanes.push({ z: rz + LANE, dir: -1, axis: "x", from: x0 - half, len: x1 - x0 + STREET }); }
const cars = [];
{
  const r = rng(hash(`${name}/traffic`));
  for (const l of lanes) for (let k = 0, m = Math.max(1, Math.round(l.len / 14)); k < m; k++) cars.push({ l, t: (k + r() * 0.6) / m, speed: 4 + r() * 4, color: pick(r, ["#f4f5f5", "#f4f5f5", "#16191c", "#16191c", "#8e979e", "#e8590c", "#5a6670"]) });
}
const carMeshes = [[car.body, std("#ffffff", { roughness: 0.25, metalness: 0.5 })], [car.cabin, std("#14181b", { roughness: 0.1, metalness: 0.8 })], [car.head, glow("#fff1d0")], [car.tail, glow("#ff2a1a")]]
  .map(([g, m]) => { const im = new THREE.InstancedMesh(g, m, Math.max(1, cars.length)); im.count = cars.length; im.castShadow = m instanceof THREE.MeshStandardMaterial; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; });
cars.forEach((c, i) => carMeshes[0].setColorAt(i, new THREE.Color(c.color)));
const _m = new THREE.Matrix4();
function updateCars(dt) {
  for (const [i, c] of cars.entries()) {
    const l = c.l;
    if (!still) c.t = (c.t + (c.speed * dt) / l.len) % 1;
    const d = l.from + (l.dir > 0 ? c.t : 1 - c.t) * l.len;
    if (l.axis === "z") place(_m, l.x, 0, d, 1, 1, 1, l.dir > 0 ? 0 : Math.PI);
    else place(_m, d, 0, l.z, 1, 1, 1, l.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    for (const im of carMeshes) im.setMatrixAt(i, _m);
  }
  for (const im of carMeshes) im.instanceMatrix.needsUpdate = true;
}

// ---- crowds: people walking round the blocks under umbrellas ----------------------------
const people = [];
{
  const r = rng(hash(`${name}/people`));
  for (const b of blocks) for (let k = 0; k < 9; k++) people.push({ b, t: r() * 4, off: 0.55 + r() * 0.7, speed: (0.025 + r() * 0.03) * (r() < 0.5 ? -1 : 1), coat: pick(r, ["#16191c", "#2e3439", "#f4f5f5", "#6b7680", "#8a5a3c"]), brolly: pick(r, ["#16191c", "#16191c", "#f4f5f5", "#e8590c", "#3a4148"]), bob: r() * 6 });
}
const crowd = [
  [new THREE.CapsuleGeometry(0.14, 0.42, 3, 8).translate(0, 0.38, 0), std("#ffffff", { roughness: 0.8 }), "coat"],
  [new THREE.SphereGeometry(0.1, 10, 8).translate(0, 0.78, 0), std("#d8b59a", { roughness: 0.8 }), null],
  [new THREE.ConeGeometry(0.42, 0.18, 10).translate(0, 1.06, 0), std("#ffffff", { roughness: 0.4 }), "brolly"],
].map(([g, m, col]) => {
  const im = new THREE.InstancedMesh(g, m, Math.max(1, people.length)); im.count = people.length; im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (col) people.forEach((p, i) => im.setColorAt(i, new THREE.Color(p[col])));
  scene.add(im); return im;
});
function updatePeople(dt, time) {
  for (const [i, p] of people.entries()) {
    if (!still) p.t = (p.t + p.speed * dt + 4) % 4;
    const side = Math.floor(p.t), f = p.t - side, e = p.b.e - p.off, a = -e + 2 * e * f;
    const [x, z, ry] = side === 0 ? [p.b.cx + a, p.b.cz - e, Math.PI / 2] : side === 1 ? [p.b.cx + e, p.b.cz + a, 0] : side === 2 ? [p.b.cx - a, p.b.cz + e, -Math.PI / 2] : [p.b.cx - e, p.b.cz - a, Math.PI];
    place(_m, x, CURB + (still ? 0 : Math.abs(Math.sin(time * 7 + p.bob)) * 0.03), z, 1, 1, 1, ry + (p.speed < 0 ? Math.PI : 0));
    for (const im of crowd) im.setMatrixAt(i, _m);
  }
  for (const im of crowd) im.instanceMatrix.needsUpdate = true;
}

// ---- the sky over it: code-birds round the tallest tower, and a blimp with the owner's name
const tallest = all.reduce((a, b) => (b.h > (a?.h ?? -1) ? b : a), null);
const wing = new THREE.BufferGeometry();
wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.12, -0.55, 0, -0.08, 0, 0, -0.14], 3));
wing.computeVertexNormals();
const birds = Array.from({ length: still ? 0 : 36 }, (_, i) => ({ r: 3 + (i % 9) * 0.8, a: i * 0.9, y: (i % 5) * 0.7, speed: 0.35 + (i % 7) * 0.04, flap: i }));
const wings = [1, -1].map(() => { const im = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: "#16191c", side: THREE.DoubleSide }), Math.max(1, birds.length)); im.count = birds.length; scene.add(im); return im; });
const _w = new THREE.Matrix4();
function updateBirds(time) {
  if (!birds.length) return;
  const cx = tallest?.x ?? 0, cz = tallest?.z ?? 0, cy = (tallest?.h ?? 8) + 5;
  for (const [i, b] of birds.entries()) {
    const a = b.a + time * b.speed, flap = Math.sin(time * 11 + b.flap) * 0.6;
    place(_m, cx + Math.cos(a) * b.r, cy + b.y + Math.sin(time + i) * 0.4, cz + Math.sin(a) * b.r, 1, 1, 1, -a);
    wings[0].setMatrixAt(i, _w.multiplyMatrices(_m, place(new THREE.Matrix4(), 0, 0, 0, 1, 1, 1, 0, 0, flap)));
    wings[1].setMatrixAt(i, _w.multiplyMatrices(_m, place(new THREE.Matrix4(), 0, 0, 0, -1, 1, 1, 0, 0, -flap)));
  }
  for (const im of wings) im.instanceMatrix.needsUpdate = true;
}
const blimp = new THREE.Group();
{
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), std("#eceeef", { roughness: 0.4 }));
  hull.scale.set(1.6, 1.6, 5); hull.castShadow = true;
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.6), std("#16191c", { roughness: 0.3, metalness: 0.6 }));
  gondola.position.y = -1.65;
  blimp.add(hull, gondola);
  for (const [rz, sx, sy] of [[0, 0.08, 1.4], [Math.PI / 2, 0.08, 1.4]]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(sx, sy * 2, 1.4), std("#e8590c")); fin.rotation.z = rz; fin.position.z = -4.3; blimp.add(fin); }
  const t = canvasTex(1024, 192, (g, w, h) => { g.font = "600 110px 'Geist', system-ui, sans-serif"; g.fillStyle = "#e8590c"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(`@${name}`, w / 2, h / 2, w - 40); });
  for (const s of [-1, 1]) { const banner = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false })); banner.position.x = s * 1.62; banner.rotation.y = s * Math.PI / 2; blimp.add(banner); }
  const nav = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow("#ff2a1a")); nav.position.set(0, -1.9, 0.6); blimp.add(nav);
  scene.add(blimp);
}
function updateBlimp(time) {
  const a = (still ? 1 : time * 0.03), r = extent * 0.85 + 6;
  blimp.position.set(Math.cos(a) * r, maxH + 9 + Math.sin(time * 0.4) * 0.6, Math.sin(a) * r);
  blimp.rotation.y = -a;
}

// ---- rain ---------------------------------------------------------------------------------
const DROPS = still ? 0 : 2600, rainPos = new Float32Array(DROPS * 6);
const rain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#a9b4bc", transparent: true, opacity: 0.4 }));
rain.geometry.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
rain.frustumCulled = false;
const drop = (i, y = Math.random() * 60) => {
  const x = (Math.random() - 0.5) * 120, z = (Math.random() - 0.5) * 120;
  rainPos.set([x, y, z, x + 0.05, y + 0.7, z], i * 6);
};
for (let i = 0; i < DROPS; i++) drop(i);
if (DROPS) scene.add(rain);
function updateRain(dt) {
  if (!DROPS) return;
  rain.position.set(camera.position.x, 0, camera.position.z);
  for (let i = 0; i < DROPS; i++) {
    const o = i * 6;
    rainPos[o + 1] -= 38 * dt; rainPos[o + 4] -= 38 * dt;
    if (rainPos[o + 1] < 0) drop(i, 50 + Math.random() * 10);
  }
  rain.geometry.attributes.position.needsUpdate = true;
}
// The aircraft lights blink together, once every two seconds.
const red = kits.get("redLight").mat;
const blink = (time) => red.color.setHex(still || time % 2 < 1 ? 0xff2a1a : 0x3a0a06);

// ---- walkers: who landed lines lately, and the visitors here with you ------------------
function avatar(who, agent) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: agent ? "#16191c" : "#f4f4f2", roughness: 0.4, metalness: agent ? 0.6 : 0 }));
  body.position.y = 0.75; body.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: "#e8590c" }));
  visor.position.set(0, 1.25, -0.24);
  const tag = label(`@${who}`, agent ? "#ffffff" : "#e8590c", agent ? "rgba(10,10,10,.85)" : "rgba(255,255,255,.92)");
  tag.scale.set(3, 0.38, 1); tag.position.y = 2;
  g.add(body, visor, tag);
  scene.add(g);
  return g;
}
const footOf = (repo, path) => city.districts.find((d) => d.repo === repo)?.buildings.find((b) => b.path === path);
const walkers = city.present.map((p, i) => {
  const at = footOf(p.repo, p.path) ?? all[i % Math.max(1, all.length)];
  const g = avatar(p.who, p.who.startsWith("agent-"));
  return { g, cx: at ? at.x : 0, cz: at ? at.z : 0, r: (at?.w ?? 2.6) / 2 + 0.6 + (i % 3) * 0.15, phase: i * 1.7, speed: 0.25 + (i % 4) * 0.05 };
});
function updateWalkers(time) {
  for (const w of walkers) {
    // A slow lap of the building they have open.
    const a = w.phase + (still ? 0 : time * w.speed);
    w.g.position.set(w.cx + Math.cos(a) * w.r, CURB, w.cz + Math.sin(a) * w.r);
    w.g.rotation.y = -a;
  }
}
const visitors = new Map();
let ws = null, me = null;
if (city.visit) {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/ws`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "lobby") {
      me = m.you;
      for (const id of visitors.keys()) if (!m.players.some((p) => p.id === id)) { scene.remove(visitors.get(id).g); visitors.delete(id); }
      const here = m.players.filter((p) => p.id !== me).map((p) => `@${p.user}`);
      $("#city-msg").textContent = here.length ? `here with you: ${here.join(", ")}` : "";
    } else if (m.t === "pos") {
      let v = visitors.get(m.id);
      if (!v) { v = { g: avatar(m.user, m.user.startsWith("agent-")), to: new THREE.Vector3() }; visitors.set(m.id, v); }
      v.to.set(m.p[0], m.p[1] ?? 0, m.p[2]); v.yaw = m.yaw; v.seen = performance.now();
    }
  };
  ws.onclose = () => { ws = null; };
} else $("#city-msg").textContent = "follow them to walk it with others";
function updateVisitors(dt) {
  for (const v of visitors.values()) {
    v.g.visible = performance.now() - v.seen < 5000;
    v.g.position.lerp(v.to, Math.min(1, dt * 10));
    v.g.rotation.y = v.yaw;
  }
}

// ---- looking and walking ----------------------------------------------------------------
// Up on the skyline the camera circles the city; walk in and you're on the street.
const EYE = 1.7, keys = new Set();
const player = { pos: new THREE.Vector3(0, EYE, z1 + 2), yaw: 0, pitch: 0 };
let walking = false, lastSent = 0;
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
addEventListener("mousemove", (e) => {
  if (!walking) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - e.movementY * 0.0022));
});
$("#city-walk").addEventListener("click", () => renderer.domElement.requestPointerLock?.()?.catch?.(() => {}));
document.addEventListener("pointerlockchange", () => {
  walking = document.pointerLockElement === renderer.domElement;
  $("#city-gate").hidden = walking;
  $("#city-cross").hidden = !walking;
  if (!walking) $("#city-what").hidden = true;
});

function collide() {
  // Buildings are solid: step back out of any you walk into.
  for (const { x, z, r: s } of solids) {
    const r = s + 0.3, dx = player.pos.x - x, dz = player.pos.z - z;
    if (Math.abs(dx) < r && Math.abs(dz) < r) {
      if (r - Math.abs(dx) < r - Math.abs(dz)) player.pos.x = x + Math.sign(dx || 1) * r;
      else player.pos.z = z + Math.sign(dz || 1) * r;
    }
  }
}
// Up on a block you stand on its sidewalk; down in the street, on the asphalt.
const onBlock = (x, z) => blocks.some((b) => Math.abs(x - b.cx) < b.e && Math.abs(z - b.cz) < b.e);
const ray = new THREE.Raycaster(), mid = new THREE.Vector2();
function updateWalk(dt, now) {
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 11 : 5.5;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const move = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
  if (move.lengthSq() > 1) move.normalize();
  player.pos.addScaledVector(move, speed * dt);
  const edge = extent * 2.5;
  player.pos.x = Math.max(-edge, Math.min(edge, player.pos.x)); player.pos.z = Math.max(-edge, Math.min(edge, player.pos.z));
  collide();
  const floor = onBlock(player.pos.x, player.pos.z) ? CURB : 0;
  player.pos.y += (EYE + floor - player.pos.y) * Math.min(1, dt * 14);
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (ws?.readyState === 1 && now - lastSent > 100) { lastSent = now; ws.send(JSON.stringify({ t: "pos", p: [player.pos.x, floor, player.pos.z], yaw: player.yaw })); }
  // What you're looking at: its file, its lines, and when lines last landed in it.
  ray.setFromCamera(mid, camera);
  const hit = ray.intersectObjects(towers, false)[0];
  const what = $("#city-what");
  if (hit && hit.distance < 40) {
    const b = hit.object.userData;
    what.innerHTML = `<b>${esc(b.repo)}/${esc(b.path)}</b><br>${n(b.lines, "line")} · ${b.agent >= 0.5 ? "mostly agents'" : b.agent > 0 ? "people's, agents helped" : "people's"}${b.last ? ` · last lines ${ago(b.last)}` : ""}`;
    what.hidden = false;
  } else what.hidden = true;
}
function updateSkyline(time) {
  const r = extent * 1.55 + 8, a = still ? 0.8 : time * 0.035;
  camera.position.set(Math.cos(a) * r, extent * 0.55 + maxH * 0.6, Math.sin(a) * r);
  camera.lookAt(0, maxH * 0.25, 0);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000), time = now / 1000;
  prev = now;
  if (walking) updateWalk(dt, now); else updateSkyline(time);
  updateWalkers(time);
  updateVisitors(dt);
  updateCars(dt);
  updatePeople(dt, time);
  updateBirds(time);
  updateBlimp(time);
  updateRain(dt);
  blink(time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
