// The code city: a mode of the game (play.html#c/<name>). Someone's public repos
// are districts and their files are buildings (city.ts lays them out): height is
// line count, orange windows are lines that landed lately, white stone is people's
// code and black glass is agents'. Kamino's clean white halls out in Blade Runner's
// rain, at blue hour. Whoever has one of its files open walks the streets, and the
// owner and their followers can walk them together (a GameRoom, "c/<name>").
// A file's kind picks its architecture (code is a tower, docs a hall, config the
// works, tests a lab, markup a round tower) and its path seeds the details, so a
// building looks the same to everyone. The streets run on each district's pulse
// (city.ts): a week of commits and edits fills its sidewalks, crosswalks and bike
// lanes, and failing checks bring chaos: drivers brake-check, stall and run reds,
// bikes wobble, people jaywalk, and the signals go out to blinking amber. The
// code-birds and the blimp are only for the look of the place.
import * as THREE from "three";
import { PARTS, defaultAvatar, drawFace } from "/avatar.js";

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
  <div class="keys"><kbd>WASD</kbd> walk · <kbd>mouse</kbd> look · <kbd>shift</kbd> run · <kbd>space</kbd> jump · <kbd>esc</kbd> back up to the skyline<br>a district per public repo, a building per file: tall is long, lit is lately<br>busy streets are a week of commits; traffic chaos is failing checks</div>
  <p class="exits"><a href="/#/u/${encodeURIComponent(name)}">← @${esc(name)}'s profile</a></p>
</div></div>`);
$("#title").textContent = `@${name}'s city`;
$("#city-card").href = `${API}.png`;

// ---- three: blue hour, wet streets, rain ----------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $("#c"), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const HAZE = new THREE.Color("#0a0e16");
scene.background = HAZE;
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 2000);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight("#4a5a90", "#1c1630", 1.5));
// Neon spill from either side of the city: magenta one way, cyan the other.
for (const [c, x] of [["#ff2f9a", -1], ["#19d3ff", 1]]) { const l = new THREE.DirectionalLight(c, 0.8); l.position.set(x * 80, 14, -x * 30); scene.add(l); }
const sun = new THREE.DirectionalLight("#8fa8e8", 1.6);
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
const CAP_ARM = new THREE.CapsuleGeometry(0.06, 0.28, 3, 8).translate(0, -0.1, 0);
const TORSO = new THREE.SphereGeometry(0.5, 14, 10);
const SKIRT = new THREE.CylinderGeometry(0.35, 0.5, 1, 14);
const PLANE = new THREE.PlaneGeometry(1, 1);
const WHITE = std("#f4f5f5", { roughness: 0.5 }), METAL = std("#2c3238", { roughness: 0.35, metalness: 0.7 }), GREY = std("#9aa2a8", { roughness: 0.7 });
kit("white", BOX, WHITE); kit("metal", BOX, METAL); kit("grey", BOX, GREY); kit("tint", BOX, std("#ffffff", { roughness: 0.55 }));
kit("cyl", CYL, WHITE); kit("cylMetal", CYL, METAL); kit("cylTint", CYL, std("#ffffff", { roughness: 0.5 }));
kit("dome", DOME, std("#1d2328", { roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.85 }));
kit("cone", CONE, WHITE); kit("pyramid", new THREE.ConeGeometry(0.5, 1, 4), std("#c9d0d8", { roughness: 0.3, metalness: 0.6 })); kit("gable", GABLE, std("#3a4148", { roughness: 0.5, metalness: 0.3 }));
kit("leaf", TREE, std("#ffffff", { roughness: 0.85, flatShading: true }));
kit("grass", BOX, std("#7f9a82", { roughness: 0.95 }));
kit("water", CYL, std("#5d7686", { roughness: 0.05, metalness: 0.4 }));
kit("lamp", BALL, glow("#ffe2b3"), { shadow: false });
kit("redLight", BALL, glow("#ff2a1a"), { shadow: false });
kit("orange", BOX, glow("#e8590c"), { shadow: false });
kit("paint", BOX, std("#e9ecee", { roughness: 0.8 }), { shadow: false });
kit("skyline", BOX, std("#59626b", { roughness: 0.9 }), { shadow: false });
kit("panel", BOX, std("#24303b", { roughness: 0.15, metalness: 0.6 }));
kit("bikeLane", BOX, std("#3d6b5b", { roughness: 0.6 }), { shadow: false });
kit("neon", BOX, glow("#f4f5f5"), { shadow: false });
const pool = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, "rgba(255,190,120,.9)"); r.addColorStop(1, "rgba(255,190,120,0)"); g.fillStyle = r; g.fillRect(0, 0, w, w); });
kit("pool", new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }), { shadow: false });

