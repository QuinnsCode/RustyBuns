// Scratch, not committed: build the wasm, then run the rust-vs-ts circuit test in the same slot.
import { $ } from "bun";
await $`bun scripts/build-native.ts --wasm`;
await $`bun test test/circuit.test.ts -t ${"rust \\(wasm\\) plays every rig"}`;
