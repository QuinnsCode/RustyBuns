// Build the iOS app for the simulator, run it, and take its screenshots: the App Store readiness climb's camera.
// Needs full Xcode, so run it on Bob from any worktree (no commit needed):
//
//   bun run builder run apps/park-hide-seek bun scripts/ios-shots.ts /tmp/phs-shots
//   scp "$BUILDER_HOST:/tmp/phs-shots/*" <your dir>
//
// Prints the build's errors, the app's size and each shot's path. Exits non-zero when the build fails.
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "/tmp/phs-shots");
const ios = resolve(import.meta.dir, "../ios");
const dd = "/tmp/phs-dd";
const bundle = "com.quinnscode.parkhideseek";
mkdirSync(out, { recursive: true });
$.cwd(ios);
$.env({ ...process.env, PATH: `${process.env.HOME}/.bun/bin:/opt/homebrew/bin:${process.env.PATH}` });

await $`xcodegen -q`;
const build = await $`xcodebuild -project ParkHideSeek.xcodeproj -scheme ParkHideSeek -sdk iphonesimulator -destination ${"generic/platform=iOS Simulator"} -derivedDataPath ${dd} CODE_SIGNING_ALLOWED=NO build`.quiet().nothrow();
const log = build.stdout.toString();
const problems = [...new Set(log.split("\n").filter((l) => /^\/.*: (error|warning):/.test(l)).map((l) => l.replace(/^.*\/ios\//, "")))];
for (const p of problems) console.log(p);
if (build.exitCode !== 0) {
  console.log(log.split("\n").slice(-20).join("\n"));
  process.exit(build.exitCode);
}
const app = `${dd}/Build/Products/Debug-iphonesimulator/ParkHideSeek.app`;
console.log(`app ${(await $`du -sh ${app}`.text()).split("\t")[0]} (debug, simulator)`);

// One iPhone and one iPad: the sizes the store listing needs.
const devices = (await $`xcrun simctl list devices available`.text()).split("\n");
const pick = (re: RegExp) => devices.find((l) => re.test(l))?.match(/\(([0-9A-F-]{36})\)/)?.[1];
const targets = [
  ["iphone", pick(/iPhone \d+ Pro Max \(/) ?? pick(/iPhone \d+ Pro \(/) ?? pick(/iPhone/)],
  ["ipad", pick(/iPad Pro 13/) ?? pick(/iPad Pro/) ?? pick(/iPad/)],
] as const;

for (const [kind, id] of targets) {
  if (!id) { console.log(`no ${kind} simulator`); continue; }
  await $`xcrun simctl boot ${id}`.quiet().nothrow();
  await $`xcrun simctl bootstatus ${id} -b`.quiet();
  await $`xcrun simctl install ${id} ${app}`;
  for (const [shot, args, wait] of [["home", [], 4], ["offline", ["-playOffline"], 12]] as const) {
    await $`xcrun simctl terminate ${id} ${bundle}`.quiet().nothrow();
    await $`xcrun simctl launch ${id} ${bundle} ${args}`.quiet();
    await Bun.sleep(wait * 1000);
    const file = `${out}/${kind}-${shot}.png`;
    await $`xcrun simctl io ${id} screenshot ${file}`.quiet();
    console.log(file);
  }
  const crashes = await $`xcrun simctl spawn ${id} log show --last 2m --predicate ${'process == "ParkHideSeek" AND messageType == fault'} --style compact`.quiet().nothrow().text();
  for (const l of crashes.split("\n").filter((l) => l.includes("ParkHideSeek")).slice(0, 5)) console.log(`fault: ${l}`);
}
