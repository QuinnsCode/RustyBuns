// Campers, rangers and Bigfoot, built as body parts the page hangs on its joints.
//
//   bun scripts/characters.ts
//
// Writes public/models/characters.glb: one object per part, each with its origin on the joint it hangs from,
// in the game's frame and units (metres, feet at y = 0, facing +z), with a mesh per material slot. The page
// (src/ui/characters.ts) builds the same joints (hips at HIP_Y, knees THIGH below, shoulders, elbows, the head)
// and hangs these parts on them, so pose() walks and crouches them unchanged. Slots are named by role ("shirt",
// "pants", "skin", "hat", ...); the page recolours them per Look, so the colours here are only defaults.
//
// The look: chunky, flat-shaded, low-poly, read from 30 m. A camper wears a quilted puffer jacket with a hood
// on its back and drawcords at the collar, cargo pants, laced hiking boots on thick soles, and one of three hair
// styles (short, curly, long) under a beanie, cap or bucket hat. A ranger wears the campaign hat (dented crown,
// band and a brass badge), a shirt with pleated pockets, epaulettes, a tie, a badge and a name plate, a duty
// belt with a radio and a pouch, a shoulder mic with a red light, and carries a big flashlight. Hands have
// fingers and a thumb. Heads are a touch big, with a nose bridge, lids over the eyes and a smile.
import * as THREE from "three";
import { R, along, ball, box, loft, part as gather, triangles, type Palette, type Piece } from "@rustybuns/models";
import { toGlb } from "@rustybuns/models/glb";

const HIP_Y = 0.9;
/** A height above the ground, as an offset from the hips (where everything above them hangs). */
const U = (y: number) => y - HIP_Y;
/** Heads a touch big, so faces and hats read from across a meadow. */
const HEAD = 1.1;

const c = (hex: string, rough = 0.85, metal = 0, glow?: number): [string, number, number, number?] => [hex, rough, metal, glow];
const PALETTE: Palette = {
  shirt: c("#d9482b"), shirtDark: c("#86301f"), zip: c("#5e2216"), pocket: c("#a08a60"),
  pants: c("#3b3f4a"), pantsDark: c("#2c2f37"), skin: c("#e0b089", 0.7), skinDark: c("#c99a74", 0.7),
  boot: c("#5a3b24"), bootDark: c("#3d2818"), sole: c("#1d1611"),
  hair: c("#4f3220"), brow: c("#3f2819"), hat: c("#1aa39a"), hatDark: c("#127068"), pom: c("#f2efe6", 1),
  band: c("#3b2a1a"), pack: c("#e0a526"), packDark: c("#86631a"), strap: c("#654a13"), roll: c("#5a6b3a"),
  bottle: c("#7fb3c8", 0.5), eyeWhite: c("#f7f4ee", 0.4), pupil: c("#1b1712", 0.3), mouth: c("#6e2f26"),
  belt: c("#3b2a1a"), patch: c("#5b6b3a"), radio: c("#1e2226", 0.6),
  buckle: c("#c9a646", 0.35, 0.7), badge: c("#e8c547", 0.3, 0.7),
  stripe: c("#d8ff3a", 0.6, 0, 0.4), torch: c("#2a2a2a", 0.4, 0.5), lens: c("#fff8e0", 0.2, 0, 3),
  led: c("#ff3b2f", 0.4, 0, 2),
  fur: c("#4a3423", 1), furDark: c("#33231a", 1), hide: c("#2a1e17", 0.75), bfEye: c("#f2c14e", 0.4, 0, 1.5),
};

const PARTS: THREE.Group[] = [];
const part = (name: string, ...pieces: Piece[]) => PARTS.push(gather(name, pieces, PALETTE));
const headPart = (name: string, ...pieces: Piece[]) => PARTS.push(gather(name, pieces, PALETTE, new THREE.Matrix4().makeScale(HEAD, HEAD, HEAD)));
const S = [-1, 1] as const;
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

