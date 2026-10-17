// Pull Clave (QNTBR's calls-and-recordings tool: Whisper transcripts with most of the work done
// on the client) into vendor/qlave, until it ships as a package. The source is public:
// https://github.com/QuinnsCode/clave. Nothing here is imported by the app yet; this is the
// "download the code and put it in the app" step, so a reader can see what's coming.
//
//   bun scripts/fetch-qlave.ts            main
//   bun scripts/fetch-qlave.ts --ref v1   a tag or branch
//
// vendor/ is git-ignored (apps/qcrm/.gitignore). Clave keeps its own license.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { ref: { type: "string", default: "main" } } });
const ref = a.ref!;
if (!/^[\w.\-/]+$/.test(ref)) { console.error("bad ref"); process.exit(2); }
const dir = join(import.meta.dir, "..", "vendor", "qlave");
const url = `https://codeload.github.com/QuinnsCode/clave/tar.gz/${encodeURIComponent(ref)}`;

const res = await fetch(url);
if (!res.ok) { console.error(`GitHub said ${res.status} for ${url}`); process.exit(1); }
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const tgz = join(dir, "clave.tgz");
await writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
// The tarball's top folder is clave-<ref>; strip it so vendor/qlave is the repo root.
const tar = Bun.spawnSync(["tar", "xzf", tgz, "--strip-components=1", "-C", dir]);
if (tar.exitCode !== 0) { console.error(tar.stderr.toString()); process.exit(1); }
await rm(tgz);
await writeFile(join(dir, "QCRM-VENDORED.md"), `Clave, fetched from ${url} on ${new Date().toISOString().slice(0, 10)}.\nRead README_QLAVE.md for the call and recording pipeline. Not yet wired into qCRM.\n`);
console.log(`vendor/qlave <- QuinnsCode/clave@${ref}`);
