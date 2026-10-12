// rustybuns build desktop --sign [--notarize <profile>]
// A downloaded binary that isn't signed with a Developer ID and notarized is blocked by
// Gatekeeper ("cannot be opened because it is from an unidentified developer"). This signs
// the darwin outputs with the Developer ID in your login keychain, and with --notarize sends
// a zip to Apple through `xcrun notarytool`, using a profile saved once with
//   xcrun notarytool store-credentials <profile> --apple-id <you> --team-id <TEAM>
// Nothing secret passes through Rusty Buns: codesign and notarytool read the keychain.
// A bare executable can't have a ticket stapled; Gatekeeper looks it up online on first run.

import { $ } from "bun";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** What a Bun-compiled binary needs under the hardened runtime: JSC's JIT writes executable memory. */
export const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-executable-page-protection</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
`;

/** The Developer ID Application identities in `security find-identity -v -p codesigning` output. */
export function developerIds(findIdentity: string): string[] {
  return [...findIdentity.matchAll(/^\s*\d+\)\s+[0-9A-F]{40}\s+"(Developer ID Application: [^"]+)"/gm)].map((m) => m[1]!);
}

/** The identity to sign with: RB_SIGN_IDENTITY, else the keychain's only Developer ID. */
export function pickIdentity(ids: string[], wanted?: string): string {
  if (wanted) return wanted;
  if (ids.length === 1) return ids[0]!;
  if (!ids.length) throw new Error(`no "Developer ID Application" certificate in your keychain. Make one in Xcode (Settings → Accounts → Manage Certificates → + → Developer ID Application) on a paid Apple Developer account, then build again.`);
  throw new Error(`more than one Developer ID in your keychain; pick one with RB_SIGN_IDENTITY:\n  ${ids.join("\n  ")}`);
}

export function codesignArgs(file: string, identity: string, entitlements: string, id: string): string[] {
  return ["codesign", "--force", "--timestamp", "--options", "runtime", "--entitlements", entitlements, "--identifier", id, "--sign", identity, file];
}

export function notaryResult(json: string): { id: string; status: string } {
  const j = JSON.parse(json);
  return { id: String(j.id ?? "?"), status: String(j.status ?? "unknown") };
}

/** Sign (and notarize) each darwin binary in place. Returns the zips sent to Apple. */
export async function signDarwin(outs: string[], opts: { identifier: string; notarize?: string }): Promise<string[]> {
  const darwin = outs.filter((o) => basename(o).includes("darwin"));
  if (!darwin.length) return [];
  if (process.platform !== "darwin") throw new Error("--sign runs codesign, which only exists on macOS: build the darwin targets on a Mac");
  const identity = pickIdentity(developerIds(await $`security find-identity -v -p codesigning`.text()), process.env.RB_SIGN_IDENTITY);
  const ent = join(mkdtempSync(join(tmpdir(), "rb-sign-")), "entitlements.plist");
  writeFileSync(ent, ENTITLEMENTS);
  const zips: string[] = [];
  for (const out of darwin) {
    console.log(`[sign] ${out} as ${identity}`);
    const [cmd, ...args] = codesignArgs(out, identity, ent, opts.identifier);
    await $`${cmd} ${args}`;
    await $`codesign --verify --strict ${out}`;
    if (!opts.notarize) continue;
    // notarytool takes a zip, dmg or pkg. The zip is also what you hand people: it keeps the +x bit.
    const zip = join(dirname(out), `${basename(out)}.zip`);
    await $`ditto -c -k --keepParent ${out} ${zip}`;
    console.log(`[notarize] ${zip} (Apple usually answers in a few minutes)`);
    // --wait exits 0 on a rejection too, so read the status.
    const r = notaryResult(await $`xcrun notarytool submit ${zip} --keychain-profile ${opts.notarize} --wait --output-format json`.text());
    if (r.status !== "Accepted") throw new Error(`Apple did not notarize ${zip} (${r.status}). Why: xcrun notarytool log ${r.id} --keychain-profile ${opts.notarize}`);
    zips.push(zip);
  }
  return zips;
}
