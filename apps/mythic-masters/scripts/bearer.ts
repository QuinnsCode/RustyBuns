// The Book's bearer, the figure you walk the world as: `bun run bearer [--render]`.
//
//   1. blender/bearer-rig.glb is a humanoid skeleton and its clips (idle, walk, run, look, cast), lifted once from the
//      Druid's Curse character Qoa with `bun scripts/bearer.ts --rig <Qoa_Character_merged.glb>`: bones and keys only,
//      none of that character's mesh or textures.
//   2. Each build stretches that rig to the proportions in blender/bearer.json (`scale`: a bone's offset from its
//      parent, longer or shorter; `turn`: a bend added to a bone at rest and in every clip, the slouch), keeping the
//      feet on the ground, and hands it to blender/bearer.py, which builds the body round it (skin modifier, hair,
//      flares, the Book in one hand), binds it, and writes public/models/bearer.glb.
//   3. --render also writes blender/out/bearer.png: the figure in a row of poses from its clips, by a 1.8 m post,
//      then its head close up from the front, three-quarter, side and back.
//
// The look is all in bearer.json: radii per joint, hair, flares, eyes. Change it, run this, read the PNG.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { arr, num, obj, rec, str } from "@rustybuns/util/guard";
import { GlbWriter, readGlb, type GNode } from "./gltf-lite.ts";

const APP = join(import.meta.dir, "..");
const RIG = join(APP, "blender/bearer-rig.glb"), SHEET = join(APP, "blender/bearer.json");
const STRETCHED = join(APP, "blender/out/bearer-stretched.glb"), OUT = join(APP, "public/models/bearer.glb");
/** The clips kept from the source rig, by the role the game plays them as. */
export const CLIPS: Record<string, string> = {
  idle: "Armature|Idle_5|baselayer", look: "Armature|Torch_Look_Around|baselayer", walk: "Armature|walking_man|baselayer",
  run: "Armature|running|baselayer", cast: "Armature|Push_Forward_and_Stop|baselayer",
};

const Sheet = obj({
  scale: rec(arr(num(0.2, 5), 3, { min: 3 }), 50),
  turn: rec(arr(num(-90, 90), 3, { min: 3 }), 50),
  note: str(2000, { min: 0 }),
});

/** The sheet's names say a side-less bone ("Leg") for both sides: each key as the node names it covers. */
const sides = (k: string) => (/^(UpLeg|Leg|Foot|ToeBase|Shoulder|Arm|ForeArm|Hand)$/.test(k) ? [`Left${k}`, `Right${k}`] : [k]);

interface Edits { scale: Map<string, THREE.Vector3>; turn: Map<string, THREE.Quaternion>; clips?: Record<string, string> }

/** The rig in `src` written again: every joint node, the clips asked for (all, renamed by `clips`), a bone's
 *  rotation keys always and only the root's translation keys, a one-triangle mesh to carry the skin, and `edits`
 *  applied with the feet kept on the ground. */
