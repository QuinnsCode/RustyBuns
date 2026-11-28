// Agent Galaxy's one 3D scene: every plot's land butted straight against the next, with no streets or fences, people as
// robots (robot.ts), and a cloud over everything but your own land that lifts as you arrive. A plot shows its land as shapes
// (land.ts), else its picture laid on the ground, else bare grass. The sky, light, fog and weather blend to the mood of
// whichever land you stand on, and lights bloom (air.ts). Loaded only when the galaxy is opened (three.js).
import { field } from "@rustybuns/util/guard";
import * as THREE from "three";
import { airs, effects } from "./air.ts";
import type { Look } from "./galaxy.ts";
import { DAY, isGround, type Land, landFrom, type Mood, type Part, PLOT } from "./land.ts";
import { robot } from "./robot.ts";
import type { Point } from "./sign.ts";
import { signBoard } from "./signBoard.ts";
import type { Page } from "./page.ts";
import { SAID_KEY, worldDoc } from "./world.ts";

// ---------- asking a world for its land ----------

/** Run a world in a hidden sealed frame, ask it for its land and take the frame away. Null for a world that isn't
 *  built with the kit, or that doesn't answer. */
export function landOf(page: Page, ms = 20_000): Promise<Land | null> {
  if (!Object.values(page.files).some((t) => t.includes("@world/kit"))) return Promise.resolve(null);
  const frame = document.createElement("iframe");
  // The same seal as the page's own world frame: scripts only, an opaque origin.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("title", "Reading a world's shapes");
  frame.setAttribute("aria-hidden", "true");
  frame.className = "galaxy-reader";
  return new Promise((done) => {
    let again: ReturnType<typeof setInterval> | undefined;
    const finish = (land: Land | null) => {
      clearTimeout(late); clearInterval(again); removeEventListener("message", hear); frame.remove(); done(land);
    };
    const hear = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && field(e.data, SAID_KEY) === true && field(e.data, "kind") === "land") finish(landFrom(field(e.data, "land")));
    };
    const late = setTimeout(() => finish(null), ms);
    addEventListener("message", hear);
    // Its modules have run once it has loaded; ask until it answers, for a world that builds a moment later.
    frame.addEventListener("load", () => {
      again = setInterval(() => frame.contentWindow?.postMessage({ agentworld: true, ask: "land" }, "*"), 500);
    });
    frame.srcdoc = worldDoc(page);
    document.body.append(frame);
  });
}

// ---------- the scene ----------

export type Content =
  | { kind: "land"; land: Land }
  | { kind: "picture"; url: string }
  | { kind: "town" }
  | { kind: "open"; sign: boolean };

export interface Person { id: string; look: Look; x: number; z: number; me: boolean }

const GRASS = "#6f9e45";
const mat = (color: string, opacity = 1) => new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity });
const mesh = (g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(g, mat(color)); m.position.set(x, y, z); return m; };
const flat = (material: THREE.Material, y = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(PLOT, PLOT).rotateX(-Math.PI / 2), material); m.position.y = y; return m; };

/** A texture drawn on a canvas of our own. */
function painted(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext("2d")!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A part's look: smooth where its corners are shared, glowing if it says so; a see-through glow adds its light (a wet
 *  street's shine). */
function look({ c, o = 1, e = 0 }: Part) {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide, transparent: o < 1, opacity: o });
  if (e) { m.emissive.set(c); m.emissiveIntensity = e; }
  if (o < 1 && e) { m.blending = THREE.AdditiveBlending; m.depthWrite = false; }
  return m;
}

function shapes(land: Land) {
  const group = new THREE.Group(), grounds: THREE.Mesh[] = [];
  for (const part of land.parts) {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(part.p, 3));
    if (part.i) g.setIndex(part.i);
    g.computeVertexNormals();
    const material = look(part);
    // Lights and glass cast no shadow, and neither does a meadow of tiny copies.
    const casts = !part.e && (part.o ?? 1) === 1 && !(part.m && part.m.length / 16 > 400);
    let m: THREE.Mesh;
    if (part.m) {
      const many = new THREE.InstancedMesh(g, material, part.m.length / 16), one = new THREE.Matrix4();
      for (let i = 0; i < many.count; i++) many.setMatrixAt(i, one.fromArray(part.m, i * 16));
      m = many;
    } else m = new THREE.Mesh(g, material);
    m.castShadow = casts;
    m.receiveShadow = true;
    group.add(m);
    if (!part.m && isGround(part)) grounds.push(m);
  }
  // A world that put no ground down gets grass, so there is never a hole between neighbours.
  if (!grounds.length) group.add(flat(mat(GRASS), -0.05));
  return { group, grounds };
}

