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
import { thingBox, wallPieces, type Prop, type Side, type Spot, type StudioDef } from "./room.ts";
import { prop } from "./props.ts";
import { firePit, paStack } from "./open-air.ts";
import { doorways } from "./doors.ts";
import { van } from "@rustybuns/models/van";
import { rigStacks, roomRig } from "./pa-room.ts";
import { cotton, drape, rugs, tapestry } from "./tapestry.ts";
import { wallMaterial, type Material } from "./sound.ts";

/** What the pointer is over. */
export type Hit = { spot: string } | { booth: string } | { wall: number } | { gear: true } | { prop: number } | { door: true } | { side: Side; at?: [number, number] } | { floor: true } | null;
/** The room's look for a prop: what it's made of, from the look's surfaces. */
const propMat = (name: string, color: string) => surface(name, color);
/** The outside walls: cut down on the sides toward you, all cut down, or all standing. */
export type WallsMode = "cutaway" | "down" | "up";

const CUT = 0.18, ORANGE = new THREE.Color("#ff6b4a");
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
  private camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
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

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color("#1a1c20");
    this.scene.add(new THREE.HemisphereLight("#fff4e6", "#30343a", 1.6));
    const sun = new THREE.DirectionalLight("#fff1dd", 2.2);
    sun.position.set(6, 14, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 40 });
    this.scene.add(sun, this.root, this.preview);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** Draw `room`, with `picked` ringed, and the outside walls as `walls` says. */
  show(room: StudioDef, picked: string | undefined, walls: WallsMode = this.walls) {
    const fresh = this.room?.size.w !== room.size.w || this.room?.size.d !== room.size.d;
    this.room = room; this.picked = picked; this.walls = walls;
    if (fresh) { this.dist = Math.max(room.size.w, room.size.d) * 1.15 + 4; this.target.set(0, 0, 0); }
    this.build();
  }

  private build() {
    const room = this.room!, { w, d, h } = room.size;
    if (this.outline) { this.preview.remove(this.outline); this.outline = null; } this.hovered = null;
    // free what the last build made (the shared surfaces stay: look.ts caches them)
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) (o as THREE.Mesh).geometry.dispose(); });
    this.root.clear(); this.pickables = []; this.keyed.clear();
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
    for (let x = -Math.floor(w / 2 / 0.5) * 0.5; x <= w / 2 + 1e-6; x += 0.5) lines.push(x, 0.003, -d / 2, x, 0.003, d / 2);
    for (let z = -Math.floor(d / 2 / 0.5) * 0.5; z <= d / 2 + 1e-6; z += 0.5) lines.push(-w / 2, 0.003, z, w / 2, 0.003, z);
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.13, depthWrite: false }));
    this.root.add(grid);
    // the outside walls: a wall between you and the room is cut down to a skirting (in cutaway)
    const cam = this.camera.position, T = 0.14;
    const sides: [Side, number, number, number, number][] = [["front", 0, d / 2 + T / 2, w + 2 * T, T], ["back", 0, -d / 2 - T / 2, w + 2 * T, T], ["left", -w / 2 - T / 2, 0, T, d], ["right", w / 2 + T / 2, 0, T, d]];
    // out of doors there are no walls: the rig's stacks and the rugs stand on the sand instead
    if (room.outdoor) {
      const rig = roomRig(room);
      for (const st of rigStacks(room)) this.root.add(paStack(st.at, st.yaw, undefined, rig.stack));
      this.root.add(rugs(room.outdoor));
      // the fire pit and the parked vans, as the room stands them
      if (room.outdoor.fire) { const f = firePit(room.outdoor.seed + 5).group; f.position.set(room.outdoor.fire.at[0], 0, room.outdoor.fire.at[1]); this.root.add(f); }
      (room.outdoor.vans ?? []).forEach((v, i) => { const m = van(room.outdoor!.seed + 31 * i, { awning: v.awning }); m.position.set(v.at[0], 0, v.at[1]); m.rotation.y = v.yaw; this.root.add(m); });
    }
    for (const [side, x, z, sw, sd] of room.outdoor ? [] : sides) {
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
    this.root.add(doorways(room, h, { wallOf: (wl) => wallLook(wallMaterial(wl)), casing: surface("wood", room.colors.trim), leaf: surface("wood", "#6e5034"), lever: surface("metal", "#b9bcc0"), glass: new THREE.MeshPhysicalMaterial({ color: "#bcd6e6", roughness: 0.05, transparent: true, opacity: 0.35 }) }, cutH));
    // the gear wall's corner, a pad on the floor with its rack along the long side
    const fp = footprint(room), shape = new THREE.Shape(fp.map(([x, z]) => new THREE.Vector2(x, -z)));
    const pad = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#c98a3a", transparent: true, opacity: 0.28, depthWrite: false }));
    pad.position.y = 0.006;
    const gearG = new THREE.Group(); gearG.add(pad);
    const [a, b] = [fp[0]!, fp[1]!], rack = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]), 1.6, 0.5), surface("tolex", "#1a1a1a"));
    rack.position.set((a[0] + b[0]) / 2, 0.8, (a[1] + b[1]) / 2); rack.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    gearG.add(rack);
    add(gearG, "gear", { gear: true });
    // the way in: a chevron on the floor
    const [dx, dz] = room.door.at, chev = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 3, 1, -Math.PI / 6, Math.PI * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ORANGE }));
    chev.position.set(dx, 0.01, dz); chev.rotation.y = room.door.yaw;
    const doorG = new THREE.Group(); doorG.add(chev); add(doorG, "door", { door: true });
    // the set dressing, as the jam room draws it (props.ts)
    // (each in a holder at the origin, so a drag slides the holder)
    (room.props ?? []).forEach((p, i) => { const holder = new THREE.Group(); holder.add(prop(p, propMat)); add(holder, `prop:${i}`, { prop: i }); });
    // the seats: each instrument on its box, a disc where you sit, a ring round the picked one
    for (const s of room.spots) {
      const g = new THREE.Group(), b = thingBox(s), model = spotModel(s, room.bass, room.keys, room.outdoor?.seed);
      model.position.set(b.cx, 0, b.cz); model.rotation.y = b.turn;
      g.add(model);
      const seat = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: s.id === this.picked ? ORANGE : new THREE.Color("#c9ccd2"), transparent: true, opacity: 0.7 }));
      seat.position.set(s.at[0], 0.008, s.at[1]); g.add(seat);
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
    const c = Math.cos(this.pitch), r = this.dist * Math.max(1, 1 / this.camera.aspect) ** 0.8;
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
    const key = !hit ? null : "spot" in hit ? `spot:${hit.spot}` : "prop" in hit ? `prop:${hit.prop}` : "wall" in hit ? `wall:${hit.wall}` : "booth" in hit ? `booth:${hit.booth}` : "gear" in hit ? "gear" : "door" in hit ? "door" : null;
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
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
    if (this.room) this.build(); else this.draw();
  }

  private draw() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => { this.dirty = false; this.renderer.render(this.scene, this.camera); });
  }
}