// ---- legs: the thigh hangs from the hip, the shin and boot from the knee -------------------------------------
part("thigh",
  loft("pants", [R(0.07, 0.092, 0.098), R(0.0, 0.1, 0.106), R(-0.2, 0.09, 0.094), R(-0.38, 0.074, 0.078), R(-0.46, 0.066, 0.07)], { p: 2.2 }),
  // a cargo pocket on the front of the thigh, with its flap
  box("pantsDark", [0.08, 0.09, 0.022], [0, -0.225, 0.084], { bevel: 0.006 }),
  box("pantsDark", [0.086, 0.026, 0.028], [0, -0.172, 0.085], { bevel: 0.005 }));
part("shin",
  loft("pants", [R(0.04, 0.07, 0.074), R(-0.12, 0.074, 0.08), R(-0.27, 0.064, 0.068)], { p: 2.2 }),
  loft("pantsDark", [R(-0.24, 0.082, 0.086), R(-0.31, 0.08, 0.084)], { p: 2.2 }));
part("boot",
  loft("boot", [R(-0.27, 0.074, 0.08), R(-0.34, 0.078, 0.087), R(-0.405, 0.082, 0.095, { cz: 0.012 })], { p: 2.6 }),
  loft("bootDark", [R(-0.262, 0.081, 0.088), R(-0.295, 0.081, 0.088)], { p: 2.6 }),
  box("bootDark", [0.05, 0.1, 0.02], [0, -0.325, 0.085], { bevel: 0.005, rot: [-0.22, 0, 0] }),
  ...[0, 1, 2].map((i) => box("sole", [0.08, 0.012, 0.012], [0, -0.305 - i * 0.034, 0.086 + i * 0.005], { rot: [0, 0, i % 2 ? 0.55 : -0.55] })),
  box("boot", [0.15, 0.1, 0.27], [0, -0.41, 0.045], { bevel: 0.035 }),
  box("bootDark", [0.152, 0.06, 0.075], [0, -0.428, 0.15], { bevel: 0.02 }),
  box("bootDark", [0.152, 0.06, 0.07], [0, -0.428, -0.06], { bevel: 0.02 }),
  box("sole", [0.162, 0.034, 0.285], [0, -0.453, 0.045], { bevel: 0.01 }));

// ---- above the hips: pelvis, the camper's jacket or the ranger's shirt, a pack -------------------------------
part("pelvis", loft("pants", [R(U(1.07), 0.168, 0.115), R(U(0.97), 0.188, 0.128), R(U(0.88), 0.175, 0.118), R(U(0.82), 0.12, 0.09)], { seg: 10, p: 2.6 }));
const shell = () => loft("shirt", [R(U(1.0), 0.178, 0.122), R(U(1.12), 0.176, 0.12), R(U(1.3), 0.2, 0.134),
  R(U(1.44), 0.208, 0.136), R(U(1.53), 0.185, 0.122), R(U(1.6), 0.118, 0.094)], { seg: 10, p: 2.3 });
const neck = () => loft("skin", [R(U(1.58), 0.06, 0.058), R(U(1.73), 0.054, 0.052)], { seg: 8 });
const collar = () => loft("shirtDark", [R(U(1.57), 0.118, 0.096), R(U(1.645), 0.092, 0.078)], { seg: 10 });