function rewrite(src: Uint8Array, edits: Edits) {
  const g = readGlb(src), { json } = g, skin = json.skins?.[0];
  if (!skin) throw new Error("no skin in the rig");
  const joints = new Set(skin.joints), parent = new Map<number, number>();
  json.nodes.forEach((n, i) => n.children?.forEach((c) => parent.set(c, i)));
  const root = skin.joints.find((j) => !joints.has(parent.get(j) ?? -1))!;
  const named = (i: number) => json.nodes[i]!.name ?? "";
  const nodes: GNode[] = json.nodes.map((n) => ({ ...n }));
  const offsetOf = (i: number) => edits.turn.get(named(i));
  for (const [i, n] of nodes.entries()) {
    const s = edits.scale.get(named(i)), q = offsetOf(i);
    if (s && n.translation) n.translation = [n.translation[0]! * s.x, n.translation[1]! * s.y, n.translation[2]! * s.z];
    if (q) n.rotation = new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])).multiply(q).toArray();
  }
  const local = (n: GNode) => new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
  const world = (list: GNode[], i: number): THREE.Matrix4 => { const p = parent.get(i); const m = local(list[i]!); return p === undefined ? m : world(list, p).multiply(m); };
  // Keep the lowest toe where it was: the root moves by the difference, in its parent's frame.
  const toeY = (list: GNode[]) => Math.min(...skin.joints.filter((j) => /ToeBase$/.test(named(j))).map((j) => new THREE.Vector3().setFromMatrixPosition(world(list, j)).y));
  const dy = toeY(json.nodes) - toeY(nodes);
  // the local shift that moves the root up by dy in the world
  const rp = parent.get(root), rootShift = new THREE.Vector3();
  if (dy) {
    const pw = rp === undefined ? new THREE.Matrix4() : world(nodes, rp), inv = pw.clone().invert();
    const o = new THREE.Vector3().applyMatrix4(inv), u = new THREE.Vector3(0, dy, 0).applyMatrix4(inv);
    rootShift.subVectors(u, o);
  }
  const rt = nodes[root]!.translation ?? [0, 0, 0];
  nodes[root]!.translation = [rt[0]! + rootShift.x, rt[1]! + rootShift.y, rt[2]! + rootShift.z];

  const w = new GlbWriter();
  // inverse bind matrices: each joint's old bind against the old rest carried onto the new rest
  const ibmOld = skin.inverseBindMatrices === undefined ? null : g.floats(skin.inverseBindMatrices);
  const ibm = new Float32Array(skin.joints.length * 16);
  skin.joints.forEach((j, k) => {
    const old = ibmOld ? new THREE.Matrix4().fromArray(ibmOld, k * 16) : world(json.nodes, j).invert();
    const m = world(json.nodes, j).multiply(old);
    world(nodes, j).invert().multiply(m).toArray(ibm, k * 16);
  });
  const ibmAt = w.floats(ibm, "MAT4");

  const animations: Record<string, unknown>[] = [];
  for (const a of json.animations ?? []) {
    const role = edits.clips ? Object.entries(edits.clips).find(([, n]) => n === a.name)?.[0] : a.name;
    if (!role) continue;
    const channels: Record<string, unknown>[] = [], samplers: Record<string, unknown>[] = [], inputs = new Map<number, number>();
    for (const c of a.channels) {
      const node = c.target.node, s = a.samplers[c.sampler]!;
      if (node === undefined || !joints.has(node)) continue;
      if (c.target.path === "translation" && node !== root) continue;
      if (c.target.path !== "translation" && c.target.path !== "rotation") continue;
      const out = g.floats(s.output);
      if (c.target.path === "rotation") {
        const q = offsetOf(node);
        if (q) for (let k = 0; k < out.length; k += 4) new THREE.Quaternion(out[k], out[k + 1], out[k + 2], out[k + 3]).multiply(q).toArray(out, k);
      } else for (let k = 0; k < out.length; k += 3) { out[k]! += rootShift.x; out[k + 1]! += rootShift.y; out[k + 2]! += rootShift.z; }
      let input = inputs.get(s.input);
      if (input === undefined) { input = w.floats(g.floats(s.input), "SCALAR", true); inputs.set(s.input, input); }
      samplers.push({ input, output: w.floats(out, c.target.path === "rotation" ? "VEC4" : "VEC3"), interpolation: s.interpolation ?? "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node, path: c.target.path } });
    }
    animations.push({ name: role, channels, samplers });
  }
  if (edits.clips) for (const [role, name] of Object.entries(edits.clips)) if (!animations.some((a) => a.name === role)) throw new Error(`no clip ${name} for ${role}`);

  // a one-triangle mesh on the root, so the skin (and Blender's armature) comes through
  const meshNode = nodes.findIndex((n) => n.skin !== undefined);
  const prim = {
    attributes: {
      POSITION: w.floats(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]), "VEC3", true),
      JOINTS_0: w.ints(new Uint8Array(12).fill(skin.joints.indexOf(root)), "VEC4", 34962),
      WEIGHTS_0: w.floats(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), "VEC4"),
    },
    indices: w.ints(new Uint16Array([0, 1, 2]), "SCALAR", 34963),
  };
  const out = nodes.map((n, i) => {
    const { mesh: _m, skin: _s, ...rest } = n;
    return i === meshNode ? { ...rest, mesh: 0, skin: 0 } : rest;
  });
  return w.glb({ scenes: json.scenes, nodes: out, meshes: [{ name: "rig", primitives: [prim] }], skins: [{ joints: skin.joints, inverseBindMatrices: ibmAt, ...(skin.skeleton !== undefined ? { skeleton: skin.skeleton } : {}) }], animations });
}

const argv = process.argv.slice(2);
const rigFrom = argv.indexOf("--rig");
if (rigFrom >= 0) {
  const src = argv[rigFrom + 1];
  if (!src) throw new Error("--rig takes the source character's .glb");
  const bytes = rewrite(new Uint8Array(readFileSync(src)), { scale: new Map(), turn: new Map(), clips: CLIPS });
  await Bun.write(RIG, bytes);
  console.log(`rig -> blender/bearer-rig.glb (${Math.round(bytes.length / 1024)} KB, ${Object.keys(CLIPS).join(", ")})`);
  process.exit(0);
}

const sheet = Sheet(JSON.parse(readFileSync(SHEET, "utf8")));
const scale = new Map<string, THREE.Vector3>(), turn = new Map<string, THREE.Quaternion>();
for (const [k, v] of Object.entries(sheet.scale)) for (const n of sides(k)) scale.set(n, new THREE.Vector3(v[0], v[1], v[2]));
for (const [k, v] of Object.entries(sheet.turn)) for (const n of sides(k)) {
  // a right-side bone bends the mirror way about its y and z
  const m = n.startsWith("Right") ? [1, -1, -1] : [1, 1, 1], r = THREE.MathUtils.degToRad;
  turn.set(n, new THREE.Quaternion().setFromEuler(new THREE.Euler(r(v[0]! * m[0]!), r(v[1]! * m[1]!), r(v[2]! * m[2]!))));
}
mkdirSync(join(APP, "blender/out"), { recursive: true });
await Bun.write(STRETCHED, rewrite(new Uint8Array(readFileSync(RIG)), { scale, turn }));
const args = ["--rig", STRETCHED, "--sheet", SHEET, "--out", OUT, ...(argv.includes("--render") ? ["--render", join(APP, "blender/out/bearer.png")] : [])];
const p = Bun.spawn(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", join(APP, "blender/bearer.py"), "--", ...args], { cwd: APP, stdout: "pipe", stderr: "pipe" });
const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
if ((await p.exited) !== 0) { console.error((o + e).split("\n").slice(-30).join("\n")); process.exit(1); }
console.log(o.split("\n").filter((l) => /^(bearer|render|->)/.test(l)).join("\n"));
