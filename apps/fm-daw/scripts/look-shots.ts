// The look climb's three camera spots (#5008), the same every round: `bun scripts/look-shots.ts <out dir> [--url http://localhost:5173]
// [--studio live-room] [--quality high|low]`. The live room's: the corner by the front wall looking across the band, sitting at the
// keys, and sitting at the desk looking through the glass. A room with its own row in ROOM_SPOTS gets its own three (the desk
// concert's foreground, the sound stage from the bleachers); any other gets the live room's, clamped to its walls. Each first person
// at 1280x720 through `bun run probe` (headless Chrome). Three PNGs.
import { $ } from "bun";

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : d);
const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "dist/look";
const url = arg("--url", "http://localhost:5173"), studio = arg("--studio", "live-room"), quality = arg("--quality", "high");
const settle = "await new Promise((r) => setTimeout(r, 1200)); return qjam.state().you;";
const firstPerson = "if (qjam.state().you.cam !== 'first') qjam.cam();";
const SPOTS: Record<string, string> = {
  corner: `qjam.start(); qjam.walkTo(4, 3.9); qjam.look(Math.PI / 4 - 0.05, -0.12); ${firstPerson} ${settle}`,
  keys: `qjam.start(); qjam.walkTo(2.6, 1.2); qjam.sit('keys'); qjam.look(0.35, -0.32); ${firstPerson} ${settle}`,
  // the desk sits behind the glass: in through the control room door at its right end
  desk: `qjam.start(); qjam.walkTo(3.6, -0.6); qjam.walkTo(3.6, -2.6); qjam.walkTo(0.2, -2.6); qjam.sit('desk'); qjam.look(Math.PI + 0.1, -0.12); ${firstPerson} ${settle}`,
};

/** Rooms whose live-room spots land in a wall: their own three, walked to round the furniture. */
const ROOM_SPOTS: Record<string, Record<string, string>> = {
  "desk-concert": {
    // in at the door, the office in the foreground and the band behind the desk
    door: `qjam.start(); qjam.walkTo(1.35, 2.05); qjam.look(1.0, -0.25); ${firstPerson} ${settle}`,
    // sitting at the keys, looking out over the desk at the office the band plays to
    keys: `qjam.start(); qjam.walkTo(1.45, 1.8); qjam.walkTo(1.5, -0.3); qjam.walkTo(1.4, -0.9); qjam.sit('keys'); qjam.look(Math.PI - 0.35, -0.12); ${firstPerson} ${settle}`,
    desk: `qjam.start(); qjam.walkTo(1.4, 1.8); qjam.walkTo(1.4, 0.4); qjam.walkTo(0.3, 0.4); qjam.sit('desk'); qjam.look(Math.PI + 0.25, -0.1); ${firstPerson} ${settle}`,
  },
  "sound-stage": {
    // from beside the bleachers: the whole stage, the grid over it, the cameras on the floor
    corner: `qjam.start(); qjam.walkTo(-6.6, 3.2); qjam.look(-0.55, -0.08); ${firstPerson} ${settle}`,
    // on the riser at the keys, looking out past the wedges and cameras at the bleachers
    keys: `qjam.start(); qjam.walkTo(-6.6, -1.5); qjam.walkTo(6.1, -1.5); qjam.walkTo(6.1, -4.4); qjam.walkTo(5.4, -4.4); qjam.sit('keys'); qjam.look(Math.PI - 0.4, -0.05); ${firstPerson} ${settle}`,
    // at the floor mix desk, looking up at the band on the riser
    desk: `qjam.start(); qjam.walkTo(-6.6, 2.1); qjam.walkTo(-0.5, 2.1); qjam.sit('desk'); qjam.look(-0.25, 0.02); ${firstPerson} ${settle}`,
  },
};

await $`mkdir -p ${out}`;
for (const [spot, js] of Object.entries(ROOM_SPOTS[studio] ?? SPOTS)) {
  const file = `${out}/${spot}.png`;
  const page = `/jam.html?room=look-climb&studio=${studio}&quality=${quality}${process.env.EXTRA ?? ""}`;
  const r = await $`bun ${import.meta.dir}/../../../scripts/probe.ts fm-daw ${page} --url ${url} --size 1280x720 --settle 2500 --js ${js} --shot ${file}`.quiet().nothrow();
  console.log(r.exitCode ? `${file}: failed\n${r.stderr}` : file);
}