/** The common town in the middle of the map: ours, nobody's. */
function town() {
  const group = new THREE.Group();
  group.add(flat(mat("#9a948a")));
  const walls = ["#c96f4a", "#5b8fb0", "#d9b44a", "#8d6bb0"];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (Math.abs(i) < 1 && Math.abs(j) < 1) continue;
    const tall = 10 + ((i * 7 + j * 13 + 40) % 5) * 3, x = i * 34, z = j * 34;
    group.add(mesh(new THREE.BoxGeometry(16, tall, 14), walls[(i + j + 8) % 4]!, x, tall / 2, z));
    const roof = mesh(new THREE.ConeGeometry(13, 7, 4), "#8c3b2e", x, tall + 3.5, z);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  }
  return group;
}

/** Open land, with the invite sign on the ones next to you. */
function open(sign: boolean) {
  const group = new THREE.Group();
  group.add(flat(mat("#8aa85a")));
  // Tufts only on the open plots next to you: dozens more lie out in the haze.
  if (!sign) return group;
  const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 2, 4).translate(0, 0.9, 0), mat("#6f9440"), 500), one = new THREE.Object3D();
  for (let i = 0; i < tufts.count; i++) {
    one.position.set(((i * 73.31) % 194) - 97, 0, ((i * i * 7.77 + i * 31.7) % 194) - 97);
    one.scale.setScalar(0.6 + ((i * 13) % 9) / 10);
    one.updateMatrix();
    tufts.setMatrixAt(i, one.matrix);
  }
  group.add(tufts);
  const board = new THREE.Sprite(new THREE.SpriteMaterial({ map: painted(512, 160, (c) => {
    c.fillStyle = "#8a5a33"; c.fillRect(0, 0, 512, 160);
    c.fillStyle = "#fff4e0"; c.font = "600 46px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("Invite someone", 256, 52); c.fillText("to build here", 256, 110);
  }) }));
  board.scale.set(34, 10.6, 1); board.position.y = 14;
  group.add(board, mesh(new THREE.BoxGeometry(1.6, 10, 1.6), "#6b4426", 0, 5, 0));
  return group;
}

const dispose = (o: THREE.Object3D) => o.traverse((c) => {
  if (c instanceof THREE.Mesh) c.geometry.dispose();
  if (c instanceof THREE.Mesh || c instanceof THREE.Sprite) for (const m of [c.material].flat()) {
    if (m instanceof THREE.MeshBasicMaterial || m instanceof THREE.SpriteMaterial) m.map?.dispose();
    m.dispose();
  }
});

