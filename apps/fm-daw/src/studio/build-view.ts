// The studio builder's build mode (/rooms.html): your studio as a doll's house seen from above at a slant, the way a
// house-building game shows a home while you build it. The floor in what it's made of with a 50 cm grid over it; the
// outside walls cut down to a skirting on the sides toward you, so you see in, and standing full height across the
// back (or all cut down, or all up); the inside walls and booths; and each seat's real instrument from
// @rustybuns/models (the keys seat's classic poly, the bass seat's mono, the kit, the decks, the mic, the couch).
// It only draws and answers where the pointer is (`toRoom`, `hit`); page.ts holds the tools and does the edits.
import * as THREE from "three";
import { drumKit } from "@rustybuns/models/drums";
import { gear } from "@rustybuns/models/gear";
import { bassSynth, keysKind, keysSynth } from "./gear-models.ts";
import { footprint } from "./gear-wall.ts";
import { metreUV, surface, wallSurface } from "./look.ts";
import { deckHeight, inStage, thingBox, wallPieces, type Prop, type Side, type Spot, type StudioDef, type Wall } from "./room.ts";
import { stageModel } from "./stage-model.ts";
import type { Crowd } from "./stage-build.ts";
import { prop } from "./props.ts";
import { bankMounds, paStack } from "./open-air.ts";
import { firePit } from "@rustybuns/models/fire";
import { doorways } from "./doors.ts";
/** The doors' vision panels in the builder: one material for every build. */
const DOOR_GLASS = new THREE.MeshPhysicalMaterial({ color: "#bcd6e6", roughness: 0.05, transparent: true, opacity: 0.35 });
import { van } from "@rustybuns/models/van";
import { rigStacks, roomRig } from "./pa-room.ts";
import { cotton, drape, rugs, tapestry } from "./tapestry.ts";
import { wallMaterial, type Material } from "./sound.ts";
import { VenueSplat } from "./venue-splat.ts";

/** What the pointer is over. */
export type Hit = { spot: string } | { booth: string } | { wall: number } | { gear: true } | { prop: number } | { door: true } | { stack: number } | { bank: number } | { side: Side; at?: [number, number] } | { stage: true } | { floor: true } | null;
/** The room's look for a prop: what it's made of, from the look's surfaces. */
const propMat = (name: string, color: string) => surface(name, color);
/** The outside walls: cut down on the sides toward you, all cut down, or all standing. */
export type WallsMode = "cutaway" | "down" | "up";

const CUT = 0.18, ORANGE = new THREE.Color("#ff6b4a"), GLOW = new THREE.Color("#3ddc84");

/** The crowd's floor: its zone washed and edged in green, and what it holds written over it, `half` the view's half height. */
function crowdModel(crowd: Crowd, half: number): THREE.Group {
  const g = new THREE.Group(), shape = new THREE.Shape(crowd.points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const wash = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.1, depthWrite: false }));
  wash.position.y = 0.02;
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(crowd.points.map(([x, z]) => new THREE.Vector3(x, 0.03, z))), new THREE.LineBasicMaterial({ color: GLOW }));
  const c = document.createElement("canvas"); c.width = 512; c.height = 64;
  const ink = c.getContext("2d")!;
  ink.font = "600 34px system-ui, sans-serif"; ink.textAlign = "center"; ink.textBaseline = "middle";
  ink.lineWidth = 6; ink.strokeStyle = "rgba(6, 20, 12, 0.85)"; ink.fillStyle = "#8ef5ba";
  const words = `crowd ${crowd.m2.toLocaleString("en")} m² · cap ${crowd.cap.toLocaleString("en")}`;
  ink.strokeText(words, 256, 32); ink.fillText(words, 256, 32);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false, transparent: true }));
  const mid = crowd.points.reduce((t, p) => [t[0] + p[0] / crowd.points.length, t[1] + p[1] / crowd.points.length], [0, 0]);
  label.position.set(mid[0]!, 0.5, mid[1]!); label.scale.set(half, half / 8, 1); label.renderOrder = 2;
  g.add(wash, edge, label);
  return g;
}
/** A wall in what it's made of: drywall and plaster are painted (the sound table's drywall colour is the board's own grey). */
const wallLook = (m: Material) => surface(wallSurface(m), m === "drywall" || m === "plaster" ? "#d9d3c6" : undefined);

