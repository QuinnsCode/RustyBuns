// The code city: a mode of the game (play.html#c/<name>). Someone's public repos
// are districts and their files are buildings (city.ts lays them out): height is
// line count, orange windows are lines that landed lately, white stone is people's
// code and black glass is agents'. Kamino's clean white halls out in Blade Runner's
// rain. Whoever has one of its files open walks the streets, and the
// owner and their followers can walk them together (a GameRoom, "c/<name>").
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

// ---- three: pale haze, wet street, rain ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $("#c"), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const HAZE = new THREE.Color("#dde3e6");
scene.background = HAZE;
scene.fog = new THREE.Fog(HAZE, 30, 160);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
camera.rotation.order = "YXZ";
scene.add(new THREE.HemisphereLight("#ffffff", "#9aa6ad", 2.2));
const sun = new THREE.DirectionalLight("#fff6ee", 1.4);
sun.position.set(-40, 60, 30);
scene.add(sun);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

const canvasTex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
// A storey of Kamino panel: a soft seam round each bay. Its windows are the emissive map, lit orange by how lately lines landed.
const STOREY = 1.2;
const panels = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(90,100,108,.22)"; g.lineWidth = 2; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 14); g.stroke();
});
const windows = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff"; g.fillRect(14, 54, w - 28, 18);
});
for (const t of [panels, windows]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
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

const extent = Math.max(20, ...city.districts.map((d) => Math.max(Math.abs(d.x), Math.abs(d.x + d.size), Math.abs(d.z), Math.abs(d.z + d.size))));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 6, extent * 6), new THREE.MeshStandardMaterial({ color: "#c3cacf", roughness: 0.7, metalness: 0.05 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
// The streets' neon: an orange line round every block.
const kerb = new THREE.LineBasicMaterial({ color: "#e8590c" });
const stone = new THREE.MeshStandardMaterial({ color: "#f4f5f5", map: panels, roughness: 0.55, emissive: "#e8590c", emissiveMap: windows });
const glass = new THREE.MeshStandardMaterial({ color: "#16191c", roughness: 0.12, metalness: 0.7, emissive: "#e8590c", emissiveMap: windows });
const towers = [];
for (const d of city.districts) {
  const plate = new THREE.Mesh(new THREE.BoxGeometry(d.size + 0.8, 0.12, d.size + 0.8), new THREE.MeshStandardMaterial({ color: "#eef1f2", roughness: 0.7 }));
  plate.position.set(d.x + d.size / 2, 0.06, d.z + d.size / 2);
  scene.add(plate);
  const e = d.size / 2 + 0.7, cx = d.x + d.size / 2, cz = d.z + d.size / 2;
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-e, -e], [e, -e], [e, e], [-e, e]].map(([x, z]) => new THREE.Vector3(cx + x, 0.14, cz + z))), kerb));
  const sign = label(d.repo);
  sign.position.set(cx, 0.9, d.z + d.size + 1.6);
  scene.add(sign);
  for (const b of d.buildings) {
    // Each building's own copy of its material: windows repeat a storey at a time, lit by its glow.
    const m = (b.agent >= 0.5 ? glass : stone).clone();
    for (const k of ["map", "emissiveMap"]) if (m[k]) { m[k] = m[k].clone(); m[k].repeat.set(1, Math.max(1, Math.round(b.h / STOREY))); m[k].needsUpdate = true; }
    m.emissiveIntensity = b.glow * 2.2;
    const t = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.w), m);
    t.position.set(b.x, b.h / 2 + 0.12, b.z);
    t.userData = { ...b, repo: d.repo };
    scene.add(t);
    towers.push(t);
    // A roof light where lines are landing now.
    if (b.glow > 0.6) { const l = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.6, 0.08, b.w * 0.6), new THREE.MeshBasicMaterial({ color: "#e8590c" })); l.position.set(b.x, b.h + 0.16, b.z); scene.add(l); }
  }
}

// ---- rain ---------------------------------------------------------------------------------
const DROPS = still ? 0 : 1800, rainPos = new Float32Array(DROPS * 6);
const rain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#8d99a1", transparent: true, opacity: 0.45 }));
rain.geometry.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
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

// ---- walkers: who landed lines lately, and the visitors here with you ------------------
function avatar(who, agent) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: agent ? "#16191c" : "#f4f4f2", roughness: 0.4, metalness: agent ? 0.6 : 0 }));
  body.position.y = 0.75;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: "#e8590c" }));
  visor.position.set(0, 1.25, -0.24);
  const tag = label(`@${who}`, agent ? "#ffffff" : "#e8590c", agent ? "rgba(10,10,10,.85)" : "rgba(255,255,255,.92)");
  tag.scale.set(3, 0.38, 1); tag.position.y = 2;
  g.add(body, visor, tag);
  scene.add(g);
  return g;
}
const walkers = city.present.map((p, i) => {
  const at = towers.find((t) => t.userData.repo === p.repo && t.userData.path === p.path) ?? towers[i % Math.max(1, towers.length)];
  const g = avatar(p.who, p.who.startsWith("agent-"));
  return { g, cx: at ? at.position.x : 0, cz: at ? at.position.z : 0, r: 1.9 + (i % 3) * 0.2, phase: i * 1.7, speed: 0.25 + (i % 4) * 0.05 };
});
function updateWalkers(time) {
  for (const w of walkers) {
    // A slow lap of the building they have open.
    const a = w.phase + (still ? 0 : time * w.speed);
    w.g.position.set(w.cx + Math.cos(a) * w.r, 0.12, w.cz + Math.sin(a) * w.r);
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
      v.to.set(m.p[0], 0.12, m.p[2]); v.yaw = m.yaw; v.seen = performance.now();
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
const player = { pos: new THREE.Vector3(0, EYE, extent + 6), yaw: 0, pitch: 0 };
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
  for (const t of towers) {
    const { x, z, w } = t.userData, r = w / 2 + 0.3;
    const dx = player.pos.x - x, dz = player.pos.z - z;
    if (Math.abs(dx) < r && Math.abs(dz) < r) {
      if (r - Math.abs(dx) < r - Math.abs(dz)) player.pos.x = x + Math.sign(dx || 1) * r;
      else player.pos.z = z + Math.sign(dz || 1) * r;
    }
  }
}
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
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (ws?.readyState === 1 && now - lastSent > 100) { lastSent = now; ws.send(JSON.stringify({ t: "pos", p: [player.pos.x, 0, player.pos.z], yaw: player.yaw })); }
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
  const r = extent * 1.9, a = still ? 0.8 : time * 0.04;
  camera.position.set(Math.cos(a) * r, extent * 0.9, Math.sin(a) * r);
  camera.lookAt(0, 2, 0);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000), time = now / 1000;
  prev = now;
  if (walking) updateWalk(dt, now); else updateSkyline(time);
  updateWalkers(time);
  updateVisitors(dt);
  updateRain(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