// The puffer jacket: raised seams between its baffles, a hood lying on the back, drawcords, a zipped chest pocket.
part("torso", shell(), neck(), collar(),
  ...([[1.13, 0.181, 0.125], [1.235, 0.196, 0.134], [1.34, 0.208, 0.14], [1.445, 0.212, 0.141]] as const)
    .map(([y, rx, rz]) => loft("shirtDark", [R(U(y) - 0.006, rx, rz), R(U(y) + 0.006, rx, rz)], { seg: 10, p: 2.3 })),
  ...S.map((s) => box("zip", [0.012, 0.1, 0.012], [0.045 * s, U(1.5), 0.128])),
  loft("shirtDark", [R(U(0.975), 0.19, 0.134), R(U(1.065), 0.19, 0.134)], { seg: 10, p: 2.3 }),
  loft("shirt", [R(U(1.5), 0.13, 0.06, { cz: -0.1 }), R(U(1.6), 0.15, 0.085, { cz: -0.13 }),
    R(U(1.68), 0.12, 0.07, { cz: -0.15 }), R(U(1.72), 0, 0, { cz: -0.16 })], { seg: 10, p: 2.4 }),
  box("zip", [0.018, 0.47, 0.03], [0, U(1.31), 0.126]),
  box("zip", [0.022, 0.05, 0.02], [0, U(1.52), 0.136]),
  box("shirtDark", [0.085, 0.07, 0.014], [0.095, U(1.37), 0.136], { bevel: 0.004 }),
  box("zip", [0.085, 0.01, 0.01], [0.095, U(1.4), 0.144]));

// The ranger's shirt: pleated pockets with button flaps, epaulettes, a tie down the placket, a duty belt with
// a radio on the left hip and a pouch on the right, and a shoulder mic clipped by the collar.
part("rangerTorso", shell(), neck(), collar(),
  ...S.flatMap((s) => [
    box("pocket", [0.1, 0.095, 0.03], [0.088 * s, U(1.37), 0.122], { bevel: 0.008 }),
    box("shirtDark", [0.012, 0.085, 0.036], [0.088 * s, U(1.365), 0.123]),
    box("shirtDark", [0.106, 0.03, 0.036], [0.088 * s, U(1.425), 0.124], { bevel: 0.006 }),
    ball("band", 0.009, [0.088 * s, U(1.414), 0.143], { seg: 6, rings: 3 }),
    box("shirtDark", [0.12, 0.016, 0.05], [0.16 * s, U(1.582), 0.0], { bevel: 0.004, rot: [0, 0, -0.2 * s] }),
    ball("band", 0.011, [0.105 * s, U(1.6), 0.0], { seg: 6, rings: 3 }),
  ]),
  box("shirtDark", [0.03, 0.42, 0.03], [0, U(1.3), 0.116]),
  box("band", [0.042, 0.3, 0.016], [0, U(1.4), 0.13], { bevel: 0.004 }),
  box("band", [0.052, 0.042, 0.028], [0, U(1.565), 0.108], { bevel: 0.006 }),
  loft("belt", [R(U(0.955), 0.194, 0.136), R(U(1.045), 0.194, 0.136)], { seg: 10, p: 2.4 }),
  box("radio", [0.036, 0.1, 0.05], [-0.212, U(1.0), -0.005], { bevel: 0.006 }),
  box("radio", [0.01, 0.11, 0.01], [-0.212, U(1.095), -0.015]),
  box("belt", [0.04, 0.075, 0.08], [0.212, U(0.995), 0.0], { bevel: 0.008 }),
  box("band", [0.044, 0.025, 0.084], [0.212, U(1.028), 0.0], { bevel: 0.005 }),
  box("radio", [0.036, 0.046, 0.026], [-0.108, U(1.515), 0.118], { bevel: 0.005, rot: [0.25, 0, 0] }),
  loft("pantsDark", [R(U(1.1), 0.18, 0.124), R(U(1.11), 0.18, 0.124)], { seg: 10, p: 2.3 }));
// Shiny or glowing bits keep their own materials, so they're their own parts.
part("buckle", box("buckle", [0.065, 0.048, 0.02], [0, U(1.003), 0.134], { bevel: 0.006 }));
part("badge", loft("badge", [R(0.01, 0.036), R(-0.01, 0.036)], { seg: 6, rot: 0, m: along("z", [-0.088, U(1.462), 0.124]) }),
  box("badge", [0.072, 0.018, 0.01], [0.088, U(1.462), 0.138]));
part("stripe", loft("stripe", [R(U(1.13), 0.186, 0.129), R(U(1.175), 0.19, 0.131)], { seg: 10, p: 2.3 }));
part("led", ball("led", 0.007, [-0.108, U(1.532), 0.136], { seg: 6, rings: 3 }));

