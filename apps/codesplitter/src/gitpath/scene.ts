// gitpath's 3D scene (three.js): the board, the commit graph laid on it, the road's events, the unicyclist and the
// camera. The whole graph is built once per file and slid toward the viewer as the history plays, so a frame is a
// move and a draw. The measures (where a note sits, how far back the camera goes) are gitpath.ts's, tested there.
import {
  AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog,
  Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, SRGBColorSpace, Scene, TextureLoader,
  SphereGeometry, TorusGeometry, Vector3, WebGLRenderer, type Object3D, type Texture,
} from "three";
import {
  AHEAD, FOV, SPACING, TILT, boardHalf, edgeSamples, edgeSlotAt, fitDistance, pathSlotAt, stackOf, worldX, worldZ,
  type Layout, type Note, type RideEvent,
} from "./gitpath.ts";
import { COLORS, SWARM, eventModel, lambert, model, pose, setBadge, unicyclist } from "./models.ts";

export interface FrameState {
  /** Commits gone by, as in gitpath.ts. */
  q: number;
  /** 1 just as a commit crosses, easing to 0. */
  flash: number;
  /** The game, when it is on: where the rider sits ahead of the strum line, and how it is balancing. */
  rider: null | {
    at: number; lean: number; crank: number; wheel: number;
    /** A spill in progress: which way, and how far through it, 0..1. */
    crash: null | { dir: number; slip: number };
  };
}

/** A branch name to hang on screen where a note is. */
export interface Tag { x: number; y: number; text: string }

const PAPER_BOARD = 0xf3efe6;
const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

