// Pocket Dice for the Play Store: a Trusted Web Activity (TWA), the live PWA in a thin Android shell that Bubblewrap
// builds. Android shows the page full screen, with no URL bar, only when the site's /.well-known/assetlinks.json names
// this package and the fingerprint of the key that signed it.
//
//   bun run twa manifest --url https://<host>   twa-build/twa-manifest.json from the live web manifest (no key needed)
//   bunx varlock run -- bun run twa build --url https://<host>
//                                               the signed twa-build/app-release-bundle.aab, for the Play Console
//   bunx varlock run -- bun run twa fingerprint the upload key's SHA-256 into public/.well-known/assetlinks.json
//   bun run twa fingerprint --add AA:BB:...     add another (Play App Signing's key, from the Play Console)
//   bun run twa check --url https://<host>      the deployed assetlinks.json parses and names the package and a key
//
// The signing key is never in the repo: varlock resolves it from 1Password (see .env.schema) for `build` and
// `fingerprint`, the script writes it to twa-build/ for the build and deletes it after. Bubblewrap needs a JDK and the
// Android SDK; on its first run it offers to download both into ~/.bubblewrap.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arr, isRecord, obj, opt, str, type Of } from "@rustybuns/util/guard";

/** The Play Store id. It can never change once the app is uploaded. */
export const PACKAGE_ID = "dev.rustybuns.pocketdice";
const BUBBLEWRAP = "@bubblewrap/cli@1.27.0";
const app = join(import.meta.dir, "..");
const build = join(app, "twa-build");
const linksFile = join(app, "public/.well-known/assetlinks.json");
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const RELATION = "delegate_permission/common.handle_all_urls";

const field = opt(str(500));
const icons = arr(obj({ src: str(500, { min: 1 }), sizes: field, purpose: field }), 50, { drop: true });
/** The web manifest fields the TWA takes; a bad icon is dropped, a bad field throws naming it. */
export const webManifest = obj({
  name: field, short_name: field, start_url: field, scope: field, display: field, orientation: field,
  theme_color: field, background_color: field, icons: opt(icons),
});
export type WebManifest = Of<typeof webManifest>;
type Icon = Of<typeof icons>[number];
type AssetLink = { relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } };

const isObject = isRecord;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

/** The biggest icon of a purpose, at least 512 square, as Bubblewrap picks it. */
function icon(icons: Icon[], purpose: string, base: URL) {
  const size = (i: Icon) => Math.max(0, ...(i.sizes ?? "").split(" ").map((s) => Number(s.split("x")[0]) || 0));
  const fit = icons.filter((i) => (i.purpose ?? "any").split(" ").includes(purpose) && size(i) >= 512).sort((a, b) => size(b) - size(a))[0];
  return fit && new URL(fit.src, base).toString();
}

/** Bubblewrap's twa-manifest.json for the web manifest at `url`: what `bubblewrap init` asks for, answered once here. */
export function twaManifest(url: URL, web: WebManifest, versionCode: number) {
  const start = new URL(web.start_url ?? "/", url), scope = new URL(web.scope ?? ".", url);
  const iconUrl = icon(web.icons ?? [], "any", url);
  if (!iconUrl) throw new Error("the web manifest has no 512 icon, which the Play Store needs");
  return {
    packageId: PACKAGE_ID,
    host: url.host,
    name: web.name ?? "Pocket Dice",
    launcherName: web.short_name ?? web.name ?? "Dice",
    display: web.display ?? "standalone",
    orientation: web.orientation ?? "portrait",
    themeColor: web.theme_color ?? "#e8590c",
    navigationColor: web.theme_color ?? "#e8590c",
    backgroundColor: web.background_color ?? "#fff8f0",
    enableNotifications: false,
    startUrl: start.pathname + start.search,
    fullScopeUrl: scope.toString(),
    iconUrl,
    maskableIconUrl: icon(web.icons ?? [], "maskable", url),
    splashScreenFadeOutDuration: 300,
    signingKey: { path: join(build, "upload.keystore"), alias: process.env.TWA_KEY_ALIAS || "upload" },
    appVersion: new Date(versionCode * 60_000).toISOString().slice(0, 10),
    appVersionCode: versionCode,
    webManifestUrl: url.toString(),
    fallbackType: "customtabs",
    features: {},
    shortcuts: [],
    generatorApp: "rustybuns",
  };
}

/** Problems with an assetlinks.json for this package; `needKey` also asks for at least one fingerprint. */
export function checkAssetLinks(json: unknown, needKey = true): string[] {
  if (!Array.isArray(json)) return ["assetlinks.json is not a JSON list"];
  const ours = json.filter((l): l is AssetLink => isObject(l) && isObject(l.target) && l.target.package_name === PACKAGE_ID);
  if (!ours.length) return [`no statement names the package ${PACKAGE_ID}`];
  const problems: string[] = [];
  for (const { relation, target } of ours) {
    if (!strings(relation) || !relation.includes(RELATION)) problems.push(`the relation is not ${RELATION}`);
    if (target.namespace !== "android_app") problems.push(`the namespace is ${JSON.stringify(target.namespace)}, not "android_app"`);
    const prints = target.sha256_cert_fingerprints;
    if (!strings(prints)) { problems.push("sha256_cert_fingerprints is not a list of strings"); continue; }
    for (const p of prints) if (!FINGERPRINT.test(p)) problems.push(`${p} is not a SHA-256 fingerprint (32 hex pairs, colons between)`);
    if (needKey && !prints.length) problems.push("no signing key fingerprint yet: run `bun run twa fingerprint`");
  }
  return problems;
}