const bottleAt = at(0.182, 0, -0.225);
part("pack",
  loft("pack", [R(U(1.08), 0.15, 0.075, { cz: -0.225 }), R(U(1.42), 0.162, 0.088, { cz: -0.225 }), R(U(1.5), 0.145, 0.078, { cz: -0.22 })], { seg: 8, p: 3.5 }),
  loft("packDark", [R(U(1.45), 0.168, 0.094, { cz: -0.225 }), R(U(1.53), 0.15, 0.082, { cz: -0.22 }), R(U(1.55), 0.1, 0.05, { cz: -0.22 })], { seg: 8, p: 3.5 }),
  box("packDark", [0.22, 0.16, 0.06], [0, U(1.21), -0.31], { bevel: 0.02 }),
  box("packDark", [0.05, 0.14, 0.1], [-0.178, U(1.2), -0.225], { bevel: 0.012 }),
  // a water bottle in the right side pocket
  loft("bottle", [R(U(1.12), 0.034), R(U(1.3), 0.034), R(U(1.325), 0.022)], { seg: 8, m: bottleAt }),
  loft("band", [R(U(1.32), 0.024), R(U(1.36), 0.024)], { seg: 8, m: bottleAt }),
  box("strap", [0.24, 0.025, 0.015], [0, U(1.42), 0.122]),
  loft("roll", [R(0.21, 0.078), R(-0.21, 0.078)], { seg: 10, m: along("x", [0, U(1.0), -0.225]) }),
  ...S.flatMap((s) => [
    box("strap", [0.036, 0.3, 0.02], [0.105 * s, U(1.41), 0.11], { rot: [-0.14, 0, 0] }),
    box("strap", [0.03, 0.17, 0.17], [0.13 * s, U(1.0), -0.225]),
  ]));

// ---- arms: the upper arm hangs from the shoulder, the forearm, hand and flashlight from the elbow ------------
part("upperArm", loft("shirt", [R(0.065, 0, 0), R(0.048, 0.054, 0.054), R(0.0, 0.07, 0.068), R(-0.15, 0.064, 0.064), R(-0.3, 0.057, 0.057)]));
part("forearm",
  loft("shirt", [R(0.035, 0.062, 0.062), R(-0.12, 0.059, 0.059), R(-0.22, 0.05, 0.05)]),
  loft("shirtDark", [R(-0.2, 0.062, 0.062), R(-0.255, 0.06, 0.06)]));
for (const [side, s] of [["L", -1], ["R", 1]] as const) {
  part("hand" + side,
    box("skin", [0.072, 0.085, 0.036], [0, -0.295, 0.01], { bevel: 0.012 }),
    box("skin", [0.022, 0.055, 0.024], [-0.042 * s, -0.305, 0.028], { bevel: 0.008, rot: [0, 0, 0.4 * s] }),
    ...[0, 1, 2, 3].map((i) => box("skin", [0.016, 0.06, 0.022], [-0.0255 + i * 0.017, -0.355, 0.012], { bevel: 0.004 })));
  part("patch" + side, loft("patch", [R(0.006, 0.04), R(-0.006, 0.04)], { seg: 8, m: along("x", [0.074 * s, -0.08, 0]) }));
}
// held in the right hand, pointing down the forearm: pose() raises that arm so it shines ahead
part("flashlight",
  loft("torch", [R(-0.26, 0.03), R(-0.5, 0.03)], { seg: 8 }),
  loft("torch", [R(-0.3, 0.035), R(-0.34, 0.035)], { seg: 8 }),
  loft("torch", [R(-0.37, 0.035), R(-0.41, 0.035)], { seg: 8 }),
  loft("torch", [R(-0.495, 0.034), R(-0.56, 0.054), R(-0.578, 0.054)], { seg: 10 }),
  box("band", [0.018, 0.03, 0.012], [0, -0.28, 0.036]));
