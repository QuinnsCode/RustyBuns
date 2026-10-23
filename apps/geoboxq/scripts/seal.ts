// Encrypt the engine for release: src/wasm-pkg/geoboxq_engine_bg.wasm -> dist/client/engine.sealed.
// The key is artstewengine's ENGINE_KEY (the same one qCRM's engine is sealed with), passed in by varlock,
// never typed or committed.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { seal } from "@rustybuns/seal";

const key = Bun.env.ENGINE_KEY;
if (!key) { console.error("ENGINE_KEY is not set (run through varlock)"); process.exit(1); }
const app = resolve(import.meta.dir, "..");
const wasm = new Uint8Array(await Bun.file(join(app, "src/wasm-pkg/geoboxq_engine_bg.wasm")).arrayBuffer());
mkdirSync(join(app, "dist/client"), { recursive: true });
const out = join(app, "dist/client/engine.sealed");
await Bun.write(out, await seal(wasm, key));
console.log(`${out}: ${wasm.length} bytes sealed. Build the client with VITE_GEOBOXQ_SEALED=1 so it asks for the key.`);
