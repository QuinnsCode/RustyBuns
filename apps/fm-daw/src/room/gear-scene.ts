// The sesh's gear drawn in three.js, for both pages that have it: the gear room (/studio.html, main.ts) and the gear wall
// in every studio (/jam.html, ../studio/gear-wall.ts). One group in the gear room's own frame holds the rack, the pedal
// wall, every box where it stands now (or in someone's hands), the cables sagging between their jacks, and what tells
// you what a click will do: a ghost where the box you carry would land, and the jacks a cable in your hand can go into.
import * as THREE from "three";
import { type Aim, type Room, gearOf, hand, handAt, heldId, item, jackAt, knobValue, landingPose, openJacks, placedNow, sag, theirLeads } from "./room.ts";
import { type GearModel, gearModel, pedalWallModel, rackModel, turnKnob } from "./models.ts";

const cableMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 });
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0.22, depthWrite: false });
const ghostEdge = new THREE.LineBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0.9 });

export class GearScene {
  /** Everything here, in the gear room's frame: the page stands it where the gear is (the gear room's middle, or a studio's gear wall). */
  readonly group = new THREE.Group();
  /** Each box's model, by id (the gear room's glow reads its tubes and cones). */
  readonly models = new Map<string, GearModel>();
  private cables = new Map<string, { mesh: THREE.Mesh; ends: string }>();
  private lit = new Set<THREE.Mesh>();
  private ghost: { gear: string; box: THREE.Group } | null = null;

  constructor() { this.group.add(rackModel(), pedalWallModel()); }

  /** Draw the room's patch as it is now, and light what `aim` points at. */
  sync(room: Room, aim: Aim | null) {
    this.boxes(room);
    this.wires(room);
    this.light(room, aim);
    this.shadow(room);
  }

  private boxes(room: Room) {
    const ids = new Set(room.studio.patch.placed.map((p) => p.id));
    for (const [id, m] of this.models) if (!ids.has(id)) { this.group.remove(m.group); this.models.delete(id); }
    for (const p of room.studio.patch.placed) {
      const g = gearOf(p);
      if (!g) continue;
      let m = this.models.get(p.id);
      if (!m) { m = gearModel(g); this.models.set(p.id, m); this.group.add(m.group); }
      const now = placedNow(room, p);
      m.group.position.set(now.at[0], now.at[1], now.at[2]);
      m.group.rotation.y = now.turn;
      for (const k of g.knobs) { const km = m.knobs.get(k.name); if (km) turnKnob(km, knobValue(room.studio.patch, p.id, k)); }
    }
  }

  /** Cables: a tube along the sagging curve, rebuilt only when an end moves. */
  private wires(room: Room) {
    const seen = new Set<string>();
    const draw = (key: string, a: number[] | null, b: number[] | null) => {
      if (!a || !b) return;
      seen.add(key);
      const ends = [...a, ...b].map((v) => v.toFixed(3)).join(","), had = this.cables.get(key);
      if (had?.ends === ends) return;
      if (had) { this.group.remove(had.mesh); had.mesh.geometry.dispose(); }
      const pts = sag([a[0], a[1], a[2]], [b[0], b[1], b[2]]).map((p) => new THREE.Vector3(...p));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0045, 6), cableMat);
      this.group.add(mesh);
      this.cables.set(key, { mesh, ends });
    };
    for (const c of room.studio.patch.cables) draw(c.from.join(":") + ">" + c.to.join(":"), jackAt(room, c.from), jackAt(room, c.to));
    const h = hand(room);
    if (h && "lead" in h) draw("hand", jackAt(room, h.lead), handAt(room));
    for (const l of theirLeads(room)) draw(`hand-${l.peer}`, jackAt(room, l.from), l.hand);
    for (const [k, c] of this.cables) if (!seen.has(k)) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); this.cables.delete(k); }
  }

  /** The jack you look at glows hot; with a cable in your hand, every jack it can go into glows softly. */
  private light(room: Room, aim: Aim | null) {
    const want = new Map<THREE.Mesh, number>();
    for (const [id, jack] of openJacks(room)) { const ring = this.models.get(id)?.jacks.get(jack); if (ring) want.set(ring, 0.55); }
    if (aim?.t === "jack") { const ring = this.models.get(aim.end[0])?.jacks.get(aim.end[1]); if (ring) want.set(ring, 1.4); }
    for (const ring of this.lit) if (!want.has(ring)) glow(ring, 0);
    for (const [ring, v] of want) glow(ring, v);
    this.lit = new Set(want.keys());
  }

  /** A see-through box where the one you carry would land: on the floor, a shelf, or the top of another box. */
  private shadow(room: Room) {
    const id = heldId(room), p = id ? item(room, id) : undefined, g = p && gearOf(p), to = landingPose(room);
    if (!p || !g || !to) { if (this.ghost) this.ghost.box.visible = false; return; }
    if (this.ghost?.gear !== g.id) {
      if (this.ghost) this.group.remove(this.ghost.box);
      const [w, h, d] = g.size, geo = new THREE.BoxGeometry(w, h, d), box = new THREE.Group();
      const body = new THREE.Mesh(geo, ghostMat), edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), ghostEdge);
      body.position.y = edge.position.y = h / 2;
      box.add(body, edge);
      this.group.add(box);
      this.ghost = { gear: g.id, box };
    }
    this.ghost.box.visible = true;
    this.ghost.box.position.set(to.at[0], to.at[1] + 0.002, to.at[2]);
    this.ghost.box.rotation.y = to.turn;
  }
}

function glow(ring: THREE.Mesh, v: number) {
  if (ring.material instanceof THREE.MeshStandardMaterial) ring.material.emissiveIntensity = v;
}