part("lens", loft("lens", [R(-0.577, 0.047), R(-0.585, 0.047)], { seg: 10 }));

// ---- the head: hangs from the neck joint, face baked in; hair and hats on top -------------------------------
headPart("head",
  loft("skin", [R(-0.02, 0.06, 0.06, { cz: 0.015 }), R(0.045, 0.128, 0.124, { cz: 0.02 }), R(0.1, 0.156, 0.154, { cz: 0.01 }),
    R(0.17, 0.166, 0.162), R(0.245, 0.155, 0.15), R(0.3, 0.11, 0.108), R(0.325, 0, 0)], { seg: 12, p: 2.4, smooth: true }),
  box("skinDark", [0.04, 0.048, 0.04], [0, 0.122, 0.164], { bevel: 0.013 }),
  box("skinDark", [0.024, 0.045, 0.022], [0, 0.158, 0.156], { bevel: 0.006 }),
  ...S.flatMap((s) => [
    loft("eyeWhite", [R(0.009, 0.024, 0.03), R(-0.009, 0.024, 0.03)], { seg: 8, rot: 0, m: along("z", [0.058 * s, 0.165, 0.148]) }),
    loft("pupil", [R(0.004, 0.016, 0.021), R(-0.004, 0.016, 0.021)], { seg: 8, rot: 0, m: along("z", [0.059 * s, 0.162, 0.157]) }),
    box("skinDark", [0.05, 0.009, 0.02], [0.058 * s, 0.184, 0.148], { bevel: 0.002 }),
    box("brow", [0.064, 0.018, 0.02], [0.06 * s, 0.212, 0.148], { bevel: 0.004, rot: [0, 0, -0.14 * s] }),
    // a smile: each half rises towards its corner
    box("mouth", [0.032, 0.011, 0.016], [0.019 * s, 0.078, 0.147], { rot: [0, 0, 0.4 * s] }),
    ball("skin", 0.04, [0.163 * s, 0.14, -0.005], { scale: [0.45, 1, 0.75], seg: 6, rings: 4 }),
  ]));

// Three hair styles with no hat on (short and swept, curly, long down the back), and what shows under a hat.
const cap = [R(0.14, 0.17, 0.172, { cz: -0.006, tilt: 0.09 }), R(0.225, 0.172, 0.17, { cz: -0.004 }), R(0.29, 0.13, 0.13), R(0.345, 0, 0)];
const fringe = () => box("hair", [0.21, 0.05, 0.08], [0.025, 0.27, 0.12], { bevel: 0.015, rot: [0.55, 0, -0.2] });
const back = () => loft("hair", [R(-0.18, 0.08, 0.03, { cz: -0.11 }), R(-0.12, 0.12, 0.045, { cz: -0.12 }),
  R(0.05, 0.15, 0.05, { cz: -0.13 }), R(0.2, 0.14, 0.05, { cz: -0.12 })], { seg: 8, p: 2.4 });
const locks = () => S.map((s) => box("hair", [0.045, 0.22, 0.065], [0.152 * s, 0.06, 0.035], { bevel: 0.012 }));
headPart("hair", loft("hair", cap, { seg: 12, p: 2.3 }), fringe(),
  box("hair", [0.07, 0.05, 0.1], [-0.04, 0.33, 0.02], { bevel: 0.015, rot: [-0.3, 0, 0.4] }));
headPart("hairCurly", loft("hair", [R(0.13, 0.17, 0.172, { cz: -0.006, tilt: 0.09 }), R(0.2, 0.192, 0.19, { cz: -0.01, jag: 0.16 }),
  R(0.28, 0.168, 0.164, { jag: 0.2 }), R(0.35, 0.1, 0.1, { jag: 0.25 }), R(0.378, 0, 0)], { seg: 14, p: 2.2, rot: 0 }));
