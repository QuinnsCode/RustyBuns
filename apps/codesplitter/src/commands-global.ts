// The house commands and palette (@rustybuns/util/commands, /palette) for client.html's classic script: built to
// /commands.js, which sets `rbCommands` (addCommands, mountPalette, ...). The palette's look is the page's --rb-pal-* tokens.
import { addCommands, listCommands, modelContext, runCommand } from "../../../packages/util/src/commands.ts";
import { mountPalette } from "../../../packages/util/src/palette.ts";

Object.assign(globalThis, { rbCommands: { addCommands, listCommands, runCommand, modelContext, mountPalette } });
