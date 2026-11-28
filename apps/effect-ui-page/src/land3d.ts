// Agent Galaxy's one 3D scene: every plot's land butted straight against the next, with no streets or fences, people as
// simple shapes, and a cloud over everything but your own land that lifts as you arrive. A plot shows its land as shapes
// (land.ts), else its picture laid on the ground, else bare grass. Loaded only when the galaxy is opened (three.js).
import { field } from "@rustybuns/util/guard";
import * as THREE from "three";
import { isGround, type Land, landFrom, PLOT } from "./land.ts";
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
      again = setInterval(() => frame.contentWindow?.postMessage({ agent_page: true, ask: "land" }, "*"), 500);
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

export interface Person { id: string; color: string; x: number; z: number; me: boolean }

const SKY = "#a9d4f5", GRASS = "#7fae62";
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

function shapes(land: Land) {
  const group = new THREE.Group(), grounds: THREE.Mesh[] = [];
  for (const part of land.parts) {
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(part.p, 3));
    if (part.i) g.setIndex(part.i);
    g.computeVertexNormals();
    const material = mat(part.c, part.o ?? 1);
    if (part.m) {
      const many = new THREE.InstancedMesh(g, material, part.m.length / 16), one = new THREE.Matrix4();
      for (let i = 0; i < many.count; i++) many.setMatrixAt(i, one.fromArray(part.m, i * 16));
      group.add(many);
    } else {
      const m = new THREE.Mesh(g, material);
      group.add(m);
      if (isGround(part)) grounds.push(m);
    }
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
  group.add(flat(mat("#b9a874")));
  if (!sign) return group;
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 320, 760);
  const camera = new THREE.PerspectiveCamera(55, 1, 1, 2000);
  const sun = new THREE.DirectionalLight("#fff1d6", 1.5);
  sun.position.set(60, 90, 30);
  scene.add(new THREE.HemisphereLight("#eef4ff", "#5a5030", 1.5), sun);

  const plots = new Map<string, { at: THREE.Group; shows: string; grounds: THREE.Mesh[] }>();
  const people = new Map<string, THREE.Group>();

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

  function person(p: Person) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(1.1, 1.3, 3.2, 12), p.color, 0, 1.6, 0), mesh(new THREE.SphereGeometry(1.1, 14, 10), p.color, 0, 4.1, 0));
    if (p.me) {
      const arrow = mesh(new THREE.ConeGeometry(0.8, 1.4, 4), "#ffffff", 0, 7, 0);
      arrow.rotation.x = Math.PI;
      g.add(arrow);
    }
    scene.add(g);
    return g;
  }

  let size = "";
  return {
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
      scene.add(at);
      plots.set(k, { at, shows, grounds });
    },
    shows: () => Object.fromEntries([...plots].map(([k, v]) => [k, v.shows.split(":")[0]!])),
    /** Draw: everyone where they are (in plots), under the cloud over `home` at lift 0, behind you at lift 1. */
    draw(w: number, h: number, folk: readonly Person[], cam: { x: number; z: number }, home: { x: number; y: number }, lift: number) {
      if (size !== `${w}x${h}`) { size = `${w}x${h}`; renderer.setSize(w, h, false); camera.aspect = w / h || 1; camera.updateProjectionMatrix(); }
      const e = lift * lift * (3 - 2 * lift), mix = (a: number, b: number) => a + (b - a) * e;
      const hx = (home.x + 0.5) * PLOT, hz = (home.y + 0.5) * PLOT;
      clouds.position.set(hx, e * 130, hz);
      clouds.visible = e < 1;
      cloud.opacity = 1 - e;
      for (const [k, plot] of plots) plot.at.visible = e > 0.02 || k === `${home.x},${home.y}`;
      for (const [id, g] of people) if (!folk.some((p) => p.id === id)) { scene.remove(g); dispose(g); people.delete(id); }
      for (const p of folk) {
        const g = people.get(p.id) ?? person(p);
        people.set(p.id, g);
        const x = p.x * PLOT, z = p.z * PLOT;
        g.position.set(x, heightAt(x, z), z);
        g.visible = p.me || e > 0.5;
      }
      const x = cam.x * PLOT, z = cam.z * PLOT, y = heightAt(x, z);
      // A tall screen stands further back, so as much land is across it.
      const back = 1 / Math.min(1, Math.max(0.6, camera.aspect));
      camera.position.set(mix(hx, x), mix(215 * back, y + 24 * back), mix(hz + 215 * back, z + 42 * back));
      camera.lookAt(mix(hx, x), mix(0, y + 4), mix(hz + 8, z - 12));
      renderer.render(scene, camera);
    },
    dispose() {
      dispose(scene);
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
export type Scene3d = ReturnType<typeof scene3d>;
