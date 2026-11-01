// A fighter's body is a beast: modelled by blender/beast.py from its sheet in beasts/, given bones and skin
// weights by auto-rig's voxel rigger (scripts/beasts.ts writes public/models/<id>.rig.json), and driven here
// by closed-chain IK. The root rides the fighter, the feet plant on the ground and step when they're left
// behind, the head looks at the other fighter, the tail lags the turns, and the fighter's state poses the body:
// an attack coils the other way through its wind-up and snaps into the strike by how the move looks (a lunge on
// a slam, a rear on a rising strike or a nova, a thrust on a jab or beam), sized by the archetype's style, with
// the body pitching and twisting about the hips, the wings snapping and the tail whipping along; a hit throws
// the body back, a guard and a charge crouch, a dash leans in, flight banks, a landing squashes. Everything else
// (spikes, a hanging wing) follows its bones.
import { Tile, type Pip } from "./tiles.ts";
import * as THREE from "three";
import { arr, int, num, obj, str, type Of } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { rigFromWire, type RigResult } from "@rustybuns/rig";
import { IkRig } from "@rustybuns/rig/ik";
import { loadGlb, type Model } from "@rustybuns/rig/model";
import { pupils } from "./eyes.ts";
import { Secondary } from "./secondary.ts";
import { smoothNormals } from "./smooth.ts";
import type { Archetype, Body, Move } from "./roster.ts";
import type { Motion } from "./moves.ts";
import { FX_TIME, fieldLook, type FieldLook } from "./effects.ts";
import type { Field } from "./fields.ts";
import { ARENA, frames, type Fighter } from "./sim.ts";

const B64 = str(1 << 24, { min: 0, re: /^[A-Za-z0-9+/=]*$/ });
/** The rig sidecar: auto-rig's result over the wire, plus which tips are feet. The model is normalized
 * (standing on y = 0, bounding box diagonal 2, facing +x), so `height` and `extent` are in that space. */
export const BeastRig = obj({
  joints: B64, parents: B64, skinIndex: B64, skinWeight: B64,
  grid: obj({ dims: arr(num(1, 4096), 3, { min: 3 }), h: num(0, 10), origin: arr(num(-10, 10), 3, { min: 3 }), solid: num(0, 1e9) }),
  timings: obj({ voxelize: num(0, 1e6), distance: num(0, 1e6), skeleton: num(0, 1e6), weights: num(0, 1e6) }),
  tips: arr(int(0, 1023), 64), feet: arr(int(0, 1023), 8), wings: arr(int(0, 1023), 8), height: num(0.01, 2), extent: num(0.01, 2),
});
export type BeastRig = Of<typeof BeastRig>;

/** Tips low enough to stand on: within `frac` of the model's height off the ground. */
export function feetOf(rig: RigResult, tips: number[], height: number, frac = 0.15): number[] {
  return tips.filter((t) => rig.joints[t * 3 + 1] < height * frac);
}

/** Tips that are wings: high up and far out to the side. With `count` (the sheet's `wings`), only that many,
 * the furthest out first: long hair, a hydra's outer heads or a wide horn's tips are high and wide too. Wings
 * folded upright over the back (a sphinx) stay near the centreline, so when the wide rule finds fewer than
 * `count`, a mirrored pair of tips in the beast's top half fills in. */
export function wingsOf(rig: Pick<RigResult, "joints">, tips: number[], height: number, extent: number, count?: number): number[] {
  const J = rig.joints;
  const y = (t: number) => J[t * 3 + 1]!, z = (t: number) => J[t * 3 + 2]!;
  const found = tips.filter((t) => y(t) > height * 0.5 && Math.abs(z(t)) > extent * 0.3);
  if (count === undefined) return found;
  const reach = (t: number) => Math.abs(z(t)) / extent + y(t) / height;
  const byReach = (a: number, b: number) => reach(b) - reach(a) || a - b;
  const twin = (t: number) => tips.some((u) => u !== t && Math.abs(J[u * 3]! - J[t * 3]!) < 0.05 * extent && Math.abs(y(u) - y(t)) < 0.05 * height && Math.abs(z(u) + z(t)) < 0.05 * extent);
  const folded = tips.filter((t) => !found.includes(t) && y(t) > height * 0.5 && Math.abs(z(t)) > extent * 0.1 && twin(t));
  return [...found.sort(byReach), ...folded.sort(byReach)].slice(0, count).sort((a, b) => a - b);
}

/** Tips of beasts whose tail is reared over the back (a scorpion's), by the model's id. */
const REARED_TAIL: Record<string, number> = { manticore: 8 };

/** The highest of `rest` and the tips around it: horns, ears, a snout. */
function headOf(rig: RigResult, sheet: BeastRig, rest: number[]): number[] {
  const J = rig.joints;
  const top = rest.reduce((a, b) => (J[b * 3 + 1]! > J[a * 3 + 1]! ? b : a));
  const near = 0.35 * Math.max(sheet.height, sheet.extent);
  return rest.filter((t) => Math.hypot(J[t * 3]! - J[top * 3]!, J[t * 3 + 1]! - J[top * 3 + 1]!, J[t * 3 + 2]! - J[top * 3 + 2]!) < near);
}

/** The head (the highest tip that isn't a foot or a wing, and the tips around it: horns, ears, a snout) and
 * the tail (the rearmost tip well behind the root), found from the rig at rest. Either may be missing. */