// ---- shopfronts: the ground floor stocks the code as media: books, tapes, records, files --
// Seeded by path; the docs halls favour libraries. Each theme draws its shelves and its sign once.
const SHOPS = {
  books: { sign: "本 BOOKS", neon: "#ff2f9a", spines: ["#7a2e2a", "#2f4a6b", "#c79a3a", "#3d5a40", "#e8e0cc", "#5a3a66"], style: "spines" },
  used: { sign: "古書 USED BOOKS", neon: "#ffe14a", spines: ["#6b4a2c", "#8a6a3c", "#4a3a2a", "#a08a5a", "#37301f"], style: "spines" },
  library: { sign: "LIBRARY", neon: "#41ffb0", spines: ["#2f4a3a", "#5a3a2a", "#3a3a5a", "#7a6a3a", "#2a2a2a"], style: "spines" },
  video: { sign: "HOLLYWOOD BUSTER", neon: "#ffd21a", spines: ["#101214", "#16181b", "#1c1f23"], style: "tapes" },
  comics: { sign: "COMICS", neon: "#ff7a1a", spines: ["#e8302a", "#2a6ae8", "#f4d03a", "#2ac86a", "#ff6aa8", "#ffffff"], style: "spines" },
  records: { sign: "RECORDS", neon: "#8a5cff", spines: ["#d8402a", "#2a8ad8", "#e8c83a", "#f0f0f0", "#3a3a3a", "#9a3ad8"], style: "sleeves" },
  lava: { sign: "LAVA LAMPS", neon: "#ff7a1a", style: "lava" },
  hall: { sign: "役所 CITY HALL", neon: "#e8e0cc", style: "columns" },
  hq: { sign: "CLOUDFLARE HQ", neon: "#ff7a1a", style: "lava" },
  office: { sign: "OFFICE 事務所", neon: "#8fd6ff", spines: ["#5a6670", "#6c7882", "#d9b25a"], style: "cabinets" },
  archive: { sign: "ARCHIVE", neon: "#19d3ff", spines: ["#5a6670", "#6c7882", "#4a545c"], style: "cabinets" },
};
const shopTex = new Map();
// ---- shop interiors: the ground floor is a room, built the first time you come near ------------
// A shop kind names the module that stocks it in city-shops/<module>.js, which exports
// buildInterior(ctx) with ctx = { b, repo, r, pw, ph, y0, put, scene, THREE, door: [fx, fz], lines, path }
// (and kind, for a module that serves several). put() is the kit's put, into that room's own instanced
// meshes; scene is the room's Group. It may return { aisles: [[x, z]..], clerk: [x, z] } (world coords) for
// the shoppers' route and the clerk's post. A kind with no entry here, or a module that fails, gets generic.js.
const SHOP_MODULES = { books: "library", used: "library", library: "library", archive: "library", video: "media", comics: "media", records: "media", lava: "media", hall: "office", hq: "office", office: "office" };
const rooms = [];
// The lava lamps are alive: one shared wall of them, blobs rising and sinking, redrawn a few times a second.
const lava = (() => {
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const tints = [["#ff5a0a", "#ffb020"], ["#ff2f9a", "#ff9ac8"], ["#19d3ff", "#a8f0ff"], ["#8a5cff", "#cbb8ff"], ["#ff7a1a", "#ffd29a"]];
  let last = -1;
  const draw = (time) => {
    if (time - last < 0.05) return; last = time;
    const g = c.getContext("2d"); g.fillStyle = "#120a08"; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 5; i++) {
      const x = 8 + i * 49, [a, b] = tints[i];
      const body = g.createLinearGradient(0, 0, 0, 128); body.addColorStop(0, "#1c0f10"); body.addColorStop(1, a + "55"); g.fillStyle = body;
      g.beginPath(); g.roundRect(x, 8, 34, 112, 14); g.fill();
      for (let k = 0; k < 4; k++) {
        const f = (time * (0.06 + k * 0.018) + i * 0.21 + k * 0.27) % 1, y = 112 - Math.abs(Math.sin(f * Math.PI)) * 96, rad = 6 + (k % 2) * 3 + Math.sin(time * 0.8 + k + i) * 1.5;
        const gr = g.createRadialGradient(x + 17, y, 0, x + 17, y, rad + 4); gr.addColorStop(0, b); gr.addColorStop(0.6, a); gr.addColorStop(1, a + "00"); g.fillStyle = gr;
        g.beginPath(); g.arc(x + 17 + Math.sin(time * 0.5 + k * 2 + i) * 5, y, rad + 4, 0, 7); g.fill();
      }
      g.fillStyle = "#2a2a30"; g.fillRect(x - 2, 4, 38, 6); g.fillRect(x - 2, 118, 38, 8);
    }
    t.needsUpdate = true;
  };
  return { t, draw, mat: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) };
})();
function shopShelves(key) {
  if (shopTex.has(key)) return shopTex.get(key);
  const sh = SHOPS[key], r = rng(hash(key));
  if (sh.style === "lava") { shopTex.set(key, lava.mat); return lava.mat; }
  const t = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = "#1a1208"; g.fillRect(0, 0, w, h);
    const rows = 3, rh = h / rows;
    for (let j = 0; j < rows; j++) {
      const y = j * rh;
      if (sh.style === "columns") {
        if (j === 0) { g.fillStyle = "#2a2a2e"; g.fillRect(0, 0, w, h); g.fillStyle = "#c9c4b4"; for (let i = 0; i < 7; i++) g.fillRect(14 + i * 34, 14, 14, h - 24); g.fillRect(4, 6, w - 8, 10); g.fillStyle = "#e8590c"; g.fillRect(w / 2 - 10, 38, 20, 14); }
        continue;
      }
      if (sh.style === "cabinets") {
        for (let i = 0; i < 8; i++) for (let d = 0; d < 3; d++) { g.fillStyle = pick(r, sh.spines); g.fillRect(i * 32 + 2, y + d * 13 + 3, 28, 11); g.fillStyle = "#e9d9bd"; g.fillRect(i * 32 + 12, y + d * 13 + 7, 8, 2); }
        continue;
      }
      for (let x = 2; x < w - 2;) {
        const sw = sh.style === "sleeves" ? 6 + r() * 3 : sh.style === "tapes" ? 5 + r() * 2 : 3 + r() * 6, hh = sh.style === "sleeves" ? rh - 8 : rh - 6 - r() * 8;
        g.fillStyle = pick(r, sh.spines); g.fillRect(x, y + rh - 3 - hh, sw, hh);
        if (sh.style === "tapes") { g.fillStyle = pick(r, ["#f4f5f5", "#e8590c", "#19d3ff", "#ff2f9a"]); g.fillRect(x + 1, y + rh - 3 - hh * 0.7, sw - 2, 5); }
        else if (r() < 0.4) { g.fillStyle = "rgba(255,240,200,.55)"; g.fillRect(x, y + rh - 3 - hh * 0.6, sw, 2); }
        x += sw + 0.5;
      }
      g.fillStyle = "#4a3320"; g.fillRect(0, y + rh - 3, w, 3);
    }
  });
  const m = new THREE.MeshBasicMaterial({ map: t, color: "#d8cfc0" });
  shopTex.set(key, m);
  return m;
}
function shopSign(key) {
  const id = `sign/${key}`;
  if (shopTex.has(id)) return shopTex.get(id);
  const sh = SHOPS[key];
  const t = canvasTex(512, 96, (g, w, h) => {
    g.fillStyle = "#07080c"; g.fillRect(0, 0, w, h);
    g.strokeStyle = sh.neon; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, h - 10);
    g.shadowColor = sh.neon; g.shadowBlur = 16; g.fillStyle = "#ffffff"; g.font = "700 46px 'Geist Mono', ui-monospace, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(sh.sign, w / 2, h / 2 + 2, w - 40);
    g.shadowBlur = 0; g.globalCompositeOperation = "multiply"; g.fillStyle = sh.neon; g.fillRect(0, 0, w, h);
  });
  const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  shopTex.set(id, m);
  return m;
}
/** A themed shop on the face (fx, fz) of a podium pw wide: shelves behind the glass, a sign over it, neon on the wet pavement. */
function stock(b, repo, r, pw, ph, y0, [fx, fz], hall, hq) {
  const key = hq ? "hq" : hall && r() < 0.7 ? "library" : pick(r, ["lava", "lava", "lava", "library", "library", "books", "books", "used", "hall", "video", "comics", "records", "archive", "office"]), ry = Math.atan2(fx, fz);
  // Every face of the ground floor is the shop: shelves behind the glass and a sign over it.
  for (const [gx, gz] of [[fx, fz], [-fx, -fz], [fz, fx], [-fz, -fx]]) {
    const gy = Math.atan2(gx, gz);
    const shelves = new THREE.Mesh(PLANE, shopShelves(key));
    shelves.scale.set(pw * 0.86, ph * 0.62, 1); shelves.position.set(b.x + gx * (pw / 2 + 0.012), y0 + ph * 0.45, b.z + gz * (pw / 2 + 0.012)); shelves.rotation.y = gy;
    const sign = new THREE.Mesh(PLANE, shopSign(key));
    sign.scale.set(Math.min(pw * 0.9, 2.4), Math.min(pw * 0.9, 2.4) * 0.19, 1); sign.position.set(b.x + gx * (pw / 2 + 0.04), y0 + ph + 0.3, b.z + gz * (pw / 2 + 0.04)); sign.rotation.y = gy;
    scene.add(shelves, sign);
  }
  put("pool", b.x + fx * (pw / 2 + 1.1), CURB + 0.02, b.z + fz * (pw / 2 + 1.1), 3.2, 1, 3.2, 0, SHOPS[key].neon);
  rooms.push({ b, repo, kind: key, pw, ph, y0, door: [fx, fz], state: 0, group: null, folks: [], light: SHOPS[key].neon });
}

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
  const lit = Array.from({ length: 64 }, () => (style === "shop" ? 0.95 : 0.55) > r() ? 0.45 + r() * 0.55 : 0);
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
  m.emissiveIntensity = 1.1 + b.glow * 2.6;
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
const commits = city.districts.reduce((k, d) => k + (d.pulse?.commits ?? 0), 0), failing = city.districts.reduce((k, d) => k + (d.pulse?.failing ?? 0), 0);
$("#city-sum").textContent = all.length
  ? `${n(city.districts.length, "district")}, ${n(all.length, "building")}, ${n(city.lines, "line")}${city.present.length ? ` · ${n(city.present.length, "walker")} in town` : ""}${commits ? ` · ${n(commits, "commit")} this week` : ""}${failing ? ` · ${n(failing, "check")} failing` : ""}${city.public ? "" : " · only you can see it"}`
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
  gr.addColorStop(0, "#05070c"); gr.addColorStop(0.36, "#0d1220"); gr.addColorStop(0.47, "#3a1a3e"); gr.addColorStop(0.5, "#0a0e16"); gr.addColorStop(1, "#05070c");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}) }));
scene.add(sky);
scene.fog = new THREE.Fog(HAZE, 45, extent * 3.4 + 80); // reset once the slab is known, below
sun.position.set(-extent * 1.2, extent * 0.9 + 20, extent * 0.7);
const sc = sun.shadow.camera; sc.left = sc.bottom = -extent * 1.5; sc.right = sc.top = extent * 1.5; sc.near = 1; sc.far = extent * 5 + 80; sc.updateProjectionMatrix();

// The ground: wet asphalt for the streets, the country beyond them.
// A diorama: the city sits on a slab of earth with its strata showing, in a wooden frame,
// floating in the dark. Its top is the grass beyond the streets.
const MARGIN = 5, SLAB = 6, WOOD = 1.4;
const FAR = Math.max(x1 - x0, z1 - z0) * 1.6 + 2 * MARGIN + maxH;
scene.fog.near = FAR * 0.8; scene.fog.far = FAR * 2.6;
const slabW = x1 - x0 + 2 * MARGIN, slabD = z1 - z0 + 2 * MARGIN, slabX = (x0 + x1) / 2, slabZ = (z0 + z1) / 2;
const strata = canvasTex(256, 128, (g, w, h) => {
  const r = rng(7);
  g.fillStyle = "#2a2018"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 3) { const t = y / h; g.fillStyle = `rgba(${50 + t * 40 + r() * 30},${44 + t * 32 + r() * 24},${36 + t * 30 + r() * 20},.85)`; g.fillRect(0, y + Math.sin(y * 0.4) * 2, w, 3); }
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "20,16,12" : "110,100,90"},${0.25 + r() * 0.4})`; g.fillRect(r() * w, h * 0.3 + r() * h * 0.7, 2 + r() * 8, 2 + r() * 4); }
  const gr = g.createLinearGradient(0, 0, 0, h * 0.2); gr.addColorStop(0, "#1c3a22"); gr.addColorStop(1, "rgba(28,58,34,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.2);
});
strata.wrapS = THREE.RepeatWrapping; strata.repeat.set(slabW / 18, 1);
const earthSide = new THREE.MeshStandardMaterial({ map: strata, roughness: 1, emissive: "#ffffff", emissiveMap: strata, emissiveIntensity: 0.6 });
const earthAlong = new THREE.MeshStandardMaterial({ map: strata.clone(), roughness: 1, emissive: "#ffffff", emissiveIntensity: 0.6 });
earthAlong.map.needsUpdate = true; earthAlong.map.repeat.set(slabD / 18, 1); earthAlong.emissiveMap = earthAlong.map;
const grassTop = std("#1d2b22", { roughness: 0.95 });
const ground = new THREE.Mesh(new THREE.BoxGeometry(slabW, SLAB, slabD), [earthAlong, earthAlong, grassTop, earthSide, earthSide, earthSide]);
ground.position.set(slabX, -SLAB / 2 - 0.02, slabZ); ground.receiveShadow = ground.castShadow = true;
const grain = canvasTex(256, 64, (g, w, h) => { g.fillStyle = "#6b4a2c"; g.fillRect(0, 0, w, h); const r = rng(3); for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? "40,24,10" : "150,110,70"},.35)`; g.beginPath(); g.moveTo(0, r() * h); g.bezierCurveTo(w / 3, r() * h, w / 2, r() * h, w, r() * h); g.stroke(); } });
const woodBase = new THREE.Mesh(new THREE.BoxGeometry(slabW + WOOD * 2, WOOD, slabD + WOOD * 2), new THREE.MeshStandardMaterial({ map: grain, roughness: 0.55, emissive: "#ffffff", emissiveMap: grain, emissiveIntensity: 0.45 }));
woodBase.position.set(slabX, -SLAB - WOOD / 2 - 0.02, slabZ); woodBase.castShadow = true;
scene.add(ground, woodBase);
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + STREET, z1 - z0 + STREET), std("#14181d", { roughness: 0.12, metalness: 0.55 }));
asphalt.rotation.x = -Math.PI / 2; asphalt.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); asphalt.receiveShadow = true;
scene.add(asphalt);
const paving = canvasTex(128, 128, (g, w) => { g.fillStyle = "#4a5060"; g.fillRect(0, 0, w, w); g.strokeStyle = "rgba(10,14,22,.35)"; g.lineWidth = 2; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, w); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } });
paving.wrapS = paving.wrapT = THREE.RepeatWrapping;

