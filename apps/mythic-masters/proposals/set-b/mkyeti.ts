// Derives yeti.ts from sasquatch.ts: the same blob ape, hunched, broader, white, with a blue-grey face and a fanged snarl.
let s = await Bun.file(`${import.meta.dir}/sasquatch.ts`).text();
const rep = (a: string, b: string) => { if (!s.includes(a)) throw new Error(`missing: ${a}`); s = s.split(a).join(b); };
rep(s.slice(0, s.indexOf("import")), `// Yeti from the museum and show figures and a Sherpa's drawing of the migoi: a towering ape of the snows, hunched and
// broad, covered in long pale shaggy hair, a pointed crown, a blue-grey bare face with red eyes and a fanged snarl,
// arms hanging to the knees, huge feet.
`);
rep(`hip: [0, 1.04, 0, 0.2]`, `hip: [-0.04, 1.0, 0, 0.21]`);
rep(`belly: [0.03, 1.3, 0, 0.24]`, `belly: [0.04, 1.26, 0, 0.25]`);
rep(`chest: [0.03, 1.56, 0, 0.26]`, `chest: [0.1, 1.5, 0, 0.27]`);
rep(`neck: [0.07, 1.78, 0, 0.18]`, `neck: [0.16, 1.7, 0, 0.19]`);
rep(`head: [0.15, 2.0, 0, 0.17]`, `head: [0.3, 1.86, 0, 0.17]`);
rep(`crest: [0.03, 2.38, 0, 0.06]`, `crest: [0.2, 2.22, 0, 0.06]`);
rep(`mask: [0.32, 1.96, 0, 0.09]`, `mask: [0.47, 1.82, 0, 0.1]`);
rep(`l_shoulder: [0.0, 1.7, 0.4, 0.11]`, `l_shoulder: [0.08, 1.64, 0.44, 0.12]`);
rep(`l_elbow: [-0.05, 1.25, 0.5, 0.08]`, `l_elbow: [0.06, 1.15, 0.55, 0.09]`);
rep(`l_wrist: [0.04, 0.84, 0.5, 0.06]`, `l_wrist: [0.16, 0.72, 0.53, 0.07]`);
rep(`l_hand: [0.08, 0.72, 0.49, 0.05]`, `l_hand: [0.2, 0.6, 0.52, 0.06]`);
rep(`{ at: "chest", off: [-0.01, 0.06, 0], r: [0.29, 0.3, 0.42] }`, `{ at: "chest", off: [-0.02, 0.06, 0], r: [0.31, 0.31, 0.46] }`);
rep(`{ at: "neck", off: [-0.08, -0.02, 0], r: [0.22, 0.2, 0.34] }`, `{ at: "neck", off: [-0.1, 0.0, 0], r: [0.25, 0.22, 0.38] }`);
rep(`[0, -0.02, 0.02], [0.16, 0.17, 0.15]`, `[0, -0.02, 0.02], [0.18, 0.19, 0.17]`);
rep(`[0.11, 0.25, 0.11]`, `[0.13, 0.27, 0.13]`);
rep(`[0.1, 0.24, 0.1]`, `[0.12, 0.25, 0.12]`);
rep(`...pair("l_hand", [0.01, -0.04, 0], [0.075, 0.11, 0.06])`, `...pair("l_hand", [0.01, -0.04, 0], [0.09, 0.12, 0.075])`);
// a snarl in place of the thin mouth: a dark open mouth, fangs up and down
rep(`  // a wide thin mouth
  { kind: "ridge", at: "head", off: on([0.12, -0.1, 0], [1, -0.1, 0], 0.012), dir: [0, 0, 1], len: R(0.1), base: R(0.016), curve: 30, bend: [-1, 0.3, 0], mirror: true, material: "dark" },`,
`  // the snarl: a dark open mouth, two fangs down from the upper lip, two up from the lower, small teeth between
  { kind: "eye", at: "head", off: on([0.1, -0.1, 0], [1, -0.2, 0], 0.03), r: R(0.055), material: "mouth" },
  { kind: "horn", at: "head", off: on([0.1, -0.075, 0.045], [1, -0.1, 0.5], 0.012), dir: [0.15, -1, 0], len: R(0.06), base: R(0.017), curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" },
  { kind: "horn", at: "head", off: on([0.1, -0.135, 0.04], [1, -0.4, 0.5], 0.012), dir: [0.15, 1, 0], len: R(0.045), base: R(0.015), curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" },
  { kind: "horn", at: "head", off: on([0.12, -0.075, 0.015], [1, -0.1, 0.15], 0.012), dir: [0.1, -1, 0], len: R(0.028), base: R(0.012), mirror: true, material: "fang" },`);
