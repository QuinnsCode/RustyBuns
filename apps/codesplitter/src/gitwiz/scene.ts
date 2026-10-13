// gitwiz's 3D scene (three.js): the board, the commit graph laid on it, the runner and the camera. The whole
// graph is built once per file and slid toward the viewer as the history plays, so a frame is a move and a
// draw. The measures (where a note sits, how far back the camera goes) are gitwiz.ts's, tested there.
import {
  AmbientLight, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog,
  Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, SRGBColorSpace, Scene, TextureLoader,
  TorusGeometry, Vector3, WebGLRenderer, type Object3D, type Texture,
} from "three";
import {
  AHEAD, FOV, SPACING, TILT, boardHalf, edgeSamples, edgeSlotAt, fitDistance, pathSlotAt, runnerOffset, stackOf, worldX, worldZ,
  type Layout, type Note,
} from "./gitwiz.ts";
import { COLORS, lambert, model, pose, runner as makeRunner, setFace, type Runner } from "./models.ts";

export interface FrameState {
  /** Commits gone by, as in gitwiz.ts. */
  q: number;
  /** -1 cold .. 1 hot: how far ahead the runner runs. */
  pace: number;
  /** Radians through the stride. */
  phase: number;
  playing: boolean;
  /** 1 just as a commit crosses, easing to 0. */
  flash: number;
}

/** A branch name to hang on screen where a note is. */
export interface Tag { x: number; y: number; text: string }

const PAPER_BOARD = 0xf3efe6;

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
  const me = makeRunner();
  me.group.scale.setScalar(0.95);
  const shadow = new Mesh(new CircleGeometry(0.8, 20), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.04;
  scene.add(me.group, shadow);

  let notes: Note[] = [];
  let lay: Layout | null = null;
  let half = boardHalf(0);
  let coins: Object3D[] = [];
  let aspect = 1.6;
  const disposables: BufferGeometry[] = [];

  function clearBoard() {
    still.clear(); world.clear(); frets.length = 0; coins = [];
    for (const g of disposables.splice(0)) g.dispose();
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
      const ts = edgeSamples(lay!, e);
      const pts = ts.map((t) => new Vector3(worldX(edgeSlotAt(lay!, e, t)), y, worldZ(t)));
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
    const rim = new Mesh(new TorusGeometry(0.5, hot ? 0.07 : 0.045, 8, 32), lambert(hot ? COLORS.orange : n.kind === "remove" ? 0x8f8f8f : 0xb9b4a6));
    g.add(rim);
    disposables.push(disc.geometry);
    g.scale.setScalar(scale);
    g.position.y = 0.5 * scale + 0.06;
    g.rotation.x = -0.55;
    return g;
  }

  function setGraph(ns: Note[], layout: Layout, hotEdges: Set<string>) {
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
    still.add(strum);
    still.add(nowRing);
    const plain = layout.edges.filter((e) => !hotEdges.has(`${e.lo}-${e.hi}`));
    const hot = layout.edges.filter((e) => hotEdges.has(`${e.lo}-${e.hi}`));
    world.add(ribbons(plain, 0.1, 0.03, 0x9c9686), ribbons(hot, 0.2, 0.05, COLORS.orange));
    coins = ns.map((n) => {
      const c = coin(n);
      c.position.x = worldX(layout.slot[n.i]!);
      c.position.z = worldZ(n.i);
      c.visible = false;
      world.add(c);
      return c;
    });
    frame3d();
  }

  function setAvatar(url: string | null) {
    if (!url) { setFace(me, null); return; }
    new TextureLoader().load(url, (t: Texture) => { t.colorSpace = SRGBColorSpace; setFace(me, t); }, undefined, () => setFace(me, null));
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
    coins.forEach((c, i) => { c.visible = i >= lo && i <= hi; });
    const now = current >= 0 ? coins[current] : undefined;
    nowRing.visible = !!now && now.visible && current + 1 - s.q > -0.6;
    if (nowRing.visible) {
      nowRing.position.set(now!.position.x, 0.12, -(current + 1 - s.q) * SPACING);
      nowRing.rotation.x = Math.PI / 2;
    }
    const off = runnerOffset(s.pace);
    const slot = lay ? pathSlotAt(lay, s.q - 1 + off) : 0;
    me.group.position.set(worldX(slot), 0, -off * SPACING);
    shadow.position.set(worldX(slot), 0.04, -off * SPACING);
    pose(me, s.phase, s.playing);
    strumMat.color.setHex(s.flash > 0 ? COLORS.orange : COLORS.ink);
    strum.scale.y = 1 + s.flash * 1.6;
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

  /** What is in the scene, for poking at from the console. */
  const stats = () => {
    const r = world.children[0] as Mesh | undefined;
    r?.geometry.computeBoundingBox();
    return { world: world.children.length, ribbonVertices: r?.geometry.attributes.position.count, box: r?.geometry.boundingBox, fog: scene.fog, cam: camera.position.toArray() };
  };
  return { setGraph, setAvatar, resize, render, stats };
}