// Lane paint: a dashed centre line down every street, zebra crossings at every junction.
const half = STREET / 2, manholes = [];
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
// Bike lanes down both kerbs of every street, and a stop line before each crossing.
const BIKE = LANE + 1.05;
for (const rx of roadsX) for (let j = 0; j < roadsZ.length - 1; j++) {
  const a = roadsZ[j] + half + 0.2, b = roadsZ[j + 1] - half - 0.2;
  for (const s of [-1, 1]) {
    put("bikeLane", rx + s * BIKE, 0.008, (a + b) / 2, 0.75, 0.02, b - a);
    put("paint", rx + s * (BIKE - 0.42), 0.011, (a + b) / 2, 0.06, 0.02, b - a);
    put("paint", rx + s * 1.1, 0.012, s > 0 ? b - 0.15 : a + 0.15, 2.1, 0.02, 0.22);
  }
  // A manhole in the middle of the block, steaming.
  manholes.push([rx, (a + b) / 2 + 2.3]);
}
for (const rz of roadsZ) for (let i = 0; i < roadsX.length - 1; i++) {
  const a = roadsX[i] + half + 0.2, b = roadsX[i + 1] - half - 0.2;
  for (const s of [-1, 1]) {
    put("bikeLane", (a + b) / 2, 0.008, rz + s * BIKE, b - a, 0.02, 0.75);
    put("paint", (a + b) / 2, 0.011, rz + s * (BIKE - 0.42), b - a, 0.02, 0.06);
    put("paint", s < 0 ? b - 0.15 : a + 0.15, 0.012, rz + s * 1.1, 0.22, 0.02, 2.1);
  }
  manholes.push([(a + b) / 2 - 2.3, rz]);
}
for (const [x, z] of manholes) put("cylMetal", x, 0.012, z, 0.8, 0.02, 0.8);
// Traffic lights on two corners of every junction: one for each street, with a walk sign under it.
const signals = [];
for (const rx of roadsX) for (const rz of roadsZ) for (const [sx, sz, axis] of [[1, 1, "z"], [-1, -1, "x"]]) {
  const x = rx + sx * (half - SIDEWALK * 0.35), z = rz + sz * (half - SIDEWALK * 0.35);
  // Its lamps face across the junction, at the traffic coming the other way into it.
  const [fx, fz] = axis === "z" ? [0, -sz] : [-sx, 0];
  put("cylMetal", x, 1.3, z, 0.09, 2.6, 0.09);
  put("metal", x + fx * 0.02, 2.45, z + fz * 0.02, axis === "z" ? 0.26 : 0.22, 0.82, axis === "z" ? 0.22 : 0.26);
  put("metal", x + fx * 0.1, 1.75, z + fz * 0.1, 0.22, 0.24, 0.22);
  signals.push({ rx, rz, axis, lamps: [0.27, 0, -0.27].map((dy) => [x + fx * 0.13, 2.45 + dy, z + fz * 0.13]), walk: [x + fx * 0.22, 1.75, z + fz * 0.22] });
}