export function scene3d(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 2400);
  const air = airs(canvas, scene, camera);

  const plots = new Map<string, { at: THREE.Group; shows: string; grounds: THREE.Mesh[]; mood: Mood; live: ((t: number) => void) | null }>();
  // Each player's robot, the look it was built from, and where it last stood (it faces the way it walks).
  const people = new Map<string, { g: THREE.Group; as: string; x: number; z: number }>();
  // Your robot is also drawn on this layer, alone and over everything, while you build it.
  const SELF = 1;
  for (const light of air.lights) light.layers.enable(SELF);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  /** The signs standing on plots, apart from the plots' own content, which comes and goes. `on` is the content a sign's height was read from. */
  const signs = new Map<string, { at: THREE.Group; on: THREE.Group | undefined }>();

  // The cloud: soft puffs laid around your own land.
  const cloud = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, map: painted(128, 128, (c) => {
    const soft = c.createRadialGradient(64, 64, 8, 64, 64, 64);
    soft.addColorStop(0, "rgba(255,255,255,1)"); soft.addColorStop(0.6, "rgba(248,251,255,.92)"); soft.addColorStop(1, "rgba(248,251,255,0)");
    c.fillStyle = soft; c.fillRect(0, 0, 128, 128);
  }) });
  const clouds = new THREE.Group();
  for (let x = -600; x <= 600; x += 75) for (let z = -600; z <= 600; z += 75) {
    if (Math.max(Math.abs(x), Math.abs(z)) < PLOT / 2 + 20) continue;
    const n = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1;
    const puff = new THREE.Sprite(cloud);
    puff.position.set(x + n * 20 - 10, 14 + n * 22, z + n * 16 - 8);
    puff.scale.setScalar(155 + n * 45);
    clouds.add(puff);
  }
  scene.add(clouds);

  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
  /** The ground's height at a spot, from that plot's own ground. */
  const heightAt = (x: number, z: number) => {
    const plot = plots.get(`${Math.floor(x / PLOT)},${Math.floor(z / PLOT)}`);
    if (!plot?.grounds.length) return 0;
    ray.set(new THREE.Vector3(x, 400, z), down);
    return ray.intersectObjects(plot.grounds, false)[0]?.point.y ?? 0;
  };

  function person(p: Person, as: string) {
    const g = robot(p.look);
    if (p.me) {
      const arrow = mesh(new THREE.ConeGeometry(0.8, 1.4, 4), "#ffffff", 0, 8.4, 0);
      arrow.rotation.x = Math.PI;
      arrow.name = "marker";
      g.add(arrow);
      g.traverse((c) => c.layers.enable(SELF));
    }
    // Facing south, toward the camera, until it walks.
    g.rotation.y = Math.PI;
    scene.add(g);
    return { g, as, x: p.x, z: p.z };
  }
  const gone = (id: string) => { const had = people.get(id)!; scene.remove(had.g); dispose(had.g); people.delete(id); };

  let size = "";
  return {
    /** Stand this signature on the plot at (x, y), a little north-west of its middle; null takes the sign away. */
    setSign(x: number, y: number, strokes: readonly Point[][] | null) {
      const k = `${x},${y}`, had = signs.get(k);
      if (had) { scene.remove(had.at); dispose(had.at); signs.delete(k); }
      if (!strokes) return;
      const at = signBoard(strokes);
      at.position.set((x + 0.5) * PLOT - 11, 0, (y + 0.5) * PLOT - 26);
      at.visible = false;
      scene.add(at);
      signs.set(k, { at, on: undefined });
    },
    /** Where the foot of that plot's sign is on screen, in CSS pixels; null when it isn't in view. */
    signSpot(x: number, y: number): { x: number; y: number } | null {
      const s = signs.get(`${x},${y}`);
      if (!s?.at.visible) return null;
      const p = s.at.position.clone().add(new THREE.Vector3(0, 3.5, 0)).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.9) return null;
      return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
    },
    /** What the plot at (x, y) shows. `shows` names it, so the same thing isn't built twice. */
    setPlot(x: number, y: number, shows: string, content: Content) {
      const k = `${x},${y}`, had = plots.get(k);
      if (had?.shows === shows) return;
      if (had) { scene.remove(had.at); dispose(had.at); }
      const at = new THREE.Group();
      at.position.set((x + 0.5) * PLOT, 0, (y + 0.5) * PLOT);
      let grounds: THREE.Mesh[] = [];
      if (content.kind === "land") { const made = shapes(content.land); at.add(made.group); grounds = made.grounds; }
      else if (content.kind === "town") at.add(town());
      else if (content.kind === "open") at.add(open(content.sign));
      else {
        const material = new THREE.MeshBasicMaterial({ color: GRASS });
        at.add(flat(material));
        // No picture yet (404) leaves the grass.
        new THREE.TextureLoader().load(content.url, (t) => { t.colorSpace = THREE.SRGBColorSpace; material.map = t; material.color.set("#ffffff"); material.needsUpdate = true; });
      }
      const mood = (content.kind === "land" && content.land.mood) || DAY;
      const live = effects(mood);
      if (live) at.add(live.group);
      scene.add(at);
      plots.set(k, { at, shows, grounds, mood, live: live?.tick ?? null });
    },
    shows: () => Object.fromEntries([...plots].map(([k, v]) => [k, v.shows.split(":")[0]!])),
    /** The weather you are in (the mood of the land you stand on) and how fast the last frames came. */
    air: () => air.now(),
    /** Draw: everyone where they are (in plots), under the cloud over `home` at lift 0, behind you at lift 1.
     *  `building` is the height of the robot builder over the bottom of the screen: your robot turns to face you in the
     *  space above it. */
    draw(w: number, h: number, folk: readonly Person[], cam: { x: number; z: number }, home: { x: number; y: number }, lift: number, building: number | null = null) {
      if (size !== `${w}x${h}`) { size = `${w}x${h}`; air.size(w, h); camera.aspect = w / h || 1; camera.fov = camera.aspect < 1 ? 66 : 55; camera.updateProjectionMatrix(); }
      const e = lift * lift * (3 - 2 * lift), mix = (a: number, b: number) => a + (b - a) * e;
      const hx = (home.x + 0.5) * PLOT, hz = (home.y + 0.5) * PLOT;
      clouds.position.set(hx, e * 130, hz);
      clouds.visible = e < 1;
      cloud.opacity = 1 - e;
      for (const [k, plot] of plots) plot.at.visible = e > 0.02 || k === `${home.x},${home.y}`;
      for (const id of people.keys()) if (!folk.some((p) => p.id === id)) gone(id);
      const t = still.matches ? 0 : performance.now() / 1000;
      let me: THREE.Group | null = null;
      for (const p of folk) {
        const as = Object.values(p.look).join();
        let had = people.get(p.id);
        if (had && had.as !== as) {
          const heading = had.g.rotation.y;
          gone(p.id);
          had = person(p, as);
          had.g.rotation.y = heading;
        }
        had ??= person(p, as);
        people.set(p.id, had);
        if (Math.hypot(p.x - had.x, p.z - had.z) > 1e-4) had.g.rotation.y = Math.atan2(had.x - p.x, had.z - p.z);
        had.x = p.x; had.z = p.z;
        const x = p.x * PLOT, z = p.z * PLOT;
        had.g.position.set(x, heightAt(x, z), z);
        had.g.visible = p.me || e > 0.5;
        const spins = had.g.getObjectByName("spins");
        if (spins) spins.rotation.y = t * 14;
        if (p.me) {
          me = had.g;
          if (building !== null) had.g.rotation.y = Math.PI + Math.sin(t * 0.8) * 0.35;
          had.g.getObjectByName("marker")!.visible = building === null;
        }
      }
      for (const [k, s] of signs) {
        const on = plots.get(k)?.at;
        if (on && on !== s.on) { on.updateMatrixWorld(true); s.at.position.y = heightAt(s.at.position.x, s.at.position.z); s.on = on; }
        s.at.visible = e > 0.5;
      }
      const x = cam.x * PLOT, z = cam.z * PLOT, y = heightAt(x, z);
      // A tall screen stands further back, so as much land is across it.
      const back = 1 / Math.min(1, Math.max(0.6, camera.aspect));
      camera.position.set(mix(hx, x), mix(215 * back, y + 17 * back), mix(hz + 215 * back, z + 36 * back));
      camera.lookAt(mix(hx, x), mix(0, y + 6), mix(hz + 8, z - 12));
      if (building === null || !me) {
        camera.clearViewOffset();
        // Above the cloud it is your own land's air; down on the ground, that of the land under your feet.
        const under = e < 0.5 ? `${home.x},${home.y}` : `${Math.floor(x / PLOT)},${Math.floor(z / PLOT)}`;
        for (const plot of plots.values()) if (plot.at.visible) plot.live?.(t);
        air.draw(plots.get(under)?.mood ?? DAY, new THREE.Vector3(x, y, z), e);
        return;
      }
      // Close in front of your robot, the picture slid up so it stands in the middle of what the builder leaves free.
      const room = Math.max(120, h - building), far = Math.max(13, (10 * h) / (room * 1.04));
      camera.position.set(me.position.x, me.position.y + 3.6 + far * 0.22, me.position.z + far);
      camera.lookAt(me.position.x, me.position.y + 3.6, me.position.z);
      camera.setViewOffset(w, h, 0, building / 2, w, h);
      // Again over the top, so nothing a world built can stand in front of it.
      if (air.draw(plots.get(`${Math.floor(x / PLOT)},${Math.floor(z / PLOT)}`)?.mood ?? DAY, me.position, 1)) air.over(SELF);
    },
    dispose() {
      dispose(scene);
      air.dispose();
    },
  };
}
export type Scene3d = ReturnType<typeof scene3d>;
