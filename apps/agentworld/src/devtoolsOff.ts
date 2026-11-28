// `#devtools` in a production build (package.json): no DevTools (devtools.ts).
import { Layer } from "effect";

export const devtools = () => Layer.empty;