/** The file with `fingerprint` added (upper case, once). */
export function withFingerprint(json: AssetLink[], fingerprint: string): AssetLink[] {
  const p = fingerprint.trim().toUpperCase();
  if (!FINGERPRINT.test(p)) throw new Error(`${fingerprint} is not a SHA-256 fingerprint (32 hex pairs, colons between)`);
  return json.map((l) => l.target.package_name !== PACKAGE_ID || l.target.sha256_cert_fingerprints.includes(p) ? l
    : { ...l, target: { ...l.target, sha256_cert_fingerprints: [...l.target.sha256_cert_fingerprints, p] } });
}

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run this under \`bunx varlock run --\` so it resolves from 1Password (see .env.schema)`);
  return v;
}

/** The upload key out of 1Password into twa-build/, readable by this user only, for the length of `use`. */
async function withKeystore<T>(use: (path: string) => Promise<T>) {
  mkdirSync(build, { recursive: true });
  const path = join(build, "upload.keystore");
  writeFileSync(path, Buffer.from(need("TWA_KEYSTORE_B64"), "base64"));
  chmodSync(path, 0o600);
  try { return await use(path); } finally { rmSync(path, { force: true }); }
}

function run(cmd: string[], env: Record<string, string> = {}) {
  const r = Bun.spawnSync(cmd, { cwd: build, env: { ...process.env, ...env }, stdio: ["inherit", "inherit", "inherit"] });
  if (r.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed (exit ${r.exitCode})`);
}

function siteUrl(args: string[]) {
  const i = args.indexOf("--url"), raw = i >= 0 ? args[i + 1] : undefined;
  if (!raw) throw new Error("pass the deployed site: --url https://pwa-example.<you>.workers.dev");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("a TWA needs the HTTPS site");
  return url;
}

async function writeManifest(site: URL) {
  const url = new URL("/manifest.webmanifest", site), res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // Minutes since 1970 always goes up between builds, and stays far under the Play Store's 2,100,000,000 limit.
  const twa = twaManifest(url, webManifest(await res.json()), Math.floor(Date.now() / 60_000));
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "twa-manifest.json"), JSON.stringify(twa, null, 2) + "\n");
  console.log(`twa-manifest.json for ${twa.host} (${PACKAGE_ID}, version ${twa.appVersionCode})`);
}

async function main(args: string[]) {
  const [cmd] = args;
  if (cmd === "manifest") return writeManifest(siteUrl(args));
  if (cmd === "build") {
    await writeManifest(siteUrl(args));
    await withKeystore(async () => {
      const passwords = { BUBBLEWRAP_KEYSTORE_PASSWORD: need("TWA_KEYSTORE_PASSWORD"), BUBBLEWRAP_KEY_PASSWORD: process.env.TWA_KEY_PASSWORD || need("TWA_KEYSTORE_PASSWORD") };
      run(["bunx", BUBBLEWRAP, "update", "--skipVersionUpgrade", "--manifest=./twa-manifest.json"]);
      run(["bunx", BUBBLEWRAP, "build", "--skipPwaValidation", "--manifest=./twa-manifest.json"], passwords);
    });
    console.log(`signed bundle: ${join(build, "app-release-bundle.aab")} (upload it in the Play Console)`);
    return;
  }
  if (cmd === "fingerprint") {
    const i = args.indexOf("--add");
    const print = i >= 0 ? args[i + 1]! : await withKeystore(async (path) => {
      const r = Bun.spawnSync(["keytool", "-list", "-v", "-keystore", path, "-alias", process.env.TWA_KEY_ALIAS || "upload", "-storepass:env", "TWA_KEYSTORE_PASSWORD"], { stdout: "pipe", stderr: "pipe" });
      const found = r.stdout.toString().match(/SHA256:\s*([0-9A-F:]{95})/);
      if (!found) throw new Error(`keytool found no SHA-256 in the keystore: ${r.stderr.toString().slice(-400)}`);
      return found[1]!;
    });
    writeFileSync(linksFile, JSON.stringify(withFingerprint(JSON.parse(readFileSync(linksFile, "utf8")), print), null, 2) + "\n");
    console.log(`${print} in public/.well-known/assetlinks.json: commit it and deploy`);
    return;
  }
  if (cmd === "check") {
    const url = new URL("/.well-known/assetlinks.json", siteUrl(args)), res = await fetch(url, { redirect: "manual" });
    if (res.status !== 200) throw new Error(`${url}: ${res.status} (Android wants a 200 with no redirect)`);
    let json: unknown;
    try { json = await res.json(); } catch { throw new Error(`${url} is not JSON (the page itself, served for a missing file?)`); }
    const problems = checkAssetLinks(json);
    if (problems.length) throw new Error(`${url}:\n  ${problems.join("\n  ")}`);
    console.log(`${url} names ${PACKAGE_ID} and its key`);
    return;
  }
  console.log(readFileSync(import.meta.path, "utf8").split("\nimport")[0]);
}

if (import.meta.main) await main(process.argv.slice(2)).catch((e: Error) => { console.error(e.message); process.exit(1); });
