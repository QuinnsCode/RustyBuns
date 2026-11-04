// Race the engines in the terminal: Rust over bun:ffi and TypeScript under Bun,
// on each built-in song. The same lanes as the app's "Race the engines" host row.
// `bun run bench [seconds]` (default 20; Rust is "not built" until `bun run build:native`).
import { benchOnHost } from "../src/actions/files.ts";
import { SONGS } from "../src/songs.ts";

const seconds = Number(process.argv[2] ?? 20) || 20;
const x = (v: number | null) => (v === null ? "not built" : `${Math.round(v)}x realtime`);

const width = Math.max(...SONGS.map((s) => s.name.length)) + 2;
console.log(`Rendering ${seconds} s of each song at 48 kHz`);
for (const song of SONGS) {
  const h = await benchOnHost(song.make(), seconds);
  console.log(`${song.name.padEnd(width)} Rust ${x(h.rustX).padEnd(16)} TypeScript ${x(h.tsX)}  (${h.platform})`);
}