headPart("hairLong", loft("hair", cap, { seg: 12, p: 2.3 }), fringe(), back(), ...locks());
const under = [R(0.14, 0.168, 0.17, { cz: -0.006, tilt: 0.07 }), R(0.22, 0.17, 0.168), R(0.27, 0.13, 0.13)];
headPart("hairHat", loft("hair", under, { seg: 12, p: 2.3 }));
headPart("hairHatLong", loft("hair", under, { seg: 12, p: 2.3 }), back(), ...locks());

headPart("beanie",
  loft("hatDark", [R(0.19, 0.183, 0.181, { tilt: 0.03, jag: 0.035 }), R(0.275, 0.187, 0.185, { tilt: 0.03, jag: 0.035 })], { seg: 16, p: 2.3 }),
  loft("hat", [R(0.265, 0.177, 0.175, { tilt: 0.03, jag: 0.03 }), R(0.33, 0.153, 0.151, { jag: 0.03 }),
    R(0.39, 0.09, 0.09, { jag: 0.03 }), R(0.41, 0, 0)], { seg: 16, p: 2.3 }),
  ball("pom", 0.055, [0, 0.43, -0.012], { seg: 8, rings: 4, jag: 0.3 }));
headPart("cap",
  loft("hat", [R(0.215, 0.178, 0.176, { tilt: 0.02 }), R(0.3, 0.156, 0.152), R(0.35, 0.09, 0.09), R(0.365, 0, 0)], { seg: 12, p: 2.3 }),
  loft("hatDark", [R(0.245, 0.14, 0.125, { cz: 0.17, tilt: -0.04 }), R(0.228, 0.14, 0.125, { cz: 0.17, tilt: -0.04 })], { seg: 12, p: 2.2 }),
  box("hatDark", [0.07, 0.022, 0.012], [0, 0.25, -0.172]),
  ball("hatDark", 0.02, [0, 0.366, 0], { seg: 6, rings: 3 }));
headPart("bucket",
  loft("hat", [R(0.23, 0.172, 0.17), R(0.37, 0.146, 0.144)], { seg: 12, p: 2.2 }),
  loft("hatDark", [R(0.235, 0.177, 0.175), R(0.275, 0.175, 0.173)], { seg: 12, p: 2.2 }),
  loft("hat", [R(0.252, 0.17, 0.168), R(0.192, 0.27, 0.265), R(0.176, 0.27, 0.265), R(0.235, 0.165, 0.163)], { seg: 12, closed: true }),
  loft("hatDark", [R(0.209, 0.236, 0.233), R(0.219, 0.236, 0.233)], { seg: 12 }),
  // a chin cord from the brim, with a toggle under the chin
  ...S.map((s) => box("band", [0.009, 0.27, 0.009], [0.172 * s, 0.085, 0.035], { rot: [0.08, 0, 0.06 * s] })),
  box("band", [0.33, 0.009, 0.009], [0, -0.04, 0.06]),
  box("hatDark", [0.03, 0.022, 0.022], [0, -0.04, 0.065], { bevel: 0.004 }));
// The campaign hat: a wide brim that curls up at its edge, a band, and a crown pinched in at four points.
headPart("rangerHat",
  loft("hat", [R(0.262, 0.16), R(0.248, 0.3), R(0.268, 0.335), R(0.25, 0.335), R(0.232, 0.3), R(0.245, 0.16)], { seg: 16, closed: true }),
  loft("band", [R(0.25, 0.163), R(0.305, 0.159)], { seg: 12 }),
  loft("hat", [R(0.27, 0.159), R(0.33, 0.152, 0.152, { jag: -0.12 }), R(0.4, 0.138, 0.138, { jag: -0.3 }), R(0.45, 0.105, 0.105, { jag: -0.4 }),
    R(0.468, 0.045, 0.045, { jag: -0.4 }), R(0.472, 0, 0)], { seg: 8, rot: 0 }));
headPart("hatBadge", loft("badge", [R(0.008, 0.028), R(-0.008, 0.028)], { seg: 6, rot: 0, m: along("z", [0, 0.28, 0.163]) }));