// ---- the blocks: a kerb, a sidewalk, lamps, trees, benches, hydrants -------------------
const kerb = new THREE.LineBasicMaterial({ color: "#e8590c" }), alarms = [];
const FOLK_EYE = 0.6, BODY = 0.18, DOOR = 0.7; // we walk at the crowd's size: a shop door is about our height
const towers = [], solids = [], lamps = [], blocks = [];
for (const d of city.districts) {
  const cx = d.x + d.size / 2, cz = d.z + d.size / 2, e = d.size / 2 + SIDEWALK;
  const pulse = d.pulse ?? { bustle: 0, chaos: 0, failing: 0 };
  blocks.push({ cx, cz, e, bustle: pulse.bustle, chaos: pulse.chaos });
  // A district with checks failing has its kerb's neon blinking red.
  const neon = pulse.failing ? new THREE.LineBasicMaterial({ color: "#ff2a1a" }) : kerb;
  if (pulse.failing) alarms.push(neon);
  const p = paving.clone(); p.repeat.set(e * 0.9, e * 0.9); p.needsUpdate = true;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(e * 2, CURB, e * 2), std("#ffffff", { map: p, roughness: 0.75 }));
  slab.position.set(cx, CURB / 2, cz); slab.receiveShadow = true;
  scene.add(slab);
  // The streets' neon: an orange line round every block's kerb.
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-e, -e], [e, -e], [e, e], [-e, e]].map(([x, z]) => new THREE.Vector3(cx + x, CURB + 0.01, cz + z))), neon));
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
      const what = pick(r, ["bench", "bench", "bin", "hydrant", "bollards", "kiosk", "shelter"]);
      const ry = nx ? Math.PI / 2 : 0;
      if (what === "bench") { put("tint", x - nx * 0.35, CURB + 0.28, z - nz * 0.35, nx ? 0.35 : 1.1, 0.06, nz ? 0.35 : 1.1, 0, "#7b6450"); put("metal", x - nx * 0.5, CURB + 0.45, z - nz * 0.5, nx ? 0.05 : 1.1, 0.3, nz ? 0.05 : 1.1); }
      else if (what === "bin") put("cylMetal", x, CURB + 0.3, z, 0.32, 0.6, 0.32);
      else if (what === "hydrant") { put("cylTint", x, CURB + 0.25, z, 0.2, 0.5, 0.2, 0, "#e8590c"); put("cylTint", x, CURB + 0.52, z, 0.14, 0.1, 0.14, 0, "#c24a0a"); }
      else if (what === "bollards") for (const o of [-0.6, 0, 0.6]) put("cyl", x + (nz ? o : 0), CURB + 0.25, z + (nx ? o : 0), 0.14, 0.5, 0.14);
      else if (what === "shelter") {
        // A bus shelter: a glass back, a white roof, an ad lit at one end.
        put("panel", x - nx * 0.55, CURB + 0.65, z - nz * 0.55, nx ? 0.05 : 1.7, 1.1, nz ? 0.05 : 1.7);
        put("white", x - nx * 0.3, CURB + 1.25, z - nz * 0.3, nx ? 0.75 : 1.85, 0.07, nz ? 0.75 : 1.85);
        put("neon", x - nx * 0.3 + nz * 0.85, CURB + 0.7, z - nz * 0.3 + nx * 0.85, nx ? 0.6 : 0.05, 0.95, nz ? 0.6 : 0.05);
        put("tint", x - nx * 0.4, CURB + 0.3, z - nz * 0.4, nx ? 0.3 : 1.2, 0.06, nz ? 0.3 : 1.2, 0, "#7b6450");
      }
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
  const podium = H > 2.6 && kind !== "round";
  if (!podium) solids.push({ x0: b.x - w / 2 - 0.2, x1: b.x + w / 2 + 0.2, z0: b.z - w / 2 - 0.2, z1: b.z + w / 2 + 0.2 });
  const body = glassy ? "curtain" : kind === "works" ? "ribbon" : kind === "hall" ? "tall" : pick(r, ["grid", "grid", "ribbon"]);
  const roofCol = glassy ? "#2a3036" : "#dfe2e4";
  const face = pick(r, [[0, 1], [1, 0], [0, -1], [-1, 0]]);
  let top = y0, tw = w;

  // Street level: a storey of shop glass under an awning, a touch wider than the tower.
  if (podium) {
    const pw = w + 0.3, ph = STOREY;
    // Hollow: the shop is a room you can walk into, so its walls show from inside too.
    const shell = facadeMat(b, "shop", true, pw, ph, v); shell.side = THREE.DoubleSide;
    mesh(new THREE.BoxGeometry(pw, ph, pw), shell, b.x, y0 + ph / 2, b.z);
    doorway(b, pw, ph, y0, face);
    put("white", b.x, y0 + ph + 0.04, b.z, pw + 0.08, 0.08, pw + 0.08);
    const [fx, fz] = face;
    put("tint", b.x + fx * (pw / 2 + 0.25), y0 + ph * 0.82, b.z + fz * (pw / 2 + 0.25), fx ? 0.5 : pw * 0.8, 0.05, fz ? 0.5 : pw * 0.8, 0, pick(r, ["#e8590c", "#16191c", "#f4f5f5", "#e8590c"]), fz * 0.25, -fx * 0.25);
    // A neon blade sign sticking out over the sidewalk at one end of the front.
    if (r() < 0.5) {
      const t = (r() < 0.5 ? -1 : 1) * pw * 0.38, k = r() < 0.35 ? "orange" : "neon", nc = pick(r, ["#ff2f9a", "#19d3ff", "#ffe14a", "#8a5cff", "#41ffb0"]);
      put("metal", b.x + fx * (pw / 2 + 0.22) + fz * t, y0 + ph + 0.55, b.z + fz * (pw / 2 + 0.22) + fx * t, fx ? 0.4 : 0.06, 1.0, fz ? 0.4 : 0.06);
      put(k, b.x + fx * (pw / 2 + 0.22) + fz * t, y0 + ph + 0.55, b.z + fz * (pw / 2 + 0.22) + fx * t, fx ? 0.34 : 0.08, 0.9, fz ? 0.34 : 0.08, 0, k === "neon" ? nc : undefined);
    }
    stock(b, repo, r, pw, ph, y0, face, kind === "hall", b.h >= maxH - 0.01);
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
  // The tallest is the pyramid-crowned tower of the bay.
  if (b.h >= maxH - 0.01 && b.h > 6 && kind === "tower") put("pyramid", b.x, top + 2.2, b.z, tw * 0.62, 4.4, tw * 0.62, Math.PI / 4);
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

buildKits();

// ---- the streets' pulse: busy where commits land, chaos where checks fail --------------
/** The most of a pulse (bustle or chaos) among the districts whose streets x, z is on. */
const near = (k, x, z) => blocks.reduce((m, b) => Math.max(Math.abs(x - b.cx) < b.e + half + 1 && Math.abs(z - b.cz) < b.e + half + 1 ? b[k] : 0, m), 0);
const _r = rng(hash(`${name}/streets`));

// Every junction's lights cycle: the z street green, amber, then the x street. Near a district
// with checks failing badly they've gone out, blinking amber, and everyone takes their chances.
const junctions = new Map();
for (const rx of roadsX) for (const rz of roadsZ) junctions.set(`${rx},${rz}`, { x: rx, z: rz, off: _r() * 10, chaos: near("chaos", rx, rz), bustle: near("bustle", rx, rz) });
for (const j of junctions.values()) j.out = j.chaos >= 0.5;
const CYCLE = 10;
/** What the light says to the traffic along `axis` at junction j: go, amber, stop, or out. */
function light(j, axis, time) {
  if (j.out) return "out";
  const p = (time + j.off) % CYCLE;
  if (axis === "z") return p < 4 ? "go" : p < 5 ? "amber" : "stop";
  return p >= 5 && p < 9 ? "go" : p >= 9 ? "amber" : "stop";
}
/** Whether people may cross the street that runs along `axis` (its traffic has a red). */
const walkOn = (j, axis, time) => { const p = (time + j.off) % CYCLE; return axis === "z" ? p >= 5 && p < 8.5 : p < 3.5; };

const C = (h) => new THREE.Color(h);
const LIT = { red: C("#ff2a1a"), amber: C("#ffb020"), green: C("#41d17a"), walk: C("#f4f5f5"), dont: C("#e8590c") };
const DIM = { red: C("#3a0a06"), amber: C("#3a2a06"), green: C("#0a2a14"), off: C("#1a1d20") };
const lampMesh = new THREE.InstancedMesh(BALL, glow("#ffffff"), signals.length * 3), walkMesh = new THREE.InstancedMesh(BOX, glow("#ffffff"), signals.length);
signals.forEach((g, i) => {
  g.j = junctions.get(`${g.rx},${g.rz}`);
  g.lamps.forEach(([x, y, z], k) => lampMesh.setMatrixAt(i * 3 + k, place(new THREE.Matrix4(), x, y, z, 0.14, 0.14, 0.14)));
  walkMesh.setMatrixAt(i, place(new THREE.Matrix4(), ...g.walk, 0.12, 0.14, 0.12));
});
scene.add(lampMesh, walkMesh);
function updateSignals(time) {
  const blinkOn = time % 1 < 0.5;
  signals.forEach((g, i) => {
    const st = light(g.j, g.axis, time);
    lampMesh.setColorAt(i * 3, st === "stop" ? LIT.red : DIM.red);
    lampMesh.setColorAt(i * 3 + 1, st === "amber" || (st === "out" && blinkOn) ? LIT.amber : DIM.amber);
    lampMesh.setColorAt(i * 3 + 2, st === "go" ? LIT.green : DIM.green);
    // The walk sign under it: people may cross this street while its light is red.
    walkMesh.setColorAt(i, g.j.out ? (blinkOn ? LIT.dont : DIM.off) : walkOn(g.j, g.axis, time) ? LIT.walk : LIT.dont);
  });
  lampMesh.instanceColor.needsUpdate = walkMesh.instanceColor.needsUpdate = true;
}

// ---- traffic: cars in both lanes of every street, bikes along the kerbs ------------------
// A lane is a loop along its street. Everyone in it keeps their distance from whoever's ahead,
// stops at the line on a red and for anyone crossing, unless chaos says otherwise.
const lanes = [];
for (const rx of roadsX) for (const [o, dir, bike] of [[LANE, 1, false], [-LANE, -1, false], [BIKE, 1, true], [-BIKE, -1, true]])
  lanes.push({ axis: "z", at: rx + o, road: rx, dir, bike, from: z0 - half, len: z1 - z0 + STREET, cross: roadsZ.map((c) => junctions.get(`${rx},${c}`)), movers: [] });
for (const rz of roadsZ) for (const [o, dir, bike] of [[-LANE, 1, false], [LANE, -1, false], [-BIKE, 1, true], [BIKE, -1, true]])
  lanes.push({ axis: "x", at: rz + o, road: rz, dir, bike, from: x0 - half, len: x1 - x0 + STREET, cross: roadsX.map((c) => junctions.get(`${c},${rz}`)), movers: [] });
/** Where along its street a lane's s is (s runs the way its traffic does). */
const alongOf = (l, s) => l.from + (l.dir > 0 ? s : l.len - s);
const sOf = (l, d) => (l.dir > 0 ? d - l.from : l.from + l.len - d);
const CAR_COLORS = ["#f4f5f5", "#f4f5f5", "#16191c", "#16191c", "#8e979e", "#e8590c", "#5a6670"];
const cars = [], bikes = [];
for (const l of lanes) {
  // How busy a street is: the busiest of the districts along it, sampled down its length.
  let bustle = 0;
  for (let k = 0; k <= 6; k++) { const d = l.from + (l.len * k) / 6; bustle = Math.max(bustle, l.axis === "z" ? near("bustle", l.road, d) : near("bustle", d, l.road)); }
  const m = l.bike ? Math.round((l.len / 26) * (0.4 + bustle * 2.6)) : Math.max(1, Math.round(l.len / (16 - 9 * bustle)));
  const room = Math.floor(l.len / (l.bike ? 2.4 : 4.2)), count = Math.min(m, room);
  for (let k = 0; k < count; k++) {
    const v = { l, s: ((k + _r() * 0.4) / count) * l.len, v: 0, half: l.bike ? 0.5 : 0.95, wob: _r() * 6, stall: 0, skid: 0, reckless: false, decided: null, chaos: 0 };
    v.vmax = l.bike ? 2.6 + _r() * 1.6 : 4.5 + _r() * 3.5;
    if (l.bike) bikes.push(Object.assign(v, { coat: pick(_r, ["#16191c", "#f4f5f5", "#e8590c", "#3a4148"]), helmet: pick(_r, ["#f4f5f5", "#e8590c", "#16191c"]) }));
    else cars.push(Object.assign(v, { color: pick(_r, CAR_COLORS) }));
    l.movers.push(v);
  }
}

// ---- people: round their blocks, over the crossings, and (in chaos) straight across ------
const people = [];
/** What a passer-by looks like: skin, hair (or none, then it's their skin) and trousers from the avatar palettes. */
const folk = (r) => { const skin = pick(r, PARTS.skin.slice(0, 6)); return { skin, hair: r() < 0.2 ? skin : pick(r, PARTS.hairColor), pants: pick(r, PARTS.bottomColor) }; };
for (const b of blocks) for (let k = 0, m = Math.round(5 + 35 * b.bustle); k < m; k++)
  people.push({ ...folk(_r), b, t: _r() * 4, off: 0.55 + _r() * 0.7, speed: (0.025 + _r() * 0.03) * (1 + b.chaos) * (_r() < 0.5 ? -1 : 1), coat: pick(_r, ["#16191c", "#2e3439", "#f4f5f5", "#6b7680", "#8a5a3c"]), brolly: pick(_r, ["#16191c", "#16191c", "#f4f5f5", "#e8590c", "#3a4148"]), bob: _r() * 6 });
/** People who cross the street. axis is the street's (they walk across it); jaywalkers cross mid-block. */
const crossers = [], CURBX = half - SIDEWALK + 0.4;
for (const j of junctions.values()) {
  const m = Math.min(10, Math.round(1 + 5 * j.bustle + 4 * j.chaos));
  for (let k = 0; k < m; k++) {
    const p = { ...folk(_r), j, axis: _r() < 0.5 ? "z" : "x", arm: _r() < 0.5 ? -1 : 1, from: _r() < 0.5 ? -1 : 1, wait: _r() * 4, walking: false, lean: (_r() - 0.5) * 0.6, speed: 1.1 + _r() * 0.5, jump: 0, bob: _r() * 6,
      coat: pick(_r, ["#16191c", "#2e3439", "#f4f5f5", "#6b7680", "#8a5a3c"]), brolly: pick(_r, ["#16191c", "#f4f5f5", "#e8590c", "#3a4148"]) };
    p.u = p.from;
    reroll(p);
    crossers.push(p);
  }
}
/** Pick where a crosser crosses next: at the zebra, or (with the junction's chaos) anywhere down the block. */
function reroll(p) {
  p.jay = Math.random() < p.j.chaos * 0.6;
  if (!p.jay) return;
  const cs = p.axis === "z" ? roadsZ : roadsX, c = p.axis === "z" ? p.j.z : p.j.x, i = cs.indexOf(c), dn = i < cs.length - 1 ? 1 : -1;
  const lo = c + dn * (half + 1.2), hi = cs[i + dn] - dn * (half + 1.2);
  p.along = lo + Math.random() * (hi - lo);
}
/** A crosser's spot: x, z. u runs -1..1 from one kerb to the other. */
function crosserAt(p) {
  const across = p.u * CURBX + p.lean * 0.4;
  if (p.axis === "z") return [p.j.x + across, p.jay ? p.along : p.j.z + p.arm * (half - 0.6) + p.lean];
  return [p.jay ? p.along : p.j.x + p.arm * (half - 0.6) + p.lean, p.j.z + across];
}
function updateCrossers(dt, time) {
  for (const p of crossers) {
    p.jump = Math.max(0, p.jump - dt);
    if (still) { [p.x, p.z] = crosserAt(p); continue; }
    if (!p.walking) {
      p.wait -= dt;
      // At the kerb: go on the walk sign, or whenever, if they're jaywalking or the lights are out.
      if (p.wait <= 0 && (p.jay || p.j.out || walkOn(p.j, p.axis, time) || Math.random() < p.j.chaos * dt * 0.3)) p.walking = true;
    } else {
      // Caught mid-crossing by the red: hurry.
      const hurry = p.jay || p.j.out || walkOn(p.j, p.axis, time) ? 1 : 1.7;
      p.u -= p.from * (p.speed * hurry * dt) / CURBX;
      if (p.u * -p.from >= 1) { p.u = -p.from; p.from = -p.from; p.walking = false; p.wait = 1 + Math.random() * 5; reroll(p); }
    }
    [p.x, p.z] = crosserAt(p);
    p.onRoad = p.walking && Math.abs(p.u) < 0.95;
  }
}

/** Move everyone in a lane on by dt: distance, lights, crossers and chaos. */
function drive(l, dt, time, crossing) {
  const m = l.movers, n = m.length;
  for (let i = 0; i < n; i++) {
    const c = m[i], d = alongOf(l, c.s);
    const [x, z] = l.axis === "z" ? [l.at, d] : [d, l.at];
    c.chaos = near("chaos", x, z);
    let target = c.vmax * (1 + c.chaos * 0.35);
    // Chaos: a sudden stop, hazards on, nose swung out.
    if (c.stall > 0) { c.stall -= dt; target = 0; }
    else if (Math.random() < c.chaos * (l.bike ? 0.12 : 0.22) * dt) { c.stall = 0.6 + Math.random() * 2; c.skid = Math.random() < 0.5 ? -1 : 1; }
    // The next junction ahead, and its stop line.
    const front = c.s + c.half;
    let jn = null, gapJ = Infinity;
    for (const j of l.cross) { const g = (sOf(l, l.axis === "z" ? j.z : j.x) - half - 0.45 - front + l.len) % l.len; if (g < gapJ) { gapJ = g; jn = j; } }
    if (jn && gapJ < 8) {
      if (c.decided !== jn) { c.decided = jn; c.reckless = Math.random() < c.chaos * 0.7; }
      const st = light(jn, l.axis, time);
      if (st === "out") { if (gapJ < 3) target = Math.min(target, 2.2); }
      else if (st !== "go" && !c.reckless && !(st === "amber" && gapJ < 1.2)) target = Math.min(target, gapJ * 1.6);
    }
    // Anyone crossing in front.
    for (const p of crossing) {
      if (p.axis === l.axis) continue;
      const lat = l.axis === "z" ? p.x - l.at : p.z - l.at;
      if (Math.abs(lat) > (l.bike ? 0.55 : 1.1)) continue;
      const ahead = (l.axis === "z" ? p.z - d : p.x - d) * l.dir - c.half;
      if (ahead > 0 && ahead < 5) {
        target = Math.min(target, Math.max(0, ahead - 0.7) * 1.5);
        // Too close: they jump out of the way.
        if (ahead < 1.1 && c.v > 1.5) p.jump = 0.45;
      }
    }
    // Keep a car's length back from whoever's ahead.
    let room = Infinity;
    if (n > 1) { const lead = m[(i + 1) % n]; room = ((lead.s - lead.half - front) % l.len + l.len) % l.len - 0.35; target = Math.min(target, Math.max(0, room) * 1.8); }
    c.brake = target < c.v - 0.3;
    c.v = target < c.v ? Math.max(target, c.v - 18 * dt) : Math.min(target, c.v + (l.bike ? 2.5 : 5) * dt);
    c.s = (c.s + Math.min(c.v * dt, Math.max(0, room))) % l.len;
  }
}

const _m = new THREE.Matrix4();
/** A mover's matrix: along its lane, wobbling across it with chaos, its nose out while it's stalled. */
function poseOf(c, time) {
  const l = c.l, d = alongOf(l, c.s), wob = Math.sin(time * (l.bike ? 3.1 : 1.7) + c.wob) * (l.bike ? 0.04 + c.chaos * 0.35 : c.chaos * 0.25);
  const yaw = (l.axis === "z" ? (l.dir > 0 ? 0 : Math.PI) : (l.dir > 0 ? Math.PI / 2 : -Math.PI / 2)) + (c.stall > 0 ? c.skid * 0.22 : 0) + wob * 0.15;
  const lean = l.bike ? -wob * 0.3 : 0;
  return l.axis === "z" ? place(_m, l.at + wob, 0, d, 1, 1, 1, yaw, 0, lean) : place(_m, d, 0, l.at + wob, 1, 1, 1, yaw, 0, lean);
}

const car = {
  body: new THREE.BoxGeometry(0.9, 0.42, 1.9).translate(0, 0.33, 0),
  cabin: new THREE.BoxGeometry(0.78, 0.34, 0.95).translate(0, 0.71, -0.1),
  head: new THREE.BoxGeometry(0.74, 0.1, 0.04).translate(0, 0.42, 0.96),
  tail: new THREE.BoxGeometry(0.74, 0.08, 0.04).translate(0, 0.45, -0.96),
};
const instanced = (geo, mat, count, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, count)); im.count = count; im.castShadow = shadow; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; };
const carMeshes = [[car.body, std("#ffffff", { roughness: 0.25, metalness: 0.5 })], [car.cabin, std("#14181b", { roughness: 0.1, metalness: 0.8 })], [car.head, glow("#fff1d0")], [car.tail, glow("#ffffff")]]
  .map(([g, m]) => instanced(g, m, cars.length, m instanceof THREE.MeshStandardMaterial));
