// Open the iOS test client in a simulator on a deployed app, already in a state, for a manual run:
//   bun run ios https://my-app.workers.dev level=5 beat=40 [--device "iPhone 15"] [--build]
// The key=value pairs ride on the app's own query (the same ?level=5 links its scenario reads). --build first
// makes the shell from native/ios (xcodegen + xcodebuild) and installs it; without it the shell must be installed.
import { existsSync } from "node:fs";
import { appUrl, deepLink, devicesOf, parseArgs, pickDevice } from "./ios-sim-lib.ts";

const run = (cmd: string[], cwd?: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed:\n${p.stderr.toString() || p.stdout.toString()}`);
  return p.stdout.toString();
};

function main() {
  if (process.platform !== "darwin") throw new Error("the iOS simulator only runs on a Mac");
  const args = parseArgs(Bun.argv.slice(2));
  const link = deepLink(appUrl(args.url, args.state));
  const dev = pickDevice(devicesOf(JSON.parse(run(["xcrun", "simctl", "list", "devices", "-j"]))), args.device);
  if (!dev) throw new Error(args.device ? `no simulator named "${args.device}" (xcrun simctl list devices)` : "no iPhone simulator; install one in Xcode");

  if (dev.state !== "Booted") run(["xcrun", "simctl", "boot", dev.udid]);
  run(["open", "-a", "Simulator", "--args", "-CurrentDeviceUDID", dev.udid]);

  if (args.build) {
    const dir = new URL("../native/ios", import.meta.url).pathname;
    if (!existsSync(`${dir}/project.yml`)) throw new Error("native/ios has no project.yml (run from the repo root)");
    run(["xcodegen"], dir);
    const derived = `${dir}/build`;
    run(["xcodebuild", "-project", "RustyBuns.xcodeproj", "-scheme", "RustyBuns", "-destination", `id=${dev.udid}`, "-derivedDataPath", derived, "build"], dir);
    run(["xcrun", "simctl", "install", dev.udid, `${derived}/Build/Products/Debug-iphonesimulator/RustyBuns.app`]);
  }

  run(["xcrun", "simctl", "openurl", dev.udid, link]);
  console.log(`${dev.name}: ${link}`);
}

try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
