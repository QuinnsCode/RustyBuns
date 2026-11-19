// Qollab Studio's drum kit: every part a track can hit is there and flashes on its own material, every cymbal kind is
// turned from a profile with real thickness, and the kit stands on the floor inside a phone's budget at both qualities.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { CYMBALS, cymbalProfile, drumKit, type CymbalKind, type DrumPart } from "../src/drums.ts";
import { triangles } from "../src/index.ts";

const PARTS: DrumPart[] = ["kick", "snare", "hi", "mid", "tom", "hat", "crash", "crash2", "ride", "splash", "china"];

test("the kit: every part to hit, on the floor, in a phone's budget", () => {
  for (const quality of ["high", "low"] as const) {
    const kit = drumKit({ quality });
    expect(kit.pieces.map((p) => p.part).sort()).toEqual([...PARTS].sort());
    // each piece flashes its own copies: lighting one never lights another
    const mats = kit.pieces.flatMap((p) => p.flash);
    expect(new Set(mats).size).toBe(mats.length);
    expect(kit.pieces.filter((p) => p.cymbal).map((p) => p.part).sort()).toEqual(CYMBALS.map((c) => c.part).sort());
    const box = new THREE.Box3().setFromObject(kit.group);
    expect(box.min.y).toBeGreaterThan(-0.003);
    let draws = 0;
    kit.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) draws++; });
    expect(draws).toBeLessThanOrEqual(40);
    expect(triangles(kit.group)).toBeLessThan(quality === "high" ? 60000 : 42000);
    expect(kit.mics.map((m) => m.name).sort()).toEqual(["hat", "hi", "kick", "mid", "snare", "tom"]);
  }
});

test("each cymbal kind: a closed profile with bronze under it everywhere, a bell above its bow, a china's edge turned up", () => {
  for (const kind of ["hat", "crash", "ride", "splash", "china"] as CymbalKind[]) {
    const r = 0.2, p = cymbalProfile(kind, r), half = (p.length - 1) / 2;
    const bottom = p.slice(0, Math.floor(half)), top = p.slice(Math.ceil(half) + 1).reverse();
    expect(top.length).toBe(bottom.length);
    top.forEach((t, i) => expect(t.y - bottom[i]!.y).toBeGreaterThan(0.0005));
    const at = (x: number) => top.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)).y;
    expect(at(0.02)).toBeGreaterThan(at(0.12));
    if (kind === "china") expect(at(r)).toBeGreaterThan(at(0.8 * r));
    else expect(at(r)).toBeLessThan(at(0.8 * r));
  }
});