// ---- Bigfoot: his own joints (wider hips and shoulders, longer arms), all fur, a bare face -----------------
part("bfThigh", loft("fur", [R(0.09, 0.13), R(0.0, 0.142), R(-0.2, 0.128, 0.128, { jag: 0.12 }), R(-0.42, 0.1, 0.1, { jag: 0.3 }), R(-0.47, 0.09)], { seg: 10 }));
part("bfShin",
  loft("fur", [R(0.04, 0.1), R(-0.14, 0.108, 0.108, { jag: 0.15 }), R(-0.32, 0.088, 0.088, { jag: 0.32 }), R(-0.37, 0.075)], { seg: 10 }),
  box("hide", [0.19, 0.1, 0.4], [0, -0.42, 0.07], { bevel: 0.04 }),
  ...[-0.06, 0, 0.06].map((x) => box("hide", [0.045, 0.05, 0.06], [x, -0.45, 0.25], { bevel: 0.015 })));
part("bfTorso",
  loft("fur", [R(U(0.8), 0.18, 0.15), R(U(0.95), 0.27, 0.21, { jag: 0.35 }), R(U(1.18), 0.32, 0.24, { jag: 0.1 }),
    R(U(1.42), 0.345, 0.255, { cz: -0.03, jag: 0.12 }), R(U(1.6), 0.31, 0.25, { cz: -0.07, jag: 0.3 }),
    R(U(1.74), 0.17, 0.17, { cz: -0.06 }), R(U(1.79), 0, 0, { cz: -0.06 })], { seg: 12 }));
part("bfUpperArm", loft("fur", [R(0.12, 0, 0), R(0.08, 0.1), R(0.0, 0.125, 0.125, { jag: 0.15 }), R(-0.2, 0.105, 0.105, { jag: 0.45 }), R(-0.4, 0.085)], { seg: 10 }));
for (const [side, s] of [["L", -1], ["R", 1]] as const) {
  part("bfForearm" + side,
    loft("fur", [R(0.03, 0.092), R(-0.15, 0.098, 0.098, { jag: 0.45 }), R(-0.3, 0.08, 0.08, { jag: 0.3 }), R(-0.34, 0.07)], { seg: 10 }),
    box("hide", [0.1, 0.17, 0.11], [0, -0.41, 0.01], { bevel: 0.035 }),
    box("hide", [0.04, 0.08, 0.045], [-0.045 * s, -0.37, 0.06], { bevel: 0.015, rot: [0, 0, 0.35 * s] }));
}
part("bfHead",
  loft("fur", [R(0.0, 0.12, 0.12, { cz: -0.02 }), R(0.08, 0.185, 0.18, { jag: 0.15 }), R(0.18, 0.185, 0.18),
    R(0.27, 0.13, 0.14, { cz: -0.03 }), R(0.34, 0.05, 0.09, { cz: -0.05 }), R(0.35, 0, 0, { cz: -0.06 })], { seg: 10 }),
  ball("hide", 0.13, [0, 0.1, 0.085], { scale: [0.95, 1.0, 0.75], seg: 10, rings: 5 }),
  box("furDark", [0.25, 0.055, 0.075], [0, 0.175, 0.16], { bevel: 0.02 }),
  box("hide", [0.07, 0.05, 0.05], [0, 0.095, 0.19], { bevel: 0.016 }),
  box("pupil", [0.08, 0.012, 0.02], [0, 0.04, 0.175]),
  ...S.map((s) => ball("bfEye", 0.022, [0.055 * s, 0.13, 0.19], { seg: 6, rings: 3 })));

const scene = new THREE.Scene();
scene.add(...PARTS);
for (const p of PARTS) console.log(`  ${p.name}: ${triangles(p)}`);
const out = new URL("../public/models/characters.glb", import.meta.url);
await Bun.write(out, await toGlb(scene));
console.log(`${triangles(scene)} triangles in ${PARTS.length} parts -> public/models/characters.glb (${Math.round(Bun.file(out).size / 1024)} KB)`);
