// The Cloudflare bundle's entry: src/worker.ts with the Rust sim in its rooms.
// A Worker cannot compile wasm from bytes, so the module is bundled with it as
// an import. scripts/build-native.ts writes native/hippo_sim.wasm on every
// build: the real module, or an empty one without cargo, which simModule()
// turns into null so the rooms step in TypeScript. Tests import worker.ts.
import wasm from "../native/hippo_sim.wasm";
import { simModule } from "./sim/native.ts";
import { World } from "./room-do.ts";
import worker from "./worker.ts";

World.sim = simModule(wasm);

export { World };
export default worker;