export function headAndTail(rig: RigResult, sheet: BeastRig, id?: string): { head: number[]; tail: number | null } {
  // a tail reared over the back is the highest tip, and so would pass for the head: the sheet's id names it
  const reared = id !== undefined ? REARED_TAIL[id] ?? null : null;
  const J = rig.joints, rest = sheet.tips.filter((t) => !sheet.feet.includes(t) && !sheet.wings.includes(t) && t !== reared);
  if (reared !== null) return { head: rest.length ? headOf(rig, sheet, rest) : [], tail: reared };
  if (rest.length === 0) return { head: [], tail: null };
  const head = headOf(rig, sheet, rest);
  const back = rest.filter((t) => !head.includes(t) && J[t * 3]! < J[0]! - 0.25 * sheet.extent);
  const tail = back.length ? back.reduce((a, b) => (J[b * 3]! < J[a * 3]! ? b : a)) : null;
  return { head, tail };
}

/** Where an attack is in its pose, 0 to 1 each: `wind` is the coil through the first 70% of the wind-up (the
 * body pulls the other way), `k` the strike that snaps out over the last 30%, holds while the move is live, and
 * eases off through the recovery. */
export function attackPose(f: Fighter): { slot: Move["slot"]; fx: Move["fx"]; k: number; wind: number; motion: Motion | undefined } | null {
  if (f.state !== "attack" || !f.act) return null;
  const fr = frames(f.act.move), t = f.t, ease = (x: number) => { const e = Math.max(0, Math.min(1, x)); return e * e * (3 - 2 * e); };
  const u = t / fr.startup;
  const k = t < fr.startup ? ease((u - 0.7) / 0.3) : t < fr.startup + fr.active ? 1 : ease(1 - (t - fr.startup - fr.active) / fr.recovery);
  const wind = t < fr.startup ? ease(u / 0.7) * (1 - k) : 0;
  return { slot: f.act.move.slot, fx: f.act.move.fx, k, wind, motion: f.act.move.motion };
}

/** How each archetype throws itself into a move: how big the motion is, how low it crouches to coil, how far it
 * twists at the hips, and whether a slam is a stamp of the front feet. */
const STYLE: Record<Archetype, { amp: number; crouch: number; twist: number; stomp: number }> = {
  skirmisher: { amp: 1.1, crouch: 0.09, twist: 0.3, stomp: 0 },
  flyer: { amp: 0.9, crouch: 0.05, twist: 0.15, stomp: 0 },
  tank: { amp: 0.75, crouch: 0.04, twist: 0.1, stomp: 0.22 },
  bruiser: { amp: 1.2, crouch: 0.07, twist: 0.45, stomp: 0.08 },
};

/** How much of the body's weight a move throws into it: a jab barely shifts it, a slam drops it. */
const WEIGHT: Record<Move["slot"], number> = { light: 0.25, heavy: 1, launcher: 0.7, special: 0.3, beam: 0.4, ultimate: 1.2 };

export interface Beast { model: Model; rig: RigResult; sheet: BeastRig }
const cache = new Map<string, Promise<Beast | null>>();
const stale = new Set<string>();

/** Forget a beast so the next `loadBeast` fetches its files again (scripts/beasts.ts --watch rebuilt it). */
export function forgetBeast(id: string) { cache.delete(id); stale.add(id); }

/** The beast's model and rig, fetched once per id; null when either file is missing. */
export function loadBeast(id: string, bust = ""): Promise<Beast | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const fresh = stale.delete(id), q = bust || (fresh ? `?t=${Date.now()}` : "");
      const [glb, sheet] = await Promise.all([fetch(`/models/${id}.glb${q}`), getJson(`/models/${id}.rig.json${q}`, BeastRig)]);
      if (!glb.ok || !sheet) return null;
      const model = await loadGlb(await glb.arrayBuffer(), id);
      smoothNormals(model.parts.map((p) => p.geometry));
      const three = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
      const rig = rigFromWire({ ...sheet, grid: { ...sheet.grid, dims: three(sheet.grid.dims), origin: three(sheet.grid.origin) } });
      return { model, rig, sheet };
    })().catch((e) => { console.warn("[beasts]", id, e); return null; });
    cache.set(id, p);
  }
  return p;
}

/** Forget a beast's cached files and fetch them again past the browser cache (the dev server just rebuilt them). */
export function reloadBeast(id: string): Promise<Beast | null> {
  cache.delete(id);
  return loadBeast(id, `?v=${Date.now()}`);
}

/**
 * Per-material shading in the style of a GameCube-era fighter, patched into the standard material so the
 * lights, shadows and skinning stay three.js's own (no extra pass): TF2's "Illustrative Rendering" (Mitchell,
 * Francke, Eng, 2007) half-Lambert warped diffuse so the unlit side stays soft rather than black, a cool
 * sky fill in shadow against the warm sun, a view-dependent rim, and a value gradient dark at the feet to
 * bright at the head. `top` is the model's height, shared by every material of one beast.
 */