/** A seat's instrument or furniture, its front toward +z, centred on its thing's box (as the jam room draws it). */
export function spotModel(s: Spot, bass?: StudioDef["bass"], keys?: StudioDef["keys"], cloth?: number): THREE.Group {
  const g = new THREE.Group(), t = s.thing;
  const fabric = surface("fabric", t.color), steel = surface("steel", "#1b1c1f"), ply = surface("ply", "#2a2420");
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(metreUV(new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  if (s.kind === "keys") g.add(keysSynth(s, keysKind(s, undefined, keys)).synth.group);
  else if (s.kind === "bass") g.add(bassSynth(s, bass).synth.group);
  else if (s.kind === "drums") g.add(drumKit({ shell: t.color, quality: "low" }).group);
  else if (s.kind === "booth") g.add(gear("mic-stand"));
  else if (s.kind === "dj") {
    box(t.w, 0.04, t.d, ply, 0, t.h - 0.02, 0);
    // out of doors (`cloth`, the room's seed) the table wears its block-printed cloths to the sand, as the jam room has it
    if (cloth !== undefined) g.add(new THREE.Mesh(drape(t.w, t.d, t.h, cloth), cotton(tapestry({ end: t.d, front: t.w }, t.h - 0.008, cloth), cloth)));
    else box(t.w - 0.04, t.h - 0.04, 0.02, surface("fabric", "#0c0c0e"), 0, (t.h - 0.04) / 2, -t.d / 2 + 0.02);
    const front = t.d / 2 - 0.08, mixer = gear("mixer-club-4");
    mixer.position.set(0, t.h, front - 0.18); g.add(mixer);
    for (const k of [-1, 1]) { const deck = gear("deck-cd"); deck.position.set(k * 0.35, t.h, front - 0.2); g.add(deck); }
  } else if (s.kind === "desk") {
    box(t.w, 0.05, t.d, surface("wood", t.color), 0, t.h - 0.025, 0);
    for (const x of [-t.w / 2 + 0.06, t.w / 2 - 0.06]) box(0.05, t.h - 0.05, t.d - 0.1, steel, x, (t.h - 0.05) / 2, 0);
    box(t.w * 0.7, 0.08, t.d * 0.4, surface("plastic", "#1c1d20"), 0, t.h + 0.04, 0.05);
    for (const k of [-1, 1]) { const m = gear("fill-8-powered"); m.scale.setScalar(0.6); m.position.set(k * t.w * 0.42, t.h, -t.d * 0.25); g.add(m); }
  } else {
    // a couch: a seat, a back and two arms in its cloth on short legs
    box(t.w, 0.22, t.d, fabric, 0, 0.21, 0);
    box(t.w, 0.42, 0.18, fabric, 0, 0.42, -t.d / 2 + 0.09);
    for (const k of [-1, 1]) box(0.16, 0.34, t.d, fabric, k * (t.w / 2 - 0.08), 0.37, 0);
  }
  return g;
}

export class BuildView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  /** The Stage Builder's isometric view: an orthographic camera on the same scene, `dist` its half height in metres. */
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  private iso = false;
  private get camera() { return this.iso ? this.ortho : this.persp; }
  private sun = new THREE.DirectionalLight("#fff1dd", 2.2);
  private sky = new THREE.HemisphereLight("#fff4e6", "#30343a", 1.6);
  /** What is being placed (stage-page.ts), drawn in glowing outline, apart from what a rebuild frees. */
  private matrix = new THREE.Group();
  private crowd: Crowd | null = null;
  private root = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private keyed = new Map<string, THREE.Object3D>();
  private preview = new THREE.Group();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ray = new THREE.Raycaster();
  private room: StudioDef | null = null;
  private picked: string | undefined;
  private walls: WallsMode = "cutaway";
  /** The camera's turn round the room (radians), its height angle, and how far out. */
  yaw = Math.PI / 5; pitch = 0.82; dist = 14;
  private dirty = false;
  /** The captured venue round the room, when it has one (venue-splat.ts). */
  readonly venue: VenueSplat;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color("#1a1c20");
    this.scene.add(this.sky);
    const sun = this.sun;
    sun.position.set(6, 14, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 40 });
    this.scene.add(sun, this.root, this.preview, this.matrix);
    this.venue = new VenueSplat(this.scene, this.renderer);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private heatMap: HTMLCanvasElement | null = null;
  private heatTex: THREE.Texture | null = null;
  /** Draw `room`, with `picked` ringed, the outside walls as `walls` says, and `heat` (coverage.ts heatCanvas, the PA's
   *  coverage over the whole ground) on the floor when given. */
  show(room: StudioDef, picked: string | undefined, walls: WallsMode = this.walls, heat: HTMLCanvasElement | null = null) {
    const fresh = this.room?.size.w !== room.size.w || this.room?.size.d !== room.size.d;
    this.room = room; this.picked = picked; this.walls = walls; this.heatMap = heat;
    if (fresh) this.fit();
    this.build();
  }

  /** The whole arena in view, from its middle. */
  fit() {
    const room = this.room;
    if (!room) return;
    const { w, d } = room.size, aspect = this.canvas.clientWidth / (this.canvas.clientHeight || 1) || 1;
    // an isometric w by d floor is (w + d) cos 45 across and about 0.58 of that up the screen
    this.dist = this.iso ? Math.max((w + d) * 0.23 + 3, ((w + d) * 0.37) / aspect) : Math.max(w, d) * 1.15 + 4;
    this.target.set(0, 0, 0);
    // the sun's shadows reach across the arena
    const half = Math.max(16, Math.max(w, d) / 2 + 4), k = half / 16;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, far: 40 * k });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.position.set(6 * k, 14 * k, 8 * k);
  }

  /** Switch to the isometric view (the Stage Builder's), or back to the doll's house; `show` draws it. */
  isometric(on: boolean) {
    this.iso = on; this.room = null; this.crowd = null; this.ghost(null);
    // a show's pieces are black boxes: lit brighter than a room, on the builder's dark green
    this.sky.intensity = on ? 4.5 : 1.6; this.sun.intensity = on ? 3.2 : 2.2;
    this.scene.background = new THREE.Color(on ? "#0d1410" : "#1a1c20");
    this.yaw = on ? Math.PI / 4 : Math.PI / 5;
    this.pitch = on ? Math.atan(Math.SQRT1_2) : 0.82;
    this.resize();
  }

  /** The crowd's floor, drawn with its area and the people it holds. */
  crowdZone(crowd: Crowd | null) { this.crowd = crowd; }

  /** What is being placed, as a glowing green outline of `model` ("building the matrix"), or nothing. */
  ghost(model: THREE.Object3D | null) {
    this.matrix.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.LineSegments).isLineSegments) m.geometry.dispose(); });
    this.matrix.clear(); this.matrix.position.set(0, 0, 0); this.matrix.rotation.set(0, 0, 0);
    if (model) {
      const fill = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false });
      const line = new THREE.LineBasicMaterial({ color: GLOW, depthTest: false, transparent: true });
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // the model's own geometry may be a shared one: the ghost keeps its own copy to free
        const solid = new THREE.Mesh(m.geometry.clone(), fill), edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), line);
        for (const part of [solid, edges]) { part.matrixAutoUpdate = false; part.matrix.copy(m.matrixWorld); part.renderOrder = 3; this.matrix.add(part); }
      });
    }
    this.draw();
  }

  /** Slide and turn the outline: it is built once, at the middle facing front, however far it's carried. */
  ghostAt(x: number, z: number, yaw: number) {
    this.matrix.position.set(x, 0, z); this.matrix.rotation.y = yaw;
    this.draw();
  }

  /** Where a point of the room is on the canvas, pixels from its top left (the harness clicks there). */
  toScreen(x: number, y: number, z: number): [number, number] {
    this.camera.updateMatrixWorld(true);
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return [((p.x + 1) / 2) * this.canvas.clientWidth, ((1 - p.y) / 2) * this.canvas.clientHeight];
  }

  private build() {
    const room = this.room!, { w, d, h } = room.size;
    if (this.outline) { this.preview.remove(this.outline); this.outline = null; } this.hovered = null;
    // free what the last build made (the shared surfaces stay: look.ts caches them)
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) (o as THREE.Mesh).geometry.dispose(); });
    this.root.clear(); this.pickables = []; this.keyed.clear();
    // the venue loads once per file; Spark sorts its points over the next frames, so draw a few once it is in
    void this.venue.show(room.venue).then(() => { for (let i = 0; i < 30; i++) setTimeout(() => this.draw(), i * 50); });
    this.placeCamera();
    const add = (o: THREE.Object3D, key?: string, hit?: Hit) => {
      this.root.add(o);
      if (key) this.keyed.set(key, o);
      if (hit) { o.userData.hit = hit; this.pickables.push(o); }
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = c.receiveShadow = true; } });
      return o;
    };
    // the floor, in metres so its grain is its real size, and the grid over it
    const floor = new THREE.Mesh(metreUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), surface(room.materials?.floor ?? "floorboards", room.colors.floor));
    floor.receiveShadow = true;
    add(floor, undefined, { floor: true });
    const lines: number[] = [];
    // past 60 m a half metre grid is a grey wash: lines every 5 m (things still snap to 0.5 m)
    const step = Math.max(w, d) > 60 ? 5 : 0.5;
    for (let x = -Math.floor(w / 2 / step) * step; x <= w / 2 + 1e-6; x += step) lines.push(x, 0.003, -d / 2, x, 0.003, d / 2);
    for (let z = -Math.floor(d / 2 / step) * step; z <= d / 2 + 1e-6; z += step) lines.push(-w / 2, 0.003, z, w / 2, 0.003, z);
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.13, depthWrite: false }));
    this.root.add(grid);
    // the outside walls: a wall between you and the room is cut down to a skirting (in cutaway)
    const cam = this.camera.position, T = 0.14;
    const sides: [Side, number, number, number, number][] = [["front", 0, d / 2 + T / 2, w + 2 * T, T], ["back", 0, -d / 2 - T / 2, w + 2 * T, T], ["left", -w / 2 - T / 2, 0, T, d], ["right", w / 2 + T / 2, 0, T, d]];
    // the stacks you placed, indoors or out (pa-room.ts rigStacks)
    const rig = roomRig(room);
    for (const [i, st] of rigStacks(room).entries()) add(new THREE.Group().add(paStack(st, undefined, rig.stack)), `stack:${i}`, { stack: i });
    // the coverage map laid on the floor, just over the grid
    this.heatTex?.dispose(); this.heatTex = null;
    if (this.heatMap) {
      const tex = this.heatTex = new THREE.CanvasTexture(this.heatMap); tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false }));
      m.position.y = 0.012; m.renderOrder = 1; this.root.add(m);
    }
    // out of doors there are no walls: the rugs stand on the sand instead
    if (room.outdoor) {
      this.root.add(bankMounds(room.outdoor.banks ?? []));
      this.root.add(rugs(room.outdoor));
      // the fire pit and the parked vans, as the room stands them
      if (room.outdoor.fire) { const f = firePit(room.outdoor.seed + 5).group; f.position.set(room.outdoor.fire.at[0], 0, room.outdoor.fire.at[1]); this.root.add(f); }
      (room.outdoor.vans ?? []).forEach((v, i) => { const m = van(room.outdoor!.seed + 31 * i, { awning: v.awning }); m.position.set(v.at[0], 0, v.at[1]); m.rotation.y = v.yaw; this.root.add(m); });
    }
    for (const [side, x, z, sw, sd] of room.outdoor || room.venue ? [] : sides) {
      const toward = side === "front" ? cam.z > d / 2 : side === "back" ? cam.z < -d / 2 : side === "left" ? cam.x < -w / 2 : cam.x > w / 2;
      const tall = this.walls === "up" || (this.walls === "cutaway" && !toward) ? h : CUT;
      const mat = wallLook(room.materials?.walls[side] ?? "plaster");
      const o = new THREE.Mesh(metreUV(new THREE.BoxGeometry(sw, tall, sd)), mat);
      o.position.set(x, tall / 2, z);
      add(o, undefined, { side });
      // the wall's top edge, so a cut wall reads as cut
      const cap = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.002, 0.012, sd + 0.002), new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.8 }));
      cap.position.set(x, tall + 0.006, z); this.root.add(cap);
    }
    // inside walls and booths: half height in cutaway, so a booth reads as a room you can see into
    room.walls.forEach((wl, i) => {
      const tall = this.walls === "up" ? h : this.walls === "down" ? CUT : Math.min(h, 1.15);
      const mat = wl.glass ? new THREE.MeshPhysicalMaterial({ color: "#bcd6e6", roughness: 0.05, transmission: 0.85, transparent: true, opacity: 0.35 }) : wallLook(wallMaterial(wl));
      const g = new THREE.Group();
      for (const p of wallPieces(wl, 0.12)) {
        const o = new THREE.Mesh(metreUV(new THREE.BoxGeometry(p.hw * 2, tall, p.hd * 2)), mat);
        o.position.set(p.cx, tall / 2, p.cz); o.rotation.y = p.turn; g.add(o);
      }
      if (!wl.booth) { add(g, `wall:${i}`, { wall: i }); return; }
      // a booth's four walls in one group, so they slide together while it's dragged
      const k = `booth:${wl.booth}`, holder = this.keyed.get(k) ?? add(new THREE.Group(), k);
      g.userData.hit = { booth: wl.booth }; this.pickables.push(g);
      g.traverse((c) => { c.castShadow = c.receiveShadow = true; });
      holder.add(g);
    });
    // the doors in those walls, as tall as the walls are cut, their swing on the floor below the door's height (doors.ts)
    const cutH = this.walls === "up" ? h : this.walls === "down" ? CUT : Math.min(h, 1.15);
    const doorLook = { wallOf: (wl: Wall) => wallLook(wallMaterial(wl)), casing: surface("wood", room.colors.trim), leaf: surface("wood", "#6e5034"), lever: surface("metal", "#b9bcc0"), glass: DOOR_GLASS };
    this.root.add(doorways({ ...room, walls: room.walls.filter((wl) => !wl.booth) }, h, doorLook, cutH));
    // a booth's doors ride with its walls while it's dragged
    for (const id of new Set(room.walls.flatMap((wl) => (wl.booth ? [wl.booth] : [])))) {
      this.keyed.get(`booth:${id}`)?.add(doorways({ ...room, walls: room.walls.filter((wl) => wl.booth === id) }, h, doorLook, cutH));
    }
    // the gear wall's corner, a pad on the floor with its rack along the long side
    const fp = footprint(room), shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
    const pad = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#c98a3a", transparent: true, opacity: 0.28, depthWrite: false }));
    pad.position.y = 0.006;
    const gearG = new THREE.Group(); gearG.add(pad);
    const [a, b] = [fp[0]!, fp[1]!], rack = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]), 1.6, 0.5), surface("tolex", "#1a1a1a"));
    rack.position.set((a[0] + b[0]) / 2, 0.8, (a[1] + b[1]) / 2); rack.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    gearG.add(rack);
    // the Stage Builder places an arena's big pieces: no gear wall or way in to look at
    if (!this.iso) add(gearG, "gear", { gear: true });
    // the way in: a chevron on the floor
    const [dx, dz] = room.door.at, chev = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 3, 1, -Math.PI / 6, Math.PI * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ORANGE }));
    chev.position.set(dx, 0.01, dz); chev.rotation.y = room.door.yaw;
    const doorG = new THREE.Group(); doorG.add(chev); if (!this.iso) add(doorG, "door", { door: true });
    if (room.stage) add(stageModel(room.stage, this.iso), "stage", { stage: true });
    if (this.crowd) this.root.add(crowdModel(this.crowd, this.iso ? this.dist * Math.min(1, this.persp.aspect * 1.1) : 10));
    // the set dressing, as the jam room draws it (props.ts)
    // (each in a holder at the origin, so a drag slides the holder)
    (room.props ?? []).forEach((p, i) => { const holder = new THREE.Group(); holder.add(prop(p, propMat)); add(holder, `prop:${i}`, { prop: i }); });
    // the seats: each instrument on its box, a disc where you sit, a ring round the picked one
    for (const s of room.spots) {
      const g = new THREE.Group(), b = thingBox(s), model = spotModel(s, room.bass, room.keys, room.outdoor?.seed);
      // on the stage, on its deck
      const up = room.stage && inStage(room.stage, s.at[0], s.at[1]) ? deckHeight(room.stage) : 0;
      model.position.set(b.cx, up, b.cz); model.rotation.y = b.turn;
      g.add(model);
      const seat = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: s.id === this.picked ? ORANGE : new THREE.Color("#c9ccd2"), transparent: true, opacity: 0.7 }));
      seat.position.set(s.at[0], 0.008, s.at[1]); if (!this.iso) g.add(seat);
      if (s.id === this.picked) {
        const r = Math.hypot(b.hw, b.hd) + 0.12, ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.05, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ORANGE }));
        ring.position.set(b.cx, 0.01, b.cz); g.add(ring);
      }
      add(g, `spot:${s.id}`, { spot: s.id });
    }
    // where everything is now, before the next frame draws it: a click right after an edit picks what's there
    this.scene.updateMatrixWorld(true);
    this.draw();
  }

  private placeCamera() {
    // a tall, narrow view (a phone) stands further back, so the whole room still fits across it
    const aspect = this.persp.aspect;
    if (this.iso) {
      Object.assign(this.ortho, { left: -this.dist * aspect, right: this.dist * aspect, top: this.dist, bottom: -this.dist });
      this.ortho.updateProjectionMatrix();
    }
    const c = Math.cos(this.pitch), r = this.iso ? 600 : this.dist * Math.max(1, 1 / aspect) ** 0.8;
    const o = this.target;
    this.camera.position.set(o.x + Math.sin(this.yaw) * c * r, Math.sin(this.pitch) * r, o.z + Math.cos(this.yaw) * c * r);
    this.camera.lookAt(o);
  }

  /** Turn the camera round the room (radians), tilt it, or move in (k < 1) and out. */
  /** The point on the floor the camera turns round and looks at: the room's middle until a zoom moves it. */
  private target = new THREE.Vector3();
  /** Zoom by `k` toward the floor under the pointer (`at`, metres), as a house builder does; the view's middle stays in the room. */
  zoomAt(k: number, at: [number, number] | null) {
    if (at && this.room) {
      const { w, d } = this.room.size, pull = 1 - Math.min(1, k);
      this.target.x = Math.max(-w / 2, Math.min(w / 2, this.target.x + (at[0] - this.target.x) * pull));
      this.target.z = Math.max(-d / 2, Math.min(d / 2, this.target.z + (at[1] - this.target.z) * pull));
    }
    if (k > 1) this.target.multiplyScalar(Math.max(0, 2 - k)); // zooming out drifts back toward the middle
    this.orbit(0, 0, k);
  }

  orbit(dyaw: number, dpitch = 0, k = 1) {
    this.yaw += dyaw; this.pitch = Math.min(1.45, Math.max(0.35, this.pitch + dpitch));
    const room = this.room, far = room ? Math.max(room.size.w, room.size.d) * 2.5 + 6 : 40;
    this.dist = Math.min(far, Math.max(3, this.dist * k));
    if (!this.room) return;
    // turning only needs a rebuild when a different outside wall comes between you and the room (it's cut down)
    const before = this.facing();
    this.placeCamera();
    if (this.facing() !== before) this.build(); else this.draw();
  }

  /** Which outside walls stand between the camera and the room, as a key. */
  private facing(): string {
    const r = this.room, c = this.camera.position;
    if (!r) return "";
    const { w, d } = r.size;
    return [c.z > d / 2, c.z < -d / 2, c.x < -w / 2, c.x > w / 2].map(Number).join("");
  }

  /** Slide a seat, a booth or the gear wall by (dx, dz) while it is dragged (`spot:<id>`, `booth:<id>`, `gear`). */
  nudge(key: string, dx: number, dz: number) {
    const o = this.keyed.get(key);
    if (o) { o.position.set(dx, 0, dz); o.updateMatrixWorld(true); this.draw(); }
  }

  private outline: THREE.Box3Helper | null = null;
  private hovered: string | null = null;
  /** Outline what the pointer is over (a hit's key: `spot:<id>`, `prop:<i>`, `wall:<i>`, `booth:<id>`, `gear`, `door`), or nothing. */
  hover(hit: Hit) {
    const key = !hit ? null : "spot" in hit ? `spot:${hit.spot}` : "prop" in hit ? `prop:${hit.prop}` : "wall" in hit ? `wall:${hit.wall}` : "booth" in hit ? `booth:${hit.booth}` : "gear" in hit ? "gear" : "door" in hit ? "door" : "stage" in hit ? "stage" : "stack" in hit ? `stack:${hit.stack}` : null;
    if (key === this.hovered) return;
    this.hovered = key;
    if (this.outline) { this.preview.remove(this.outline); this.outline.dispose(); this.outline = null; }
    const o = key ? this.keyed.get(key) : null;
    if (o) {
      const box = new THREE.Box3().setFromObject(o).expandByScalar(0.03);
      this.outline = new THREE.Box3Helper(box, ORANGE);
      this.preview.add(this.outline);
    }
    this.draw();
  }

  /** The wall being drawn, from `a` to `b`, or none. */
  drawing(a: [number, number] | null, b?: [number, number]) {
    this.preview.clear(); this.outline = null; this.hovered = null;
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), tall = this.walls === "up" ? (this.room?.size.h ?? 2.6) : 1.15;
      const o = new THREE.Mesh(new THREE.BoxGeometry(len, tall, 0.12), new THREE.MeshStandardMaterial({ color: ORANGE, transparent: true, opacity: 0.55 }));
      o.position.set((a[0] + b[0]) / 2, tall / 2, (a[1] + b[1]) / 2); o.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      this.preview.add(o);
    }
    this.draw();
  }

  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  /** Where on the floor the pointer is, metres (x, z), or null off the floor's plane. */
  toRoom(e: { clientX: number; clientY: number }): [number, number] | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const p = this.ray.ray.intersectPlane(this.floor, new THREE.Vector3());
    return p ? [p.x, p.z] : null;
  }
  /** What the pointer is over: a seat, a booth, an inside wall, the gear wall, or nothing. */
  hit(e: { clientX: number; clientY: number }): Hit {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    // the floor only when nothing stands on it there
    let under: Hit = null;
    for (const h of this.ray.intersectObjects(this.pickables, true)) {
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) if (o.userData.hit) {
        const hit = o.userData.hit as Hit;
        if (hit && "floor" in hit) { under ??= hit; break; }
        // an outside wall says where on it the pointer is (a window goes there)
        if (hit && "side" in hit) return { side: hit.side, at: [h.point.x, h.point.z] };
        return hit;
      }
    }
    return under;
  }

  /** A small picture of a new seat (or a prop), for the catalog. */
  thumb(spot: Spot | Prop, size = 96): string {
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50), model = "id" in spot ? spotModel(spot) : prop({ ...spot, at: [0, 0] }, propMat);
    scene.background = new THREE.Color("#23262c");
    scene.add(new THREE.HemisphereLight("#ffffff", "#40444c", 2), model);
    const dl = new THREE.DirectionalLight("#ffffff", 2); dl.position.set(2, 4, 3); scene.add(dl);
    const box = new THREE.Box3().setFromObject(model), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 0.62;
    cam.position.set(c.x + r * 1.1, c.y + r * 0.9, c.z + r * 1.6); cam.lookAt(c);
    const prev = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(size, size, false);
    this.renderer.render(scene, cam);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setSize(prev.x, prev.y, false);
    this.draw();
    return url;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.persp.aspect = r.width / r.height; this.persp.updateProjectionMatrix();
    if (this.room) this.build(); else this.draw();
  }

  private draw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; this.renderer.render(this.scene, this.camera); });
  }
}