/** The scene on `canvas`, or null where there is no WebGL. */
export function createScene(canvas: HTMLCanvasElement) {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  renderer.setClearColor(0xffffff, 0);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xd9cfba, 1.5), new AmbientLight(0xffffff, 0.35));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(-6, 12, 8);
  scene.add(sun);
  const camera = new PerspectiveCamera(FOV, 1.6, 0.1, 200);

  // What belongs to the board (rebuilt when the file or its width changes), what slides with the history, and what stands still.
  const still = new Group(), world = new Group();
  scene.add(still, world);
  const frets: Mesh[] = [];
  const fretMat = new MeshBasicMaterial({ color: 0xa39d8c, transparent: true, opacity: 0.55 });
  const strumMat = new MeshBasicMaterial({ color: COLORS.ink });
  const strum = new Mesh(new BoxGeometry(1, 0.1, 0.12), strumMat);
  strum.position.y = 0.08;
  const nowRing = new Mesh(new TorusGeometry(0.62, 0.05, 8, 32), new MeshBasicMaterial({ color: COLORS.ink }));
  nowRing.visible = false;
  const rider = unicyclist();
  rider.group.scale.setScalar(0.62);
  rider.group.visible = false;
  const shadow = new Mesh(new CircleGeometry(0.8, 20), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.04; shadow.visible = false;
  scene.add(rider.group, shadow);

  let notes: Note[] = [];
  let lay: Layout | null = null;
  let half = boardHalf(0);
  let coins: Object3D[] = [];
  /** The leaves on each note's limb (side lanes only), shown with its coin. */
  let foliage: (Object3D | null)[] = [];
  let road: { e: RideEvent; m: Object3D }[] = [];
  let aspect = 1.6;
  const disposables: BufferGeometry[] = [];
  const leafGeo = new SphereGeometry(0.13, 7, 5);

  function clearBoard() {
    still.clear(); world.clear(); frets.length = 0; coins = []; foliage = []; road = [];
    for (const g of disposables.splice(0)) g.dispose();
  }

  /** A few leaves round where note `i` sits on its limb, each turned and sized by the hash so no two clumps match. */
  function leaves(n: Note, slot: number): Object3D {
    const g = new Group();
    const seed = parseInt(n.hash.slice(0, 6) || "0", 16) || n.i * 7919;
    const count = 2 + (seed % 3);
    for (let k = 0; k < count; k++) {
      const h = (seed >> (k * 4)) & 255, l = new Mesh(leafGeo, lambert(k % 3 === 2 ? COLORS.orange : COLORS.leaf));
      l.position.set(worldX(slot) + ((h / 255) - 0.5) * 1.1, 0.12 + (k % 2) * 0.08, worldZ(n.i) + (((h >> 3) / 31) - 0.5) * SPACING * 0.8);
      l.scale.set(1.3, 0.35, 0.8);
      l.rotation.y = (h / 255) * Math.PI;
      g.add(l);
    }
    return g;
  }

  function frame3d() {
    const d = fitDistance(half, aspect);
    camera.aspect = aspect;
    camera.position.set(0, d * Math.sin((TILT * Math.PI) / 180), d * Math.cos((TILT * Math.PI) / 180));
    camera.lookAt(0, 0.6, -AHEAD * SPACING * 0.3);
    camera.updateProjectionMatrix();
    scene.fog = new Fog(0xffffff, d * 0.95, d + AHEAD * SPACING * 1.1);
  }

  /** One flat ribbon through the sampled points of every edge in `edges`, as a single mesh. */
  function ribbons(edges: { lo: number; hi: number }[], width: number, y: number, color: number) {
    const pos: number[] = [], idx: number[] = [];
    for (const e of edges) {
      const pts = edgeSamples(lay!, e).map((t) => new Vector3(worldX(edgeSlotAt(lay!, e, t)), y, worldZ(t)));
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]!, b = pts[k + 1]!;
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
        const base = pos.length / 3;
        pos.push(a.x - nx, y, a.z - nz, a.x + nx, y, a.z + nz, b.x - nx, y, b.z - nz, b.x + nx, y, b.z + nz);
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    disposables.push(geo);
    const m = new Mesh(geo, new MeshBasicMaterial({ color, side: DoubleSide }));
    m.frustumCulled = false;
    return m;
  }

  function coin(n: Note): Object3D {
    const hot = lay!.onHot[n.i];
    const g = new Group();
    const piece = stackOf(n.subject);
    const scale = 0.55 + 0.7 * n.size;
    if (piece) {
      const m = model(piece);
      m.scale.setScalar(1.15 * (0.8 + 0.5 * n.size));
      g.add(m);
      g.position.y = 0.75 * m.scale.y;
      // A ring on the board under it says whether it is on the hot path.
      const ring = new Mesh(new TorusGeometry(0.6, 0.05, 8, 28), lambert(hot ? COLORS.orange : COLORS.grey));
      ring.rotation.x = Math.PI / 2; ring.position.y = -g.position.y + 0.06;
      g.add(ring);
      return g;
    }
    const face = n.kind === "remove" ? 0xe2e2e2 : COLORS.orangeLight;
    const body = new MeshLambertMaterial({ color: face });
    if (n.size > 0.3) { body.emissive = new Color(n.kind === "remove" ? 0x666666 : COLORS.orange); body.emissiveIntensity = 0.18 * n.size; }
    const disc = new Mesh(new CylinderGeometry(0.5, 0.5, 0.16, 32), body);
    disc.rotation.x = Math.PI / 2;
    g.add(disc);
    if (n.kind === "rewrite") {
      const part = new Mesh(new CylinderGeometry(0.5, 0.5, 0.18, 32, 1, false, 0, Math.PI * 2 * n.addShare), lambert(COLORS.orangeLight));
      part.rotation.x = Math.PI / 2;
      g.add(part);
    }
    g.add(new Mesh(new TorusGeometry(0.5, hot ? 0.07 : 0.045, 8, 32), lambert(hot ? COLORS.orange : n.kind === "remove" ? 0x8f8f8f : 0xb9b4a6)));
    disposables.push(disc.geometry);
    g.scale.setScalar(scale);
    g.position.y = 0.5 * scale + 0.06;
    g.rotation.x = -0.55;
    return g;
  }

  function setGraph(ns: Note[], layout: Layout, hotEdges: Set<string>, events: RideEvent[]) {
    clearBoard();
    notes = ns; lay = layout;
    half = boardHalf(layout.extent);
    const length = (AHEAD + 8) * SPACING + 20;
    const floor = new Mesh(new BoxGeometry(half * 2, 0.1, length), new MeshLambertMaterial({ color: PAPER_BOARD }));
    floor.position.set(0, -0.06, -length / 2 + 8);
    disposables.push(floor.geometry);
    still.add(floor);
    for (const x of [-half, half]) {
      const rail = new Mesh(new BoxGeometry(0.16, 0.22, length), lambert(0x8a8578));
      rail.position.set(x, 0.05, -length / 2 + 8);
      disposables.push(rail.geometry);
      still.add(rail);
    }
    const fretGeo = new BoxGeometry(half * 2, 0.02, 0.05);
    disposables.push(fretGeo);
    for (let m = -1; m <= AHEAD + 3; m++) { const f = new Mesh(fretGeo, fretMat); f.position.y = 0.01; still.add(f); frets.push(f); }
    strum.scale.x = half * 2 + 0.8;
    still.add(strum, nowRing);
    // The graph is a tree: the main line is the trunk, each side branch a limb in bark with leaves along it, and the hot path runs orange on top.
    const cold = layout.edges.filter((e) => !hotEdges.has(`${e.lo}-${e.hi}`));
    const onTrunk = (e: { lo: number; hi: number }) => layout.lane[e.lo] === 0 && layout.lane[e.hi] === 0;
    world.add(
      ribbons(cold.filter(onTrunk), 0.22, 0.03, 0x6e4a31),
      ribbons(cold.filter((e) => !onTrunk(e)), 0.14, 0.04, COLORS.bark),
      ribbons(layout.edges.filter((e) => hotEdges.has(`${e.lo}-${e.hi}`)), 0.2, 0.05, COLORS.orange),
    );
    coins = ns.map((n) => {
      const c = coin(n);
      c.position.x = worldX(layout.slot[n.i]!);
      c.position.z = worldZ(n.i);
      c.visible = false;
      world.add(c);
      return c;
    });
    foliage = ns.map((n) => {
      if (layout.lane[n.i] === 0) return null;
      const g = leaves(n, layout.slot[n.i]!);
      g.visible = false;
      world.add(g);
      return g;
    });
    road = events.map((e) => {
      const m = eventModel(e.kind);
      m.visible = false;
      world.add(m);
      return { e, m };
    });
    frame3d();
  }

  function setAvatar(url: string | null) {
    if (!url) { setBadge(rider, null); return; }
    new TextureLoader().load(url, (t: Texture) => { t.colorSpace = SRGBColorSpace; setBadge(rider, t); }, undefined, () => setBadge(rider, null));
  }

  function resize(w: number, h: number) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    aspect = w / Math.max(1, h);
    frame3d();
  }

  const tmp = new Vector3();
  /** Moves everything to `s`, draws, and says where the branch names go on screen. */
  function render(s: FrameState, current: number): Tag[] {
    const frac = s.q - Math.floor(s.q + 1e-9);
    world.position.z = s.q * SPACING;
    frets.forEach((f, k) => { f.position.z = -(k - 1 - frac) * SPACING; });
    // Only what is near the strum line is shown.
    const lo = Math.floor(s.q) - 2, hi = Math.ceil(s.q) + AHEAD + 2;
    coins.forEach((c, i) => { c.visible = i >= lo && i <= hi; if (foliage[i]) foliage[i]!.visible = c.visible; });
    const now = current >= 0 ? coins[current] : undefined;
    nowRing.visible = !!now && now.visible && current + 1 - s.q > -0.6;
    if (nowRing.visible) {
      nowRing.position.set(now!.position.x, 0.12, -(current + 1 - s.q) * SPACING);
      nowRing.rotation.x = Math.PI / 2;
    }
    strumMat.color.setHex(s.flash > 0 ? COLORS.orange : COLORS.ink);
    strum.scale.y = 1 + s.flash * 1.6;

    // The road's events, each coming in toward the rider as it nears: a car and a boulder from their side lane,
    // the angry car swerving across the rider's lane and on past the camera, the robots flying over to buzz round the rider.
    const r = s.rider, clock = performance.now() / 1000;
    const riderX = r ? worldX(pathSlotAt(lay!, s.q - 1 + r.at)) : 0, riderZ = r ? worldZ(s.q - 1 + r.at) : 0;
    for (const { e, m } of road) {
      const d = e.i + 1 - s.q, at = r?.at ?? 0;
      const tail = e.kind === "conflict" ? 3.5 : e.kind === "swarm" ? 7 : 0.6;
      m.visible = !!r && d <= AHEAD && d >= at - tail;
      if (!m.visible) continue;
      const come = ease(1 - (d - at) / 4), base = worldX(lay!.slot[e.i]!);
      m.position.z = worldZ(e.i);
      if (e.kind === "merge") m.position.x = base + e.side * half * (1.4 - 1.05 * come);
      else if (e.kind === "conflict") {
        // In from its lane, then across the rider's and off toward the viewer, shaking with rage the whole way.
        const pass = ease((at + 1.2 - d) / 1.8);
        m.position.x = base + e.side * half * (1.4 - 1.05 * come) - e.side * 2.4 * pass;
        m.position.z = worldZ(e.i) + pass * 7;
        m.rotation.y = Math.sin(clock * 37) * 0.07 * come + e.side * 0.35 * pass * (1 - pass) * 4;
        m.rotation.z = Math.sin(clock * 23) * 0.04 * come;
      } else if (e.kind === "swarm") {
        // The ring of robots flies from its commit over to the rider and circles there until they have had their fun.
        const hug = ease((at + 1.5 - d) / 1.5) * (1 - ease((at - 5 - d) / 2));
        m.position.x = base + (riderX - base) * hug;
        m.position.z = worldZ(e.i) + (riderZ - worldZ(e.i)) * hug;
        m.position.y = (1 - hug) * 0.4 + ease((at - 5 - d) / 2) * 6;
        m.children.forEach((bot: Object3D, k: number) => {
          const a = clock * 3.2 + (k / SWARM) * Math.PI * 2, rad = 0.9 + 0.35 * Math.sin(clock * 2 + k);
          bot.position.set(Math.cos(a) * rad, 0.5 + 0.9 * hug + 0.3 * Math.sin(clock * 7 + k * 1.7), Math.sin(a) * rad);
          bot.rotation.y = -a + Math.PI / 2;
        });
      } else if (e.kind === "squash") {
        m.position.x = base + e.side * half * (0.9 - 0.8 * come);
        m.position.y = Math.abs(Math.sin(d * 3.4)) * 0.9 * (1 - come * 0.6);
        m.rotation.z = d * 2.2 * e.side;
      } else m.position.x = base;
    }

    // The unicyclist, tipping over to one side in a spill.
    rider.group.visible = shadow.visible = !!r;
    if (r) {
      const slip = r.crash?.slip ?? 0;
      const x = worldX(pathSlotAt(lay!, s.q - 1 + r.at)) + (r.crash ? r.crash.dir * slip * 1.6 : 0);
      rider.group.position.set(x, 0, -r.at * SPACING);
      shadow.position.set(x, 0.04, -r.at * SPACING);
      pose(rider, { lean: r.lean, crank: r.crank, wheel: r.wheel, tip: r.crash ? r.crash.dir * (0.5 + 1.1 * ease(slip)) : r.lean * 0.5 });
    }
    camera.updateMatrixWorld();
    renderer.render(scene, camera);

    const tags: Tag[] = [];
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (let i = Math.max(0, lo); i <= Math.min(notes.length - 1, hi) && tags.length < 8; i++) {
      const n = notes[i]!, d = i + 1 - s.q;
      if (!n.refs.length || d < 0 || d > AHEAD * 0.75) continue;
      tmp.set(worldX(lay!.slot[i]!), 1.1, -d * SPACING).project(camera);
      tags.push({ x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h, text: n.refs[0]! });
    }
    return tags;
  }

  return { setGraph, setAvatar, resize, render };
}
