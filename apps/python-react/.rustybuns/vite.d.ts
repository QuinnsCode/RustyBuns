// Checked in: types for the generated vite.ts (`rustybuns build desktop` writes
// it; the rest of .rustybuns is gitignored) so vite.config.ts typechecks on a
// fresh clone. Once vite.ts exists, tsc resolves to it instead.
import type { Plugin } from "vite";
export declare function rustybuns(): Plugin;