cars.forEach((c, i) => carMeshes[0].setColorAt(i, C(c.color)));
const TAIL = C("#7a1008");
const bike = {
  wheels: (() => { const g = new THREE.TorusGeometry(0.28, 0.035, 6, 16).rotateY(Math.PI / 2); return [g.clone().translate(0, 0.31, 0.42), g.translate(0, 0.31, -0.42)]; })(),
  frame: new THREE.BoxGeometry(0.05, 0.05, 0.8).translate(0, 0.55, 0),
  rider: new THREE.CapsuleGeometry(0.13, 0.36, 3, 8).rotateX(0.45).translate(0, 0.98, 0.05),
  helmet: new THREE.SphereGeometry(0.11, 10, 8).translate(0, 1.32, 0.2),
};
const bikeMeshes = [
  ...bike.wheels.map((g) => [g, std("#16191c", { roughness: 0.5 }), null]),
  [bike.frame, std("#c9ced2", { roughness: 0.3, metalness: 0.7 }), null],
  [bike.rider, std("#ffffff", { roughness: 0.8 }), "coat"],
  [bike.helmet, std("#ffffff", { roughness: 0.4 }), "helmet"],
].map(([g, m, col]) => { const im = instanced(g, m, bikes.length); if (col) bikes.forEach((b, i) => im.setColorAt(i, C(b[col]))); return im; });
function updateTraffic(dt, time) {
  if (!still) { const crossing = crossers.filter((p) => p.onRoad); for (const l of lanes) drive(l, dt, time, crossing); }
  const blinkOn = time % 0.8 < 0.4;
  cars.forEach((c, i) => {
    poseOf(c, time);
    for (const im of carMeshes) im.setMatrixAt(i, _m);
    carMeshes[3].setColorAt(i, c.stall > 0 ? (blinkOn ? LIT.amber : DIM.off) : c.brake || c.v < 0.3 ? LIT.red : TAIL);
  });
  bikes.forEach((b, i) => { poseOf(b, time); for (const im of bikeMeshes) im.setMatrixAt(i, _m); });
  for (const im of [...carMeshes, ...bikeMeshes]) im.instanceMatrix.needsUpdate = true;
  if (carMeshes[3].instanceColor) carMeshes[3].instanceColor.needsUpdate = true;
}

// One crowd: the people round the blocks, then the crossers.
const everyone = [...people, ...crossers];
const FOLK = 0.6; // crowd scale: the people are small next to the towers
const SHOPPERS = 64, HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // spare crowd slots for the people inside the shops
const crowd = [
  [new THREE.BoxGeometry(0.2, 0.26, 0.12).translate(0, 0.13, 0), std("#ffffff", { roughness: 0.8 }), "pants"],
  [new THREE.CapsuleGeometry(0.13, 0.3, 3, 8).translate(0, 0.4, 0), std("#ffffff", { roughness: 0.8 }), "coat"],
  [new THREE.SphereGeometry(0.15, 12, 10).translate(0, 0.83, 0), std("#ffffff", { roughness: 0.8 }), "skin"],
  [new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.84, 0.01), std("#ffffff", { roughness: 0.6 }), "hair"],
  [new THREE.ConeGeometry(0.42, 0.18, 10).translate(0, 1.12, 0), std("#ffffff", { roughness: 0.4 }), "brolly"],
].map(([g, m, col]) => {
  const im = instanced(g, m, everyone.length + SHOPPERS);
  if (col) everyone.forEach((p, i) => im.setColorAt(i, C(p[col])));
  im.frustumCulled = false; // its people are spread over the city and move; shop folk fill the spare slots
  for (let i = everyone.length; i < everyone.length + SHOPPERS; i++) im.setMatrixAt(i, HIDDEN);
  return im;
});
function updatePeople(dt, time) {
  updateCrossers(dt, time);
  for (const [i, p] of people.entries()) {
    if (!still) p.t = (p.t + p.speed * dt + 4) % 4;
    const side = Math.floor(p.t), f = p.t - side, e = p.b.e - p.off, a = -e + 2 * e * f;
    const [x, z, ry] = side === 0 ? [p.b.cx + a, p.b.cz - e, Math.PI / 2] : side === 1 ? [p.b.cx + e, p.b.cz + a, 0] : side === 2 ? [p.b.cx - a, p.b.cz + e, -Math.PI / 2] : [p.b.cx - e, p.b.cz - a, Math.PI];
    place(_m, x, CURB + (still ? 0 : Math.abs(Math.sin(time * 7 + p.bob)) * 0.03), z, FOLK, FOLK, FOLK, ry + (p.speed < 0 ? Math.PI : 0));
    for (const im of crowd) im.setMatrixAt(i, _m);
  }
  for (const [k, p] of crossers.entries()) {
    // On the kerb they stand on the sidewalk; a startled one hops.
    const y = (Math.abs(p.u) >= 0.95 ? CURB : 0) + (p.jump > 0 ? Math.sin((p.jump / 0.45) * Math.PI) * 0.4 : p.walking && !still ? Math.abs(Math.sin(time * 8 + p.bob)) * 0.03 : 0);
    const ry = p.axis === "z" ? (p.from > 0 ? -Math.PI / 2 : Math.PI / 2) : (p.from > 0 ? Math.PI : 0);
    place(_m, p.x, y, p.z, FOLK, FOLK, FOLK, ry);
    for (const im of crowd) im.setMatrixAt(people.length + k, _m);
  }
  for (const im of crowd) im.instanceMatrix.needsUpdate = true;
}

