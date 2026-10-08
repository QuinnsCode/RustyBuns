import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { COUNTDOWN_TICKS } from "../src/sim/rules.ts";
import { cuesFor, newCues, type Cue } from "../src/client/cues.ts";
import { DEFAULTS, PRESETS, QUALITIES, motionReduced, parseSettings, viewOf } from "../src/client/settings.ts";
import { HippoRig } from "../src/client/render/hippo.ts";
import { buildOffice } from "../src/client/render/office.ts";
import { countDrawables, mergeChildren } from "../src/client/render/merge.ts";
import { DROP_CUES } from "../src/client/ui/Help.tsx";

describe("settings", () => {
  test("old saves keep what they had and pick up the new options' defaults", () => {
    const s = parseSettings(JSON.stringify({ name: "Ryan", muted: true, secs: 90 }));
    expect(s).toEqual({ ...DEFAULTS, name: "Ryan", muted: true, secs: 90 });
    expect(s.reducedMotion).toBe(null);                    // follow the system until the player chooses
  });

  test("anything malformed falls back field by field", () => {
    expect(parseSettings("not json")).toEqual(DEFAULTS);
    expect(parseSettings("null")).toEqual(DEFAULTS);
    const s = parseSettings(JSON.stringify({ quality: "ultra", reducedMotion: "yes", filmLook: 0, music: false }));
    expect([s.quality, s.reducedMotion, s.filmLook, s.music]).toEqual(["high", null, true, false]);
  });

  test("reduced motion: the system decides until the player picks, then the player does", () => {
    expect(motionReduced({ ...DEFAULTS }, true)).toBe(true);
    expect(motionReduced({ ...DEFAULTS }, false)).toBe(false);
    expect(motionReduced({ ...DEFAULTS, reducedMotion: false }, true)).toBe(false);
    expect(motionReduced({ ...DEFAULTS, reducedMotion: true }, false)).toBe(true);
    expect(viewOf({ ...DEFAULTS, quality: "low", filmLook: false }, true)).toEqual({ reducedMotion: true, filmLook: false, quality: "low" });
  });

  test("each quality preset asks no more than the one above it", () => {
    for (let i = 1; i < QUALITIES.length; i++) {
      const lo = PRESETS[QUALITIES[i - 1]!], hi = PRESETS[QUALITIES[i]!];
      expect(lo.foliage).toBeLessThan(hi.foliage); expect(lo.fluidCap).toBeLessThan(hi.fluidCap);
      expect(lo.pixelRatio).toBeLessThanOrEqual(hi.pixelRatio); expect(lo.shadowMap).toBeLessThanOrEqual(hi.shadowMap);
    }
    expect(PRESETS.high.fluidCap).toBe(1400);              // the fluid's own cap: high changes nothing
  });
});

describe("countdown cues", () => {
  const play = (st: ReturnType<typeof newCues>, phase: "countdown" | "playing" | "podium", ticks: number, n = 1) => {
    const out: Cue[] = [];
    for (let i = 0; i < n; i++) out.push(...cuesFor(st, phase, ticks));
    return out;
  };
  const countdown = (st: ReturnType<typeof newCues>) => { const out: Cue[] = []; for (let t = COUNTDOWN_TICKS; t >= 1; t--) out.push(...cuesFor(st, "countdown", t)); return out; };

  test("each number beeps once, then CHOMP!, then the fanfare at the podium", () => {
    const st = newCues();
    expect(countdown(st)).toEqual(["tick", "tick", "tick"]);
    expect(play(st, "playing", 0, 50)).toEqual(["go"]);
    expect(play(st, "podium", 0, 50)).toEqual(["fanfare"]);
  });

  test("a rematch (podium -> countdown) beeps the first number once, not twice", () => {
    const st = newCues();
    countdown(st); play(st, "playing", 0, 5); play(st, "podium", 0, 5);
    expect(countdown(st)).toEqual(["tick", "tick", "tick"]);
    expect(play(st, "playing", 0, 3)).toEqual(["go"]);
  });

  test("joining mid-round says go once and does not replay a countdown", () => {
    const st = newCues();
    expect(play(st, "playing", 0, 10)).toEqual(["go"]);
  });
});

describe("fewer draw calls", () => {
  test("a hippo is a couple of dozen draws, with the moving parts still separate", () => {
    for (let seat = 0; seat < 4; seat++) {
      const r = new HippoRig(seat);
      expect(countDrawables(r.group)).toBeLessThanOrEqual(26);           // it was 84-106
      const brows = (r as unknown as { brows: THREE.Mesh[] }).brows;
      for (const b of brows) expect(b.parent).not.toBe(null);            // the brows still animate on their own
      r.setChampion(true);
      expect(r.belt.visible).toBe(true);
    }
  });

  test("merging keeps every vertex where it was", () => {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m); b.position.set(i * 3, i, -i); b.rotation.y = i; b.scale.setScalar(1 + i * 0.1); g.add(b); }
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), m));        // a non-indexed one in the mix
    const before = new THREE.Box3().setFromObject(g);
    expect(mergeChildren(g)).toBe(5);
    expect(g.children.length).toBe(1);
    const after = new THREE.Box3().setFromObject(g);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
  });

  test("an outpost is a handful of draws", () => {
    for (let seat = 0; seat < 4; seat++) expect(countDrawables(buildOffice(seat).group)).toBeLessThanOrEqual(6);   // it was 39-44
  });
});

test("the five drops each have their own shape and name, not only a colour", () => {
  expect(new Set(DROP_CUES.map((d) => d.shape)).size).toBe(5);
  expect(new Set(DROP_CUES.map((d) => d.name)).size).toBe(5);
  expect(DROP_CUES.map((d) => d.kind).sort()).toEqual([0, 1, 2, 3, 4]);
});

test("the far peaks have no NaN in them (bloom would smear one into black blocks)", async () => {
  const { mountains } = await import("../src/client/render/jungle.ts");
  for (const c of mountains().children as THREE.Mesh[]) for (const a of Object.values(c.geometry.attributes)) for (const v of (a as THREE.BufferAttribute).array) expect(Number.isFinite(v)).toBe(true);
});
