// The connectors on a cable's ends, drawn at their real size from the same plug models the speakers' panels mate with
// (@rustybuns/models/sockets): a wall plug's blades, an IEC socket's face, an XLR's shell and latch with pins (male) or
// holes (female), a speakON's twist ring, an EP-6's collar, a powerCON TRUE1's ring, a quarter-inch jack's tip. Each is
// a group whose +Y points out of the plug's face, its body centred on the origin: aim +Y along where the plug goes in.
import * as THREE from "three";
import { plugPieces } from "@rustybuns/models/sockets";
import type { Gender } from "@rustybuns/util/connectors";
import { realEnd, type Connector } from "./ends.ts";

const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
/** The plugs' paint, by the models' slots. */
const LOOK: Record<string, THREE.Material> = {
  rubber: std(0x1b1b1e, 0.75), knob: std(0x141416, 0.5), metal: std(0xc9ccd2, 0.3, 0.85), chrome: std(0xd8dade, 0.15, 1),
  plug: std(0xd4b05a, 0.3, 0.85), cavity: std(0x050506, 1), pcblue: std(0x1f63c4, 0.42), pcgrey: std(0xa3a8ae, 0.5), badge: std(0xd9d6cf, 0.5),
};
/** The socket a plug of this gender mates with. */
const mate = (g: Gender): Gender => (g === "male" ? "female" : g === "female" ? "male" : "none");

/** A connector as meshes, +Y out of its face. */
export function connectorMesh(kind: Connector): THREE.Group {
  const g = new THREE.Group(), body = new THREE.Group(), end = realEnd(kind);
  g.name = `end:${kind}`;
  for (const p of plugPieces(end.type, mate(end.gender))) body.add(new THREE.Mesh(p.geo, LOOK[p.slot] ?? LOOK.rubber));
  // the models build a plug nose-first along -z: turn that to +Y, the nose a little proud of the origin
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.02;
  g.add(body);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
/** Set a connector at `at`, pointing from `from` to `at` (out of the cable's last stretch, into its jack). */
export function aimEnd(m: THREE.Object3D, at: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }) {
  dir.set(at.x - from.x, at.y - from.y, at.z - from.z);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  // The body sits on the cable's end, its face a plug's length on.
  m.position.set(at.x, at.y, at.z).addScaledVector(dir, 0.01);
}