// ---- inside the shops: built on approach, shown while near, with shoppers and a clerk -------------
// The people are the crowd's own instances (spare slots at the end), lent to a room while it is shown.
const SHOP_NEAR = 12, SHOP_FAR = 16, slots = Array.from({ length: SHOPPERS }, (_, i) => everyone.length + i);
const roomLights = [0, 1].map(() => { const l = new THREE.PointLight("#ffd29a", 0, 4, 2); scene.add(l); return l; });
const mods = new Map();
const shopModule = (name) => { if (!mods.has(name)) mods.set(name, import(`./city-shops/${name}.js`).catch((e) => { console.warn("shop module", name, e); return null; })); return mods.get(name); };
async function buildRoom(s) {
  s.state = 1;
  const { b, repo, kind, pw, ph, y0, door } = s, lists = new Map(), group = new THREE.Group();
  const ctx = { b, repo, kind, r: rng(hash(`${repo}/${b.path}/shop`)), pw, ph, y0, scene: group, THREE, door, lines: b.lines, path: b.path,
    put: (key, x, y, z, sx, sy, sz, ry, color, rx, rz) => { if (!lists.has(key)) lists.set(key, []); lists.get(key).push({ m: place(new THREE.Matrix4(), x, y, z, sx, sy, sz, ry, rx, rz), color }); } };
  let out;
  for (const name of [SHOP_MODULES[kind], "generic"]) {
    const mod = name && await shopModule(name);
    if (!mod) continue;
    lists.clear();
    try { out = mod.buildInterior(ctx) ?? {}; break; } catch (e) { console.warn("shop interior", kind, e); }
  }
  if (!out) { s.state = 3; return; } // nothing could stock it: the shop stays a shell
  for (const [key, list] of lists) {
    const k = kits.get(key);
    if (!k) continue;
    const im = new THREE.InstancedMesh(k.geo, k.mat, list.length);
    list.forEach((p, i) => { im.setMatrixAt(i, p.m); if (p.color) im.setColorAt(i, C(p.color)); });
    if (list.some((p) => p.color)) for (let i = 0; i < list.length; i++) if (!list[i].color) im.setColorAt(i, C("#ffffff"));
    group.add(im);
  }
  const ih = pw / 2 - 0.1, [fx, fz] = door;
  s.aisles = out.aisles?.length ? out.aisles : [[b.x - ih * 0.4, b.z - ih * 0.4], [b.x + ih * 0.4, b.z - ih * 0.4], [b.x + ih * 0.4, b.z + ih * 0.4], [b.x - ih * 0.4, b.z + ih * 0.4]];
  s.clerk = out.clerk ?? [b.x - fx * ih * 0.8, b.z - fz * ih * 0.8];
  s.group = group; group.visible = false; scene.add(group); s.state = 2;
}
/** Hand a room's people their crowd slots (and look) while it is shown, take them back when it is not. */
function staff(s, on) {
  if (!on) { for (const f of s.folks) { for (const im of crowd) im.setMatrixAt(f.slot, HIDDEN); slots.push(f.slot); } s.folks = []; return; }
  const r = rng(hash(`${s.repo}/${s.b.path}/folk`)), n = 1 + Math.min(3, 2 + Math.floor(r() * 2));
  for (let k = 0; k < n && slots.length; k++) {
    const slot = slots.pop(), clerk = k === 0, look = folk(r), [x, z] = clerk ? s.clerk : s.aisles[Math.floor(r() * s.aisles.length)];
    const cols = { ...look, coat: clerk ? "#e8590c" : pick(r, ["#16191c", "#2e3439", "#f4f5f5", "#6b7680", "#8a5a3c", "#3a6b8a"]), brolly: "#ffffff" };
    crowd.forEach((im, i) => { const col = ["pants", "coat", "skin", "hair", "brolly"][i]; im.setColorAt(slot, C(cols[col])); if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    s.folks.push({ slot, clerk, x, z, tx: x, tz: z, ry: r() * 6.28, wait: r() * 3, bob: r() * 6 });
  }
}
function updateShops(dt, time) {
  const px = player.pos.x, pz = player.pos.z, near = [];
  let built = false;
  for (const s of rooms) {
    const d2 = (s.b.x - px) ** 2 + (s.b.z - pz) ** 2, show = walking && d2 < SHOP_FAR * SHOP_FAR;
    if (walking && !built && s.state === 0 && d2 < SHOP_NEAR * SHOP_NEAR) { built = true; buildRoom(s); }
    if (s.state !== 2) continue;
    if (show !== s.group.visible) { s.group.visible = show; staff(s, show); }
    if (show) near.push([d2, s]);
  }
  near.sort((a, c) => a[0] - c[0]);
  roomLights.forEach((l, i) => { const s = near[i]?.[1]; l.intensity = s ? 3 : 0; if (s) { l.color.set(s.light); l.position.set(s.b.x, s.y0 + s.ph * 0.8, s.b.z); } });
  for (const [, s] of near) for (const f of s.folks) {
    // Shoppers drift between aisles and browse the shelves; the clerk stays at the till and now and then steps out to restock.
    const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz), [cx, cz] = s.clerk, away = Math.atan2(f.x - s.b.x, f.z - s.b.z);
    let stepping = false;
    if (d > 0.04) { const step = Math.min(d, 0.3 * dt); f.x += dx / d * step; f.z += dz / d * step; f.ry = Math.atan2(dx, dz); stepping = !still; f.moving = true; }
    else {
      if (f.moving) { f.moving = false; f.ry = away + (f.clerk ? Math.PI : 0); } // arrived: face the shelves; the clerk faces the room
      if ((f.wait -= dt) <= 0) {
        if (f.clerk) { const atPost = Math.hypot(f.x - cx, f.z - cz) < 0.05; [f.tx, f.tz] = atPost && Math.random() < 0.4 ? s.aisles[Math.floor(Math.random() * s.aisles.length)] : [cx, cz]; f.wait = atPost ? 4 + Math.random() * 6 : 6 + Math.random() * 8; }
        else { [f.tx, f.tz] = s.aisles[Math.floor(Math.random() * s.aisles.length)]; f.wait = 1.5 + Math.random() * 4; }
      }
    }
    place(_m, f.x, s.y0 + (stepping ? Math.abs(Math.sin(time * 7 + f.bob)) * 0.03 : 0), f.z, FOLK, FOLK, FOLK, f.ry);
    crowd.forEach((im, i) => im.setMatrixAt(f.slot, i === 4 ? HIDDEN : _m)); // no umbrellas indoors
  }
}

// ---- steam from the manholes: orange where the district's checks are failing ------------
const PUFFS = still ? 0 : 5;
const steam = instanced(BALL, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.22, depthWrite: false }), manholes.length * PUFFS, false);
manholes.forEach(([x, z], i) => { const hot = near("chaos", x, z) > 0.3; for (let k = 0; k < PUFFS; k++) steam.setColorAt(i * PUFFS + k, C(hot ? "#ff7a3a" : "#e6ebee")); });
function updateSteam(time) {
  if (!PUFFS) return;
  manholes.forEach(([x, z], i) => {
    for (let k = 0; k < PUFFS; k++) {
      const f = (time * 0.35 + k / PUFFS + i * 0.37) % 1, s = 0.3 + f * 1.4 * (1 - f * 0.6);
      place(_m, x + Math.sin(time * 0.8 + k) * f * 0.4, 0.15 + f * 3.2, z + Math.cos(time * 0.6 + i) * f * 0.3, s, s * 0.8, s);
      steam.setMatrixAt(i * PUFFS + k, _m);
    }
  });
  steam.instanceMatrix.needsUpdate = true;
}
// The kerbs of districts with checks failing blink red.
const blinkAlarms = (time) => { for (const m of alarms) m.color.setHex(still || time % 1.2 < 0.6 ? 0xff2a1a : 0x3a0a06); };

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
const DROPS = still ? 0 : 4200, rainPos = new Float32Array(DROPS * 6);
const rain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#9fb2d0", transparent: true, opacity: 0.55 }));
rain.geometry.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
rain.frustumCulled = false;
const drop = (i, y = Math.random() * (maxH + 28)) => {
  const x = (Math.random() - 0.5) * (slabW + 6), z = (Math.random() - 0.5) * (slabD + 6);
  rainPos.set([x, y, z, x + 0.05, y + 0.9, z], i * 6);
};
for (let i = 0; i < DROPS; i++) drop(i);
if (DROPS) scene.add(rain);
function updateRain(dt) {
  if (!DROPS) return;
  rain.position.set(slabX, 0, slabZ);
  for (let i = 0; i < DROPS; i++) {
    const o = i * 6;
    rainPos[o + 1] -= 38 * dt; rainPos[o + 4] -= 38 * dt;
    if (rainPos[o + 1] < 0) drop(i, maxH + 18 + Math.random() * 10);
  }
  rain.geometry.attributes.position.needsUpdate = true;
}
// ---- the storm: a bank of cloud over the city, lit from below by its neon ----------------
const cloudTex = canvasTex(256, 256, (g, w) => {
  const r = rng(11);
  for (let i = 0; i < 70; i++) {
    const x = w * (0.2 + r() * 0.6), y = w * (0.2 + r() * 0.6), rad = w * (0.1 + r() * 0.2), gr = g.createRadialGradient(x, y, 0, x, y, rad), c = 40 + r() * 50;
    gr.addColorStop(0, `rgba(${c + 20},${c + 14},${c + 30},.5)`); gr.addColorStop(1, `rgba(${c},${c},${c + 10},0)`); g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }
});
const clouds = Array.from({ length: still ? 12 : 16 }, (_, i) => {
  const r = rng(100 + i), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.9, fog: false, color: i % 4 === 0 ? "#b070c0" : "#c8d0e0" }));
  const s = Math.max(slabW, slabD) * (0.55 + r() * 0.5);
  sp.scale.set(s, s * 0.5, 1);
  sp.position.set(slabX + (r() - 0.5) * slabW * 1.1, maxH + 22 + r() * 10, slabZ + (r() - 0.5) * slabD * 1.1);
  sp.userData = { x: sp.position.x, d: r() * 6, sp: 0.02 + r() * 0.03 };
  scene.add(sp);
  return sp;
});
const driftClouds = (time) => { if (!still) for (const c of clouds) c.position.x = c.userData.x + Math.sin(time * c.userData.sp + c.userData.d) * 6; };
// The aircraft lights blink together, once every two seconds.
const red = kits.get("redLight").mat;
const blink = (time) => red.color.setHex(still || time % 2 < 1 ? 0xff2a1a : 0x3a0a06);

