// Makes the README gallery's thumbnails: docs/readme/<app>.jpg, cropped to 16:10 from the middle and
// shrunk to 480x300 (the featured app 960x600) at JPEG quality 60, so a picture is a few dozen KB.
//
//   bun scripts/readme-shots.ts                       every app with an eqosys card (apps/eqosys/public/cards)
//   bun scripts/readme-shots.ts two-fronts=shot.png   one app from any picture (a `bun run probe --shot`)
//
// macOS only: it uses `sips`, which ships with the OS. Run `bun run docs` after, to write the gallery.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { DIR, readGroups, shotOf } from "./readme-apps.ts";

const featured = readGroups()[0]?.apps[0]?.app;
const sips = (args: string[]) => {
  const p = Bun.spawnSync(["sips", ...args], { stderr: "pipe", stdout: "pipe" });
  if (p.exitCode !== 0) throw new Error(`sips ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString();
};

function thumb(app: string, src: string) {
  if (!existsSync(src)) throw new Error(`${app}: no picture at ${src}`);
  const dims = sips(["-g", "pixelWidth", "-g", "pixelHeight", src]);
  const w = Number(/pixelWidth: (\d+)/.exec(dims)?.[1]), h = Number(/pixelHeight: (\d+)/.exec(dims)?.[1]);
  // The widest 16:10 box that fits, from the middle.
  const cw = Math.min(w, Math.round((h * 16) / 10)), ch = Math.round((cw * 10) / 16);
  const [ow, oh] = app === featured ? [960, 600] : [480, 300];
  const out = shotOf(app);
  sips(["-s", "format", "jpeg", "-s", "formatOptions", "60", "--cropToHeightWidth", String(ch), String(cw), src, "--out", out]);
  sips(["-s", "formatOptions", "60", "-z", String(oh), String(ow), out]);
  console.log(`${out} ${ow}x${oh} ${Math.round(Bun.file(out).size / 1024)} KB`);
}

mkdirSync(DIR, { recursive: true });
const pairs = process.argv.slice(2).map((a) => a.split("=") as [string, string]);
if (pairs.length) for (const [app, src] of pairs) thumb(app, src);
else {
  const cards = "apps/eqosys/public/cards";
  const known = new Set(readGroups().flatMap((g) => g.apps.map((e) => e.app)));
  for (const f of readdirSync(cards).filter((f) => f.endsWith(".jpg"))) {
    const app = f.replace(/\.jpg$/, "");
    if (known.has(app)) thumb(app, `${cards}/${f}`);
  }
}
