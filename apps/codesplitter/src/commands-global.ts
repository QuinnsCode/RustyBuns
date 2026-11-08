// The house commands and palette (@rustybuns/util/commands, /palette) for client.html's classic script: built to
// /commands.js, which sets `rbCommands` (addCommands, mountPalette, ...). The palette's look is the page's --rb-pal-* tokens.
// Keys people pick for commands (@rustybuns/util/keys, #3793) ride along as rbCommands.keys.
import { addCommands, listCommands, modelContext, runCommand } from "../../../packages/util/src/commands.ts";
import { bindKeys, keyOf, keyStore, refuseKey } from "../../../packages/util/src/keys.ts";
import { mountPalette } from "../../../packages/util/src/palette.ts";

Object.assign(globalThis, { rbCommands: { addCommands, listCommands, runCommand, modelContext, mountPalette, keys: { bindKeys, keyOf, keyStore, refuseKey } } });
