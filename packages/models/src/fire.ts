// A camp fire pit, for an open-air party's chill corner (Qollab Studio's desert gathering, Sound Guy Simulator's camp).
// Its own materials; centred on x and z, standing on y = 0, metres.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

/**
 * A fire pit about a metre across: eleven stones in a ring, five split logs leant into a teepee (charred where they
 * meet), a glowing bed of embers, three flames that sway and stretch on their own beats, and a warm light that breathes
 * with them. `tick(t)` moves the flames and the light.
 */
export function firePit(seed: number): { group: THREE.Group; tick: (t: number) => void } {
  const g = new THREE.Group(), rnd = mulberry32(seed);
  g.name = "fire-pit";
  const stone = new THREE.MeshStandardMaterial({ color: "#5e574f", roughness: 0.97, flatShading: true }), stoneGeo = new THREE.DodecahedronGeometry(0.11, 1);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.15, s = new THREE.Mesh(stoneGeo, stone);
    s.position.set(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5);
    s.scale.set(0.9 + rnd() * 0.5, 0.55 + rnd() * 0.3, 0.8 + rnd() * 0.4);
    s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    g.add(s);
  }
  // the bed: ash grey at the edge, embers in the middle
  const bed = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#2b2522", roughness: 1 }));
  bed.position.y = 0.01; g.add(bed);
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#1a0a04", emissive: "#ff4a10", emissiveIntensity: 1.6, roughness: 1 }));
  embers.position.y = 0.015; g.add(embers);
  // the logs: bark outside, charred toward the tips where they meet over the embers
  const bark = new THREE.MeshStandardMaterial({ color: "#4d3826", roughness: 0.95 }), char = new THREE.MeshStandardMaterial({ color: "#120c0a", emissive: "#7a1e06", emissiveIntensity: 0.6, roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.4, lean = 0.5 + rnd() * 0.1, len = 0.6 + rnd() * 0.12, r = 0.035 + rnd() * 0.015;
    const log = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len * 0.65, 8), bark);
    body.position.y = len * 0.325;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len * 0.35, 8), char);
    tip.position.y = len * 0.825;
    log.add(body, tip);
    log.position.set(Math.cos(a) * 0.34, 0.02, Math.sin(a) * 0.34);
    // lean in toward the middle, so the tips meet over the embers
    const toward = new THREE.Vector3(-Math.cos(a) * Math.sin(lean), Math.cos(lean), -Math.sin(a) * Math.sin(lean));
    log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toward);
    g.add(log);
  }
  // the flames: soft cones of additive glow, yellow inside orange
  const flameMat = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const flames: { m: THREE.Mesh; base: number; ph: number; hz: number }[] = [];
  for (const [i, [c, o, h, w]] of ([["#ff5a14", 0.5, 0.85, 0.2], ["#ff9a2a", 0.65, 0.66, 0.14], ["#ffe08a", 0.8, 0.44, 0.08]] as const).entries()) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 10, 1, true).translate(0, h / 2, 0), flameMat(c, o));
    m.position.y = 0.04;
    m.renderOrder = 3 + i;
    g.add(m);
    flames.push({ m, base: h, ph: rnd() * 6, hz: 1.7 + rnd() * 1.3 });
  }
  const light = new THREE.PointLight("#ff8a3a", 8, 12, 1.8);
  light.position.y = 0.45; g.add(light);
  return {
    group: g,
    tick(t) {
      let all = 0;
      for (const f of flames) {
        const k = 0.8 + 0.18 * Math.sin(t * f.hz * 2 + f.ph) + 0.1 * Math.sin(t * f.hz * 5.3 + f.ph * 2);
        f.m.scale.set(1 - (k - 1) * 0.5, k, 1 - (k - 1) * 0.5);
        f.m.rotation.set(0.08 * Math.sin(t * 1.3 + f.ph), t * 0.6 + f.ph, 0.08 * Math.cos(t * 1.1 + f.ph));
        all += k;
      }
      light.intensity = 8 * (all / flames.length) * (0.92 + 0.08 * Math.sin(t * 17.3));
    },
  };
}
