// The commands primitive (packages/util: commands.ts and palette.ts) for client.html's classic script: built to /commands.js,
// which sets `rbCommands` ({ addCommands, mountPalette }). The page's palette and its WebMCP tools are one list in there.
// Its look is the --rb-pal-* tokens in the page's head <style>.
import { addCommands } from "../../../packages/util/src/commands.ts";
import { mountPalette } from "../../../packages/util/src/palette.ts";

Object.assign(globalThis, { rbCommands: { addCommands, mountPalette } });
