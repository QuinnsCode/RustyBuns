// The desktop world: the very same class the Cloudflare edge runs as its
// Durable Object, bound in-process by the Rusty Buns host (X-User-Id is the
// host's local player, or a vouched LAN guest).
//
// Its rooms step in Rust when the client build carries hippo_sim.wasm (vite
// copies public/ into dist/desktop, which the binary embeds next to its entry,
// as the host's own resolveDir finds it). Bun compiles wasm from bytes; without
// the file the rooms step in TypeScript.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import World from "../../src/room-do.ts";
import { compileSim, simModule } from "../../src/sim/native.ts";

const wasm = [join(import.meta.dir, "desktop", "hippo_sim.wasm"), join(process.cwd(), "dist", "desktop", "hippo_sim.wasm")].find((p) => existsSync(p));
World.sim = wasm ? simModule(await compileSim(readFileSync(wasm)).catch(() => null)) : null;

export default World;