// ---- people: built from an avatar's parts (avatar.ts), Mii-sized: a big head on a small body ------------
const faces = new Map(), mats = new Map();
const tone = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, std(c, { roughness: 0.7, emissive: c, emissiveIntensity: 0.28, ...o })); return mats.get(k); };
const faceMat = (a) => {
  const k = `${a.eyes}/${a.mouth}/${a.glasses}`;
  if (!faces.has(k)) faces.set(k, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, map: canvasTex(128, 128, (g) => drawFace(g, a, 64, 66, 3.1)) }));
  return faces.get(k);
};
/** A person, feet at the origin, facing -z, about 1.7 tall. */
function person(a) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; g.add(m); return m; };
  const legH = a.build === "tall" ? 0.62 : a.build === "short" ? 0.3 : 0.45, w = a.build === "round" ? 0.5 : a.build === "slim" ? 0.34 : 0.42, torso = 0.5, r = 0.31;
  const skin = tone(a.skin), top = tone(a.top === "suit" ? "#2e3439" : a.topColor), pants = tone(a.bottomColor), hair = tone(a.hairColor, { roughness: 0.55 });
  for (const s of [-1, 1]) {
    add(BOX, pants, s * w * 0.24, legH / 2, 0, w * 0.4, legH, 0.2);
    add(BOX, tone("#16191c"), s * w * 0.24, 0.04, -0.03, w * 0.42, 0.08, 0.28);
    add(CAP_ARM, top, s * (w / 2 + 0.07), legH + torso - 0.2, 0, 1, 1, 1);
    add(BALL, skin, s * (w / 2 + 0.07), legH + torso - 0.42, 0, 0.1, 0.1, 0.1);
  }
  add(TORSO, top, 0, legH + torso / 2, 0, w, torso, 0.26);
  if (a.top === "dress") add(SKIRT, top, 0, legH + 0.08, 0, w * 1.15, 0.34, w * 1.15);
  if (a.top === "overalls") add(BOX, tone("#3a6bd8"), 0, legH + 0.15, -0.02, w * 1.02, 0.3, 0.27);
  if (a.top === "suit") { add(BOX, tone("#f4f5f5"), 0, legH + torso * 0.6, -0.14, 0.07, torso * 0.7, 0.02); add(BOX, tone("#e8590c"), 0, legH + torso * 0.55, -0.15, 0.04, 0.2, 0.02); }
  if (a.top === "hoodie") add(BALL, top, 0, legH + torso, 0.12, w * 0.9, 0.16, 0.2);
  if (a.top === "labcoat") { add(TORSO, tone("#f4f5f5"), 0, legH + torso / 2 - 0.02, 0, w * 1.06, torso * 0.9, 0.28); add(BOX, tone("#c9d1d6"), 0, legH + torso * 0.5, -0.145, 0.03, torso * 0.85, 0.01); }
  if (a.top === "lanyard") { add(BOX, tone("#e8590c"), 0, legH + torso * 0.78, -0.135, w * 0.5, 0.03, 0.01); add(BOX, tone("#f4f5f5"), 0, legH + torso * 0.5, -0.14, 0.15, 0.2, 0.01); }
  if (a.top === "hawaiian") for (const [dx, dy] of [[-0.1, 0.35], [0.08, 0.2], [-0.03, 0.1], [0.12, 0.4]]) add(BALL, tone("#f4f5f5"), dx * w * 2.4, legH + dy, -0.14, 0.07, 0.07, 0.02);
  const hy = legH + torso + r * 0.95;
  add(BALL, skin, 0, hy, 0, r * 2, r * 2.05, r * 2);
  const face = new THREE.Mesh(PLANE, faceMat(a)); face.scale.set(0.5, 0.5, 1); face.position.set(0, hy, -r * 0.985); face.rotation.y = Math.PI; g.add(face);
  // hair
  const capGeo = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.44);
  const hairCap = (k = 1.08) => add(capGeo, hair, 0, hy + 0.01, 0.01, r * 2 * k, r * 2 * k, r * 2 * k);
  if (a.hair === "short" || a.hair === "bob" || a.hair === "long" || a.hair === "bun" || a.hair === "pigtails") hairCap();
  if (a.hair === "bob") add(BOX, hair, 0, hy - 0.05, 0.12, r * 2.1, 0.32, r * 1.3);
  if (a.hair === "long") add(BOX, hair, 0, hy - 0.2, 0.12, r * 2.1, 0.6, r * 1.2);
  if (a.hair === "bun") add(BALL, hair, 0, hy + r * 1.05, 0.04, 0.2, 0.2, 0.2);
  if (a.hair === "pigtails") for (const s of [-1, 1]) add(BALL, hair, s * r * 1.15, hy - 0.08, 0.05, 0.16, 0.22, 0.16);
  if (a.hair === "afro") add(BALL, hair, 0, hy + 0.08, 0.04, r * 3.2, r * 3, r * 3);
  if (["ponytail", "space-buns", "locs", "braids", "topknot", "pompadour", "curly"].includes(a.hair)) hairCap();
  if (a.hair === "ponytail") { add(BALL, hair, 0, hy - 0.04, r * 1.1, 0.14, 0.36, 0.14); add(BALL, hair, 0, hy + 0.1, r * 0.95, 0.13, 0.13, 0.13); }
  if (a.hair === "space-buns") for (const s of [-1, 1]) add(BALL, hair, s * r * 0.8, hy + r * 0.85, 0, 0.17, 0.17, 0.17);
  if (a.hair === "locs") for (let i = -3; i <= 3; i++) { const t = (i / 3) * 1.7; add(BOX, hair, Math.sin(t) * r * 1.02, hy - 0.2, Math.cos(t) * r * 0.9, 0.06, 0.5 - Math.abs(i) * 0.03, 0.06); }
  if (a.hair === "braids") for (const s of [-1, 1]) for (let j = 0; j < 3; j++) add(BALL, hair, s * r * 1.02, hy - 0.08 - j * 0.1, 0.08, 0.09, 0.11, 0.09);
  if (a.hair === "topknot") { add(BALL, hair, 0, hy + r * 1.1, 0, 0.1, 0.2, 0.1); add(BALL, hair, 0, hy + r * 1.32, 0, 0.14, 0.14, 0.14); }
  if (a.hair === "pompadour") add(BALL, hair, 0, hy + r * 0.95, -r * 0.3, r * 1.7, 0.28, r * 1.5);
  if (a.hair === "flat-top") add(BOX, hair, 0, hy + r * 0.8, 0, r * 1.9, 0.2, r * 1.9);
  if (a.hair === "curly") { for (let i = 0; i < 8; i++) { const t = (i / 8) * Math.PI * 2; add(BALL, hair, Math.cos(t) * r * 0.85, hy + r * 0.55, Math.sin(t) * r * 0.85, 0.18, 0.18, 0.18); } add(BALL, hair, 0, hy + r * 0.95, 0, 0.22, 0.2, 0.22); }
  if (a.hair === "buzz") hairCap(1.03);
  if (a.hair === "mullet") { hairCap(); add(BOX, hair, 0, hy - 0.16, 0.13, r * 1.7, 0.4, r * 1.1); }
  if (a.hair === "mohawk") add(BOX, hair, 0, hy + r * 0.95, 0, 0.07, 0.24, r * 1.5);
  if (a.hair === "spiky") for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; add(CONE, hair, Math.cos(t) * r * 0.55, hy + r * 0.85, Math.sin(t) * r * 0.55, 0.14, 0.26, 0.14); }
  // hats
  const hat = (c, k = 1.14) => add(capGeo, tone(c, { roughness: 0.5 }), 0, hy + 0.04, 0.01, r * 2 * k, r * 2 * k, r * 2 * k);
  if (a.hat === "cap") { hat("#e8590c"); add(BOX, tone("#e8590c"), 0, hy + 0.1, -r * 1.05, r * 1.7, 0.03, 0.25); }
  else if (a.hat === "beanie") { hat("#3a6bd8", 1.18); add(BALL, tone("#f4f5f5"), 0, hy + r * 1.25, 0, 0.12, 0.12, 0.12); }
  else if (a.hat === "tophat") { add(CYL, tone("#16191c"), 0, hy + r * 0.95, 0, r * 2.5, 0.03, r * 2.5); add(CYL, tone("#16191c"), 0, hy + r * 0.95 + 0.17, 0, r * 1.5, 0.34, r * 1.5); add(CYL, tone("#c23a6b"), 0, hy + r * 0.95 + 0.06, 0, r * 1.55, 0.07, r * 1.55); }
  else if (a.hat === "hardhat") { hat("#f4d03a"); add(BOX, tone("#f4d03a"), 0, hy + r * 1.05, 0, 0.08, 0.05, r * 1.9); }
  else if (a.hat === "cat-ears") for (const s of [-1, 1]) add(CONE, hair, s * r * 0.68, hy + r * 0.82, 0, 0.16, 0.22, 0.12);
  else if (a.hat === "propeller") { hat("#3a6bd8"); add(CYL, tone("#16191c"), 0, hy + r * 1.15, 0, 0.03, 0.12, 0.03); add(BOX, tone("#e8590c"), 0, hy + r * 1.15 + 0.07, 0, r * 1.8, 0.02, 0.1); }
  else if (a.hat === "wizard") { add(CYL, tone("#4a3a8a"), 0, hy + r * 0.95, 0, r * 2.7, 0.03, r * 2.7); add(CONE, tone("#4a3a8a"), 0, hy + r * 0.95 + 0.3, 0, r * 1.7, 0.6, r * 1.7); add(BALL, glow("#f4d03a"), 0, hy + r * 0.95 + 0.18, -r * 0.8, 0.07, 0.07, 0.07); }
  else if (a.hat === "party") { add(CONE, tone("#c23a6b"), 0, hy + r * 0.95 + 0.17, 0, r * 1.1, 0.4, r * 1.1); add(BALL, tone("#f4d03a"), 0, hy + r * 0.95 + 0.4, 0, 0.1, 0.1, 0.1); }
  else if (a.hat === "cone") { add(CONE, tone("#e8590c"), 0, hy + r * 0.95 + 0.16, 0, r * 1.5, 0.45, r * 1.5); add(CYL, tone("#f4f5f5"), 0, hy + r * 0.95 + 0.15, 0, r * 1.05, 0.06, r * 1.05); }
  else if (a.hat === "headphones") { add(new THREE.TorusGeometry(0.5, 0.05, 6, 16, Math.PI), tone("#2e3439"), 0, hy, 0, r * 2.2, r * 2.2, r * 2.2); for (const s of [-1, 1]) add(CYL, tone("#16191c"), s * r * 1.07, hy, 0, 0.1, 0.1, 0.18).rotation.z = Math.PI / 2; }
  else if (a.hat === "crown") add(CYL, glow("#f4d03a"), 0, hy + r * 0.95 + 0.04, 0, r * 1.5, 0.1, r * 1.5);
  else if (a.hat === "rubber-duck") { add(BALL, tone("#f4d03a"), 0, hy + r * 0.95 + 0.06, 0, 0.2, 0.14, 0.2); add(BALL, tone("#f4d03a"), 0, hy + r * 0.95 + 0.17, -0.04, 0.12, 0.12, 0.12); add(BOX, tone("#e8590c"), 0, hy + r * 0.95 + 0.17, -0.11, 0.07, 0.03, 0.06); }
  else if (a.hat === "bucket") { add(CYL, tone("#8a9a5c"), 0, hy + r * 0.9, 0, r * 2.5, 0.03, r * 2.5); add(CYL, tone("#8a9a5c"), 0, hy + r * 0.9 + 0.09, 0, r * 1.7, 0.18, r * 1.7); }
  else if (a.hat === "halo") add(new THREE.TorusGeometry(0.5, 0.06, 6, 20).rotateX(Math.PI / 2), glow("#f4d03a"), 0, hy + r * 1.5, 0, 0.26, 0.26, 0.26);
  return g;
}
// ---- walkers: who landed lines lately, and the visitors here with you ------------------
function avatar(who, agent, spec) {
  const g = new THREE.Group();
  let look = spec ?? defaultAvatar(who);
  // An agent with no avatar of its own is a robot: grey skin, a visor for eyes, dark clothes.
  if (agent && !spec) look = { ...look, skin: "#9aa6b0", eyes: "dot", glasses: "shades", top: "suit", hat: "none", hairColor: "#16191c" };
  const body = person(look);
  const tag = label(`@${who}`, agent ? "#ffffff" : "#e8590c", agent ? "rgba(10,10,10,.85)" : "rgba(255,255,255,.92)");
  tag.scale.set(3, 0.38, 1); tag.position.y = 2.15;
  g.add(body, tag);
  scene.add(g);
  return g;
}
const footOf = (repo, path) => city.districts.find((d) => d.repo === repo)?.buildings.find((b) => b.path === path);
const walkers = city.present.map((p, i) => {
  const at = footOf(p.repo, p.path) ?? all[i % Math.max(1, all.length)];
  const g = avatar(p.who, p.who.startsWith("agent-"), p.avatar);
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
const EYE = 1.7 * FOLK_EYE, keys = new Set();
const player = { pos: new THREE.Vector3(0, EYE, z1 + 2), yaw: 0, pitch: 0, air: 0, vy: 0 };
let walking = false, lastSent = 0;
addEventListener("keydown", (e) => { if (e.code === "Space" && walking) e.preventDefault(); keys.add(e.code); });
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

/** Walls round a shop: a thin box on each side, the front split round a door. */
function doorway(b, pw, ph, y0, [fx, fz]) {
  const h = pw / 2, t = 0.1, d = DOOR / 2;
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ax = sx ? 1 : 0, cx = b.x + sx * (h - t / 2), cz = b.z + sz * (h - t / 2), ex = sx ? t / 2 : h, ez = sz ? t / 2 : h;
    if (sx === fx && sz === fz) {
      for (const o of [-1, 1]) { const lo = o * d, hi = o * h, a = Math.min(lo, hi), c = Math.max(lo, hi);
        solids.push(ax ? { x0: cx - ex, x1: cx + ex, z0: b.z + a, z1: b.z + c } : { x0: b.x + a, x1: b.x + c, z0: cz - ez, z1: cz + ez }); }
    } else solids.push({ x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez });
  }
  // The door itself: a dark, lit frame on the front.
  const door = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ color: "#2a1a10", toneMapped: false }));
  door.scale.set(DOOR, ph * 0.82, 1); door.position.set(b.x + fx * (h + 0.02), y0 + ph * 0.41, b.z + fz * (h + 0.02)); door.rotation.y = Math.atan2(fx, fz);
  scene.add(door);
}
function collide() {
  // Buildings are solid: step back out of any you walk into.
  for (const { x0, x1, z0, z1 } of solids) {
    const px = player.pos.x, pz = player.pos.z;
    if (px > x0 - BODY && px < x1 + BODY && pz > z0 - BODY && pz < z1 + BODY) {
      const l = px - (x0 - BODY), r = x1 + BODY - px, n = pz - (z0 - BODY), f = z1 + BODY - pz, m = Math.min(l, r, n, f);
      if (m === l) player.pos.x = x0 - BODY; else if (m === r) player.pos.x = x1 + BODY;
      else if (m === n) player.pos.z = z0 - BODY; else player.pos.z = z1 + BODY;
    }
  }
}
// Up on a block you stand on its sidewalk; down in the street, on the asphalt.
const onBlock = (x, z) => blocks.some((b) => Math.abs(x - b.cx) < b.e && Math.abs(z - b.cz) < b.e);
const ray = new THREE.Raycaster(), mid = new THREE.Vector2();
function updateWalk(dt, now) {
  setFov(62);
  const f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const s = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 11 * FOLK_EYE : 5.5 * FOLK_EYE;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const move = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
  if (move.lengthSq() > 1) move.normalize();
  player.pos.addScaledVector(move, speed * dt);
  player.pos.x = Math.max(x0 - MARGIN + 1, Math.min(x1 + MARGIN - 1, player.pos.x)); player.pos.z = Math.max(z0 - MARGIN + 1, Math.min(z1 + MARGIN - 1, player.pos.z));
  collide();
  const floor = onBlock(player.pos.x, player.pos.z) ? CURB : 0;
  // Space jumps: up fast, back down under gravity.
  if (keys.has("Space") && player.air === 0 && player.vy === 0) player.vy = 6.5 * FOLK_EYE ** 0.5;
  if (player.vy !== 0 || player.air > 0) { player.vy -= 18 * dt; player.air = Math.max(0, player.air + player.vy * dt); if (player.air === 0) player.vy = 0; }
  player.pos.y += (EYE + floor + player.air - player.pos.y) * Math.min(1, dt * (player.air > 0 ? 30 : 14));
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
function setFov(f) { if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } }
function updateSkyline(time) {
  // Round the diorama from above, far enough to take in the whole slab and the cloud over it.
  setFov(38);
  const r = Math.max(slabW, slabD) * 1.18 + maxH, a = still ? 0.8 : time * 0.035;
  camera.position.set(slabX + Math.cos(a) * r, r * 0.62 + maxH * 0.3, slabZ + Math.sin(a) * r);
  camera.lookAt(slabX, maxH * 0.18 - 2, slabZ);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000), time = now / 1000;
  prev = now;
  if (walking) updateWalk(dt, now); else updateSkyline(time);
  lava.draw(time);
  updateWalkers(time);
  updateVisitors(dt);
  updateSignals(time);
  updateTraffic(dt, time);
  updatePeople(dt, time);
  updateShops(dt, time);
  updateSteam(time);
  blinkAlarms(time);
  updateBirds(time);
  updateBlimp(time);
  updateRain(dt);
  driftClouds(time);
  blink(time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