rep(`n: 5, len: 0.16, base: 0.09, rows: 9, spread: 90`, `n: 5, len: 0.2, base: 0.1, rows: 9, spread: 100`);
rep(`n: 9, len: 0.2, base: 0.1, rows: 5, spread: 80`, `n: 9, len: 0.26, base: 0.12, rows: 7, spread: 110`);
s = s.replaceAll(`n: 5, len: 0.15, base: 0.08, rows: 5, spread: 120`, `n: 6, len: 0.22, base: 0.1, rows: 5, spread: 140`);
rep(`write("sasquatch"`, `write("yeti"`);
rep(`budget: 8000`, `budget: 8500`);
rep(`    fur: [0.24, 0.15, 0.1, 0.95, 0],
    mane: [0.21, 0.13, 0.08, 0.95, 0],
    face: [0.5, 0.37, 0.29, 0.8, 0],`, `    fur: [0.86, 0.85, 0.82, 0.95, 0],
    mane: [0.93, 0.93, 0.91, 0.95, 0],
    face: [0.36, 0.42, 0.52, 0.75, 0],
    mouth: [0.3, 0.06, 0.08, 0.6, 0],
    fang: [0.95, 0.9, 0.72, 0.3, 0],`);
rep(`eye: [0.95, 0.62, 0.22, 0.3, 0, 1.4]`, `eye: [1, 0.18, 0.12, 0.3, 0, 1.8]`);
rep(`colours: [[0.15, 0.09, 0.06], [0.33, 0.22, 0.15]]`, `colours: [[0.72, 0.72, 0.72], [0.98, 0.98, 0.96]]`);
await Bun.write(`${import.meta.dir}/yeti.ts`, s);

// pass 2: shag as hanging blob clumps instead of tufts (white tufts read as paper shards)
let y = await Bun.file(`${import.meta.dir}/yeti.ts`).text();
y = y.replace(/  \/\/ hair: a ruff[^\n]*\n(  \{ kind: "tuft"[^\n]*\n)+/, "");
const clumps = `  // shag: clumps of long hair hanging off the shoulders, elbows, forearms, flanks and calves, blended into the skin
  ...pair("l_shoulder", [-0.06, -0.12, 0.1], [0.1, 0.2, 0.08], [10, 0, -8]),
  ...pair("l_elbow", [-0.1, -0.06, 0.03], [0.08, 0.17, 0.07], [0, 0, -15]),
  ...pair("l_elbow", [0.0, -0.22, 0.09], [0.07, 0.2, 0.06], [12, 0, 0]),
  ...pair("l_elbow", [-0.07, -0.32, 0.0], [0.065, 0.18, 0.06], [0, 0, -10]),
  ...pair("hip", [-0.05, 0.05, 0.27], [0.09, 0.22, 0.07], [8, 0, 0]),
  ...pair("l_knee", [-0.12, -0.1, 0.02], [0.07, 0.18, 0.06], [0, 0, -12]),
  ...pair("l_knee", [-0.02, -0.25, 0.08], [0.06, 0.15, 0.05], [10, 0, 0]),
  { at: "neck", off: [-0.25, -0.15, 0], r: [0.12, 0.25, 0.25], rot: [0, 0, -10] },
`;
y = y.replace(`  ...head.map((e) =>`, clumps + `  ...head.map((e) =>`);
await Bun.write(`${import.meta.dir}/yeti.ts`, y);

// pass 3: bigger eyes, set less deep
let z = await Bun.file(`${import.meta.dir}/yeti.ts`).text();
z = z.replace(`const eyeAt = on([0.05, 0.0, 0.055], eyeDir, 0.018);`, `const eyeAt = on([0.05, 0.0, 0.055], eyeDir, 0.012);`)
  .replace(`r: R(0.042), mirror: true, material: "dark"`, `r: R(0.05), mirror: true, material: "dark"`)
  .replace(`off: eyeAt, r: R(0.03)`, `off: eyeAt, r: R(0.037)`);
await Bun.write(`${import.meta.dir}/yeti.ts`, z);