const SHADE_KEY = "beast-shade-v1";
function stylize(m: THREE.MeshStandardMaterial, top: { value: number }, name: string, fx: FieldLook | null = null, amt: { value: number } = { value: 1 }) {
  const hard = /horn|claw|spike|tooth|teeth|beak|talon|tusk|fang|bone/.test(name);
  if (hard) m.roughness = Math.min(m.roughness, 0.32);
  else if (m.roughness > 0.7) m.roughness = 0.7;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTop = top;
    if (fx) { sh.uniforms.uFxTime = FX_TIME; sh.uniforms.uFxAmt = amt; }
    sh.vertexShader = "varying float vBeastY;\nuniform float uTop;\n" + (fx ? "varying vec3 vFxPos;\n" : "") + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + (fx ? "vFxPos = position / max(uTop, 1e-4);\n" : "") + "vBeastY = clamp(position.y / max(uTop, 1e-4), 0.0, 1.0);");
    // half-Lambert squared: a surface turned from the light keeps a soft share of it
    // only the diffuse term is wrapped: the specular BRDF divides by the true N.L and blows up on the dark side
    const pars = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );",
      "float wrap = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );\n\tfloat band = mix( wrap * wrap, smoothstep( 0.3, 0.7, wrap ), 0.6 );\n\treflectedLight.directDiffuse += band * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );");
    sh.fragmentShader = "varying float vBeastY;\n" + sh.fragmentShader
      .replace("#include <lights_physical_pars_fragment>", pars)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
        {
          vec3 wN = inverseTransformDirection( normal, viewMatrix );
          float sky = wN.y * 0.5 + 0.5;
          float grad = mix( 0.7, 1.1, smoothstep( 0.0, 0.9, vBeastY ) );
          reflectedLight.directDiffuse *= vec3( 1.04, 1.0, 0.94 ) * grad;
          reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * grad + diffuseColor.rgb * mix( vec3( 0.07, 0.07, 0.12 ), vec3( 0.14, 0.15, 0.2 ), sky );
          float rim = 1.0 - saturate( dot( normalize( normal ), normalize( vViewPosition ) ) ); rim = rim * rim * rim;
          reflectedLight.indirectSpecular += mix( vec3( 0.5, 0.55, 0.7 ), vec3( 1.0, 0.95, 0.85 ), sky ) * rim * ( 0.2 + 0.45 * sky ) * ( 1.0 - dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * ( 1.0 - 0.5 * metalnessFactor );
        }
        ${fx?.frag ?? ""}`);
    if (fx) sh.fragmentShader = "varying vec3 vFxPos;\nuniform float uFxTime;\nuniform float uFxAmt;\n" + fx.helpers + sh.fragmentShader;
  };
  m.customProgramCacheKey = () => SHADE_KEY + (fx ? ":" + fx.key : "");
}

const CONTACT_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
/** Black, opaque in the middle and falling to nothing at the rim: the contact shadow's alpha. */
const CONTACT = (() => {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2)), i = (y * N + x) * 4;
    data[i + 3] = Math.round(255 * (1 - d * d) ** 2);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.needsUpdate = true;
  return t;
})();

interface Foot { tip: number; home: THREE.Vector3; planted: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; swing: number;
  /** Where the leg hangs from at rest, and how long it is when straight: a goal further off than that can't be reached, so the leg would fold itself up trying. */
  hip: THREE.Vector3; reach: number }

const SWING = 0.14;      // seconds a step takes at a walk; a sprint's steps are quicker
const STEP = 0.22;       // how far (as a fraction of the model's height) a foot is left behind before it steps
const LIFT = 0.12;       // how high a stepping foot lifts, as a fraction of the model's height

/** A beast skinned to its skeleton and posed by IK each frame to follow a fighter. */
export class Puppet {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly top = { value: 1 };
  /** Called when a foot comes down after a step: where, and how fast the body was going. */
  onStep: ((at: THREE.Vector3, speed: number) => void) | null = null;
  /** Each material's own glow from the model (eyes, flames), put back when a flash ends. */
  private readonly glow: { color: THREE.Color; intensity: number }[] = [];
  private readonly bones: THREE.Bone[] = [];
  private readonly ik: IkRig;
  private readonly feet: Foot[];
  private readonly wings: { tip: number; rest: THREE.Vector3 }[];
  private wingsHeld = false;
  private readonly head: { tip: number; rest: THREE.Vector3 }[];
  private readonly tail: { tip: number; rest: THREE.Vector3; lag: THREE.Vector3 } | null;
  private tailSet = false;
  private readonly look = new THREE.Vector3();
  private readonly sec: Secondary;
  private readonly soft = { x: 0, y: 0, z: 0 };
  private readonly lids: { m: THREE.MeshStandardMaterial; open: THREE.Color; shut: THREE.Color }[] = [];
  private readonly pupilMeshes: THREE.Object3D[] = [];
  private readonly rest: THREE.Vector3;
  private readonly scale: number;
  /** The body's lean, pitched, rolled and twisted about the hips: the frame the skin hangs in. */
  private readonly pivot = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly inv = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly pm = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly style: (typeof STYLE)[Archetype];
  private landed = false;
  private vy = 0;        // last frame's fall speed, so a landing knows how hard it was
  private squash = 0;    // the dip after a landing, easing back up
  private jolt = 0;      // a hit's squash-and-stretch: 1 on the blow, ringing back to rest
  private joltV = 0;
  private prevStun = 0;
  private stagger = 0;   // a big hit's shove back: 1 on a heavy blow, easing off while the body rocks away from it
  private lean = 0;
  /** Out in the open world: the ground's height under the body, where the contact shadow lies (the ring's floor is 0 and ends at its edge). */
  ground: number | null = null;
  /** The field tile on the floor under the body (src/tiles.ts), if one was asked for. */
  tile: Tile | null = null;
  private radius = 1;
  private readonly contact: THREE.Mesh;      // pitch, smoothed so a hit's recoil and a dash's lean don't snap

  constructor(readonly beast: Beast, b: Body, archetype: Archetype = "bruiser", fields: readonly Field[] = [], fxAmount = 1) {
    const look = fieldLook(fields), amt = { value: fxAmount };
    const { model, rig, sheet } = beast;
    this.top.value = sheet.height;
    this.style = STYLE[archetype];
    // Fit the hurtbox: as tall as the body says, and no wider than the ring it fights in.
    this.radius = b.radius;
    this.scale = Math.min(b.height / sheet.height, (b.radius * 4) / sheet.extent);
    const J = rig.parents.length;
    for (let j = 0; j < J; j++) {
      const bone = new THREE.Bone();
      const p = rig.parents[j]!;
      if (p < 0) bone.position.set(rig.joints[0]!, rig.joints[1]!, rig.joints[2]!);
      else bone.position.set(rig.joints[j * 3]! - rig.joints[p * 3]!, rig.joints[j * 3 + 1]! - rig.joints[p * 3 + 1]!, rig.joints[j * 3 + 2]! - rig.joints[p * 3 + 2]!);
      this.bones.push(bone);
      if (p >= 0) this.bones[p]!.add(bone);
    }
    const inner = this.inner;
    inner.add(this.bones[0]!);
    inner.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    for (const part of model.parts) {
      const g = part.geometry.clone();
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(rig.skinIndex.slice(part.start * 4, (part.start + part.count) * 4), 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(rig.skinWeight.slice(part.start * 4, (part.start + part.count) * 4), 4));
      const mats = Array.isArray(part.material) ? part.material : [part.material];
      const own = mats.map((m) => m.clone());
      const isEye = own.length === 1 && own[0]!.name === "eye";
      for (const m of own) if (m instanceof THREE.MeshStandardMaterial) {
        // an eye is wet and glossy with a glow behind it, not a lamp; flames and markings keep the colour they were given
        if (isEye) { this.lids.push({ m, open: m.color.clone(), shut: m.color.clone().multiplyScalar(0.12) }); m.roughness = 0.08; m.metalness = 0; m.emissiveIntensity = Math.min(m.emissiveIntensity, 1.2); }
        else if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) m.toneMapped = false;
        else stylize(m, this.top, m.name, look, amt);
        this.materials.push(m); this.glow.push({ color: m.emissive.clone(), intensity: m.emissiveIntensity }); }
      const sm = new THREE.SkinnedMesh(g, own.length === 1 ? own[0]! : own);
      sm.bind(skeleton, new THREE.Matrix4());
      sm.frustumCulled = false;
      sm.castShadow = true;
      inner.add(sm);
      const pupil = isEye ? pupils(g, g.getAttribute("skinIndex").array, g.getAttribute("skinWeight").array) : null;
      if (pupil) {
        const pm = new THREE.SkinnedMesh(pupil, new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.05 }));
        pm.bind(skeleton, new THREE.Matrix4());
        pm.frustumCulled = false;
        inner.add(pm);
        this.pupilMeshes.push(pm);
      }
    }
    // Joints turn only so far: a spine bends like a spine and a knee like a knee, not the 144 degrees any joint
    // may take by default (that folded legs through bodies and snapped spines on a big move). Legs: the joints
    // below the hips; the rest of the body (spine, neck, tail) is stiffer near the root and looser out along it.
    const legJoints = new Set<number>();
    for (const ft of sheet.feet) for (let j = ft, y0 = rig.joints[1]!; j >= 0 && rig.joints[j * 3 + 1]! < y0 - 0.05; j = rig.parents[j]!) legJoints.add(j);
    this.ik = new IkRig(rig.joints, rig.parents, (j) => (legJoints.has(j) ? 0.85 : 0.9));
    const isFoot = new Set(sheet.feet);
    for (const t of this.ik.tips) if (!isFoot.has(t)) this.ik.setPinned(t, false);
    this.rest = new THREE.Vector3(...this.ik.worldPosition(0));
    // the skin hangs in `inner` (the model's own space, scaled to the body), which leans inside `pivot` about the hips
    const s = this.scale;
    inner.scale.setScalar(s);
    inner.position.copy(this.rest).multiplyScalar(-s);
    this.pivot.position.copy(this.rest).multiplyScalar(s);
    this.pivot.rotation.order = "YZX";
    this.pivot.add(inner);
    this.group.add(this.pivot);
    // a soft dark pool right under the body: the light the ground doesn't get there, which the sun's shadow misses
    this.contact = new THREE.Mesh(CONTACT_GEO, new THREE.MeshBasicMaterial({ map: CONTACT, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    this.contact.scale.set(b.radius * 2.4, 1, b.radius * 2.4);
    this.contact.renderOrder = 1;
    this.group.add(this.contact);
    this.wings = sheet.wings.map((tip) => ({ tip, rest: new THREE.Vector3(...this.ik.worldPosition(tip)) }));
    // the head and tail get goals of their own: the head turns to look, the tail is dragged behind the turns
    const { head, tail } = headAndTail(rig, sheet, beast.model.name);
    this.head = head.map((tip) => ({ tip, rest: new THREE.Vector3(...this.ik.worldPosition(tip)) }));
    this.tail = tail === null ? null : { tip: tail, rest: new THREE.Vector3(...this.ik.worldPosition(tail)), lag: new THREE.Vector3() };
    this.sec = new Secondary(archetype, head.length, rig.parents.length);
    for (const t of [...head, ...(tail === null ? [] : [tail])]) this.ik.setPinned(t, true);
    this.feet = sheet.feet.map((tip) => {
      const [x, , z] = this.ik.worldPosition(tip);
      const home = new THREE.Vector3(x, 0, z);
      let top = tip, reach = 0;
      for (let j = tip; j >= 0 && legJoints.has(j); j = rig.parents[j]!) {
        const q = rig.parents[j]!;
        reach += Math.hypot(rig.joints[j * 3]! - rig.joints[q * 3]!, rig.joints[j * 3 + 1]! - rig.joints[q * 3 + 1]!, rig.joints[j * 3 + 2]! - rig.joints[q * 3 + 2]!);
        top = q;
      }
      const hip = new THREE.Vector3(rig.joints[top * 3]!, rig.joints[top * 3 + 1]!, rig.joints[top * 3 + 2]!);
      return { tip, home, planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, swing: SWING, hip, reach };
    });
  }

  /** A foot's home (where it rests under the body) in the world: it follows the fighter's place and heading but
   * not the body's lean, so a pitched body still stands on the ground. */
  private homeWorld(ft: Foot, out: THREE.Vector3) { return out.copy(ft.home).multiplyScalar(this.scale).applyMatrix4(this.group.matrixWorld); }

  /** Lay a field tile under the body, with a matchup pip (0 none, 1 strong against the other, 2 resisted by it). */
  wearTile(fields: readonly Field[], pip: Pip = 0) {
    if (this.tile) this.group.remove(this.tile.mesh);
    this.tile = new Tile(fields, this.radius, pip);
    this.group.add(this.tile.mesh);
  }

  /** Pose for this frame: the fighter's position and heading, then the feet plant, step or hang, the head
   * looks at `look` (the other fighter, in the world) and the state poses the body: an attack coils and snaps
   * by its look and the archetype's style, a hit throws it back, a guard and a charge crouch, a dash leans in,
   * flight banks, and a landing squashes. */
  update(f: Fighter, dt: number, tick: number, look?: { x: number; y: number; z: number }) {
    FX_TIME.value = performance.now() / 1000;
    const g = this.group, h = this.beast.sheet.height, s = this.scale, A = this.style;
    const grounded = f.onGround && !f.flying;
    const speed = Math.hypot(f.vel.x, f.vel.z);
    const pose = attackPose(f);
    // The pose follows how the move looks: a slam, rampage or breath throws the body forward, a rising strike,
    // nova or rain rears up to call it down, a jab, orb or beam thrusts the head. Each first coils the other way.
    const forward = !!pose && (pose.fx === "slam" || pose.fx === "rampage" || pose.fx === "breath" || pose.fx === "wave");
    const upward = !!pose && (pose.fx === "rise" || pose.fx === "nova" || pose.fx === "rain");
    const thrust = !!pose && (pose.fx === "jab" || pose.fx === "orb" || pose.fx === "beam");
    const k = pose ? pose.k * A.amp : 0, wind = pose ? pose.wind : 0;
    const mo = pose?.motion, mk = pose ? pose.k : 0, wk = Math.max(wind, mk);   // a signature's own motion, by wind-up and strike
    const lunge = forward ? k : 0, rear = (upward || mo === "shriek") && grounded ? k : 0, jab = thrust ? k : 0;
    const back = forward ? wind : thrust ? wind * 0.6 : 0;      // the coil before a strike: back and down
    let pitch = 0, roll = 0, twist = 0, dip = 0;
    if (forward) { pitch = -(k * 0.16 - wind * 0.1); dip = wind * A.crouch; twist = (wind * 0.35 - k * 0.15) * A.twist; }
    if (upward) { pitch = grounded ? k * 0.28 : k * 0.22; dip = wind * A.crouch * 1.3; }
    if (thrust) { pitch = -k * 0.05; dip = wind * A.crouch * 0.5; twist = (wind * 0.15 - k * 0.1) * A.twist; }
    if (mo === "shriek") { pitch = grounded ? k * 0.4 : k * 0.3; dip = wind * A.crouch * 1.5; }
    if (mo === "roll") { pitch -= mk * 0.14; dip += (wind * 0.8 + mk * 0.4) * A.crouch * 2; }
    // weight: a heavy move sinks the body into its coil and then leans its whole mass through the swing
    const wt = pose ? WEIGHT[pose.slot] : 0;
    dip += wind * wt * 0.06; pitch -= mk * wt * 0.1 * A.amp;
    const stunK = f.state === "stun" ? Math.min(1, f.stun / 20) : 0;
    if (stunK) pitch += 0.24 * stunK;
    if (f.state === "guard") { dip += 0.09; pitch -= 0.08; }
    if (f.state === "charge") { dip += 0.06 + Math.sin(tick * 1.3) * 0.008; roll = Math.sin(tick * 0.9) * 0.02; }
    if (f.state === "dash") { pitch -= 0.22; dip += 0.05; }
    // a run leans into its speed; standing, the weight shifts slowly from side to side; a fresh hit shudders
    const run = grounded ? Math.min(1, speed / Math.max(1, f.b.topSpeed)) : 0;
    pitch -= run * 0.1;
    if (grounded && !pose && f.state === "free") roll += Math.sin(tick * 0.031) * 0.018 * (1 - run);
    if (stunK) roll += Math.sin(tick * 1.7) * 0.07 * stunK;
    // landing: the harder the fall, the deeper the squash, springing back up
    if (grounded && !this.landed) this.squash = Math.min(1, Math.max(0, -this.vy) / 9);
    this.squash *= Math.exp(-7 * dt);
    this.vy = f.vel.y;
    dip += this.squash * 0.14;
    // flight: bank into a turn and nose down into speed
    if (f.flying) {
      this.tmp.set(f.vel.x, 0, f.vel.z).applyAxisAngle(this.tmp2.set(0, 1, 0), f.yaw);
      roll += Math.max(-1, Math.min(1, this.tmp.z / Math.max(1, f.b.topSpeed))) * 0.35;
      pitch -= Math.min(1, Math.max(0, this.tmp.x) / 8) * 0.18;
    }
    // contact: a fresh hit (stun jumps up) squashes the body along the blow, then it springs back past rest
    if (f.stun > this.prevStun + 1) this.joltV = -9;
    if (f.stun > this.prevStun + 8) this.stagger = Math.min(1, (f.stun - this.prevStun) / 22);
    this.stagger *= Math.exp(-4 * dt);
    this.prevStun = f.stun;
    this.joltV += (-120 * this.jolt - 11 * this.joltV) * dt;
    this.jolt += this.joltV * dt;
    // anticipation: the wind-up squats and widens, the strike stretches tall and thin
    const sq = (wind * (1 - mk) * (0.05 + wt * 0.06) - mk * (0.04 + wt * 0.03)) * A.amp - this.jolt * 0.16;
    this.sec.step(dt);
    const br = this.sec.breath() * this.sec.depth;   // the chest swells and settles
    this.pivot.scale.set(1 + sq * 0.5 + br * 0.5, 1 - sq + br, 1 + sq * 0.5 + br * 0.5);
    const shut = this.sec.lids();
    for (const l of this.lids) l.m.color.lerpColors(l.open, l.shut, shut);
    for (const p of this.pupilMeshes) p.visible = shut < 0.5;
    pitch += this.stagger * 0.2;
    this.lean += (pitch - this.lean) * Math.min(1, dt * 18);
    this.pivot.rotation.set(roll, twist, this.lean);
    g.position.set(f.pos.x, f.pos.y, f.pos.z);
    // the pool stays on the floor and fades as the body rises; gone past the ring's edge, where there's no floor
    const floor = this.ground ?? 0, up = f.pos.y - floor;
    const over = up > -0.3 && (this.ground !== null || Math.hypot(f.pos.x, f.pos.z) < ARENA.radius + 0.2);
    this.contact.visible = over;
    if (over) { this.contact.position.y = 0.025 - up; (this.contact.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.max(0, 1 - up / 3); }
    this.tile?.place(over, up, f.yaw);
    g.rotation.y = -f.yaw;
    g.updateMatrixWorld(true);
    // the IK works in the model's own space: inner's frame, lean, scale and all
    this.inv.copy(this.inner.matrixWorld).invert();
    if (grounded && !this.landed) for (const ft of this.feet) { this.homeWorld(ft, ft.planted); ft.t = 1; }
    this.landed = grounded;
    if (grounded) {
      const swinging = this.feet.filter((ft) => ft.t < 1).length;
      const due = this.feet.filter((ft) => ft.t >= 1)
        .map((ft) => ({ ft, d: ft.planted.distanceTo(this.homeWorld(ft, this.tmp)) }))
        .filter(({ d }) => d > this.stride(speed)).sort((a, b) => b.d - a.d);
      let budget = Math.max(1, Math.floor(this.feet.length / 2)) - swinging;
      const stride = this.stride(speed);
      for (const { ft } of due) {
        if (budget-- <= 0) break;
        ft.from.copy(ft.planted);
        ft.swing = Math.max(0.05, Math.min(SWING, (stride / Math.max(speed, 0.01)) * 0.8));
        // land where home will be when the foot comes down, and a little ahead, the way a stride does
        this.homeWorld(ft, ft.to).add(this.tmp.set(f.vel.x, 0, f.vel.z).multiplyScalar(ft.swing));
        if (speed > 0.1) ft.to.add(this.tmp.set(f.vel.x, 0, f.vel.z).normalize().multiplyScalar(stride * 0.3));
        ft.to.y = f.pos.y;
        ft.t = 0;
      }
      for (const ft of this.feet) {
        if (ft.t < 1) {
          ft.t = Math.min(1, ft.t + dt / ft.swing);
          ft.planted.lerpVectors(ft.from, ft.to, ft.t);
          ft.planted.y += Math.sin(ft.t * Math.PI) * LIFT * h * s;
          if (ft.t >= 1) this.onStep?.(ft.planted, speed);
        }
        this.tmp.copy(ft.planted).applyMatrix4(this.inv);
        const front = ft.home.x > this.rest.x;
        // rearing, the front feet come up off the ground and paw the air; a tank's slam is a stamp of them
        if (rear && front) this.tmp.y += rear * 0.16 * h;
        if (forward && front && A.stomp) this.tmp.y += wind * A.stomp * h;
        if (front && mo === "grab") { this.tmp.x += (wind * 0.3 - mk * 0.12) * h; this.tmp.y += wind * 0.12 * h; }
        if (front && mo === "drum") { this.tmp.x -= wk * 0.12 * h; this.tmp.y += wk * (0.12 + Math.abs(Math.sin(tick * 0.9)) * 0.1) * h; }
        this.ik.moveGoal(ft.tip, this.tmp.x, this.tmp.y, this.tmp.z);
      }
    } else {
      // in the air the legs hang at rest, trailing a touch behind the motion; a rising strike tucks them
      for (const ft of this.feet) {
        // rising off a jump the legs tuck up under the body; falling, they reach down for the ground
        const tuck = f.vel.y > 0 ? Math.min(1, f.vel.y / 6) : 0, reach = f.vel.y < 0 ? Math.min(1, -f.vel.y / 8) : 0;
        this.tmp.copy(ft.home).setY(-0.03 * h + (upward ? k * 0.08 * h : 0) + (f.flying ? 0.05 * h : tuck * 0.14 * h - reach * 0.04 * h));
        this.tmp.x += (this.rest.x - ft.home.x) * tuck * 0.3;
        this.tmp2.set(f.vel.x, 0, f.vel.z).applyMatrix4(this.inv.clone().setPosition(0, 0, 0)).multiplyScalar(-0.02 * h * s);
        this.tmp.add(this.tmp2);
        this.ik.moveGoal(ft.tip, this.tmp.x, this.tmp.y, this.tmp.z);
      }
    }
    // wings beat while flying, pulled up and down at their tips, and drive a move: a slam snaps them down, a
    // rising strike or a nova flares them up and out; otherwise they hang from their bones
    const hold = this.wings.length > 0;
    if (hold !== this.wingsHeld) { for (const w of this.wings) this.ik.setPinned(w.tip, hold); this.wingsHeld = hold; }
    // the body's sway this frame (worked out below), so the wings ride it instead of stretching off it
    const bodyY = Math.sin(tick * 0.08) * 0.012 * h, airborne = !f.onGround;
    if (hold) for (const w of this.wings) {
      // flying: a full stroke, fast and wide going down, folded in on the way up, sweeping forward with the
      // downstroke; in a jump, spread to glide with a lazy flap; on the ground, folded in and breathing
      const ph = tick * 0.32, down = Math.sin(ph);
      let y: number, spread: number, x = 0;
      if (f.flying) { y = (down * 0.3 + 0.06) * h; spread = 1 - Math.max(0, Math.cos(ph)) * 0.22; x = -Math.cos(ph) * 0.06 * h; }
      else if (airborne) { y = (0.1 + Math.sin(tick * 0.14) * 0.08) * h; spread = 1.08; }
      else { y = 0.04 * h + bodyY; spread = 0.78 + Math.sin(tick * 0.05) * 0.02; }
      if (forward) y += (wind * 0.25 - k * 0.3) * h;
      if (upward) { y += k * 0.3 * h; spread += k * 0.12; }
      if (thrust) y += wind * 0.1 * h;
      if (mo === "shriek") { y += wk * 0.3 * h; spread += wk * 0.25; }
      this.ik.moveGoal(w.tip, w.rest.x + x, w.rest.y + y, w.rest.z * spread);
    }
    // the body breathes, and bobs with each stride; a strike shifts it, the coil pulls it back and down
    const bob = grounded ? Math.abs(Math.sin(tick * (0.22 + run * 0.12))) * 0.035 * h * Math.min(1, speed / 3) : 0;
    const rx = (lunge * 0.14 + jab * 0.03 - rear * 0.06 - back * 0.08 - stunK * 0.07 - this.stagger * 0.12) * h; // a hit knocks the hips back
    const bounce = mo === "drum" ? Math.sin(tick * 0.9) * 0.05 * wk : 0, arch = mo === "roll" ? mk * 0.04 : 0;
    const ry = bodyY + bob + (rear * 0.12 - lunge * 0.06 - dip + bounce + arch) * h;
    this.ik.moveRoot(this.rest.x + rx, this.rest.y + ry, this.rest.z);
    // a foot goal the leg can't reach (the hips lunged away, rose, or dropped) comes up off the floor to the leg's
    // full stretch instead of folding the leg in half chasing it
    for (const ft of this.feet) {
      const g = this.ik.goalPosition(ft.tip);
      if (!g) continue;
      this.tmp.set(g[0] - (ft.hip.x + rx), g[1] - (ft.hip.y + ry), g[2] - ft.hip.z);
      const d = this.tmp.length(), max = ft.reach * 0.96;
      if (d > max) { this.tmp.multiplyScalar(max / d); this.ik.moveGoal(ft.tip, ft.hip.x + rx + this.tmp.x, ft.hip.y + ry + this.tmp.y, ft.hip.z + this.tmp.z); }
    }
    // the head rides the body and turns a little toward what it looks at, pulls back in the coil and thrusts
    // on the strike; a breath sweeps it side to side, a beam holds it with a tremor, a hit throws it back
    this.look.set(0, 0, 0);
    if (look && this.head.length) {
      this.tmp.set(look.x, look.y, look.z).applyMatrix4(this.inv).sub(this.head[0]!.rest);
      if (this.tmp.x > 0) this.look.set(0, Math.max(-1, Math.min(1, this.tmp.y / (this.tmp.length() || 1))), Math.max(-1, Math.min(1, this.tmp.z / (this.tmp.length() || 1)))).multiplyScalar(0.08 * h);
    }
    this.look.x += (lunge * 0.12 + jab * 0.1 + rear * 0.04 - back * 0.08 - stunK * 0.06) * h;
    this.look.y += (rear * 0.08 - lunge * 0.04 + (upward && !grounded ? k * 0.1 : 0) + stunK * 0.08 - (f.state === "guard" ? 0.06 : 0)) * h;
    if (pose?.fx === "breath" && pose.k > 0) this.look.z += Math.sin(tick * 0.45) * 0.1 * pose.k * h;
    if (pose?.fx === "beam" && pose.k > 0) this.look.z += Math.sin(tick * 2.1) * 0.012 * h;
    if (mo === "grab") { this.look.x += (wind * 0.2 - mk * 0.1) * h; this.look.y -= wind * 0.05 * h; }
    if (mo === "shriek") { this.look.x -= wk * 0.1 * h; this.look.y += wk * 0.22 * h; }
    if (mo === "roll") this.look.y -= mk * 0.08 * h;
    // moving, the body swings side to side through the stride: head one way, tail the other
    const snake = grounded ? Math.sin(tick * (0.11 + run * 0.08)) * Math.min(1, speed / 2) : 0;
    // the head steadies against the stride, and standing it glances about now and then
    this.look.y -= bob * 0.6;
    if (grounded && !pose && f.state === "free") { this.look.z += Math.sin(tick * 0.019) * Math.sin(tick * 0.007) * 0.06 * h * (1 - run); this.look.y += Math.sin(tick * 0.027) * 0.015 * h; }
    this.head.forEach((t, i) => {
      // the tips of a many-headed beast swing out of phase
      const shake = mo === "shake" ? Math.sin(tick * 0.7 + i * Math.PI) * 0.3 * wk * h : 0;
      // the look and the stride's sway go through a spring, so an idle glance reaches the solver smoothly; a
      // shake is the move itself, a deliberate fast swing, and stays raw
      const sf = this.soft;
      this.sec.follow(i, this.look.x, this.look.y, this.look.z + snake * 0.05 * h, dt, h, sf);
      this.ik.moveGoal(t.tip, t.rest.x + rx + sf.x, t.rest.y + ry + sf.y, t.rest.z + sf.z + shake);
    });
    // the tail is dragged: a point in the world that eases toward where the tail rests, held within reach;
    // a swinging move coils it to one side and whips it across, a wave slaps it down
    const tl = this.tail;
    if (tl) {
      this.tmp.copy(tl.rest).applyMatrix4(this.inner.matrixWorld);
      if (!this.tailSet) { tl.lag.copy(this.tmp); this.tailSet = true; }
      tl.lag.lerp(this.tmp, 1 - Math.exp(-6 * dt));
      this.tmp.copy(tl.lag).applyMatrix4(this.inv).sub(tl.rest);
      if (this.tmp.length() > 0.18 * h) this.tmp.setLength(0.18 * h);
      if (forward) { this.tmp.z += (wind * 0.12 - k * 0.12) * h; if (pose?.fx === "wave") this.tmp.y -= k * 0.1 * h; }
      // a volley rears the tail up over the back through the wind-up, then flicks it forward on the strike
      if (mo === "volley") { this.tmp.y += (wind * 0.5 - mk * 0.15) * h; this.tmp.x += (wind * 0.25 + mk * (0.2 + Math.sin(tick * 1.6) * 0.1)) * h; }
      // a run counterweights the tail up a little and swings it opposite the head, so the spine snakes
      // the tail's tip lags and overshoots the goal on a spring of its own
      const sf = this.soft;
      this.sec.follow(this.head.length, this.tmp.x, this.tmp.y + run * 0.04 * h, this.tmp.z - snake * 0.09 * h, dt, h, sf, 0.5);
      this.ik.moveGoal(tl.tip, tl.rest.x + rx + sf.x, tl.rest.y + ry + sf.y, tl.rest.z + sf.z);
    }
    this.sec.settle();
    this.ik.solve();
    for (let j = 0; j < this.bones.length; j++) {
      this.m.fromArray(this.ik.matrixWorld(j) as number[]);
      const p = this.ik.parents[j]!;
      if (p >= 0) this.m.premultiply(this.pm.fromArray(this.ik.matrixWorld(p) as number[]).invert());
      this.m.decompose(this.bones[j]!.position, this.bones[j]!.quaternion, this.bones[j]!.scale);
    }
  }

  /** Where joint `j` is now, in the model's own space (for audits). */
  jointLocal(j: number): [number, number, number] { return this.ik.worldPosition(j); }

  /** Where each foot is right now, in the world. */
  feetWorld(): THREE.Vector3[] {
    return this.feet.map((ft) => new THREE.Vector3(...this.ik.worldPosition(ft.tip)).applyMatrix4(this.inner.matrixWorld));
  }

  /** Where the head's tips (horns, ears, snout) are right now, in the world. */
  headWorld(): THREE.Vector3[] {
    return this.head.map((t) => new THREE.Vector3(...this.ik.worldPosition(t.tip)).applyMatrix4(this.inner.matrixWorld));
  }

  /** Where the tail's tip is right now, in the world; null for a beast without one. */
  tailWorld(): THREE.Vector3 | null {
    return this.tail && new THREE.Vector3(...this.ik.worldPosition(this.tail.tip)).applyMatrix4(this.inner.matrixWorld);
  }

  /** Where the hips are right now, in the world: the body's dip and lift. */
  rootWorld(): THREE.Vector3 { return new THREE.Vector3(...this.ik.worldPosition(0)).applyMatrix4(this.inner.matrixWorld); }

  /** How far a foot is left behind before it steps, in the world: a sprint lengthens the stride, like a gallop. */
  stride(speed = 0) { return STEP * this.beast.sheet.height * this.scale * Math.min(2.5, 1 + speed / 3); }

  /** The furthest any foot is from where it would rest under the body, in the world. */
  drift() {
    return Math.max(...this.feet.map((ft, k) => this.feetWorld()[k]!.distanceTo(this.homeWorld(ft, this.tmp))));
  }

  /** Light the skin up (a hit, a charge) by `intensity` in `color`; at 0 every part glows as modelled again. */
  flash(color: number, intensity: number) {
    this.materials.forEach((m, i) => {
      const own = this.glow[i]!;
      if (intensity > 0) { m.emissive.setHex(color); m.emissiveIntensity = intensity; }
      else { m.emissive.copy(own.color); m.emissiveIntensity = own.intensity; }
    });
  }
}
