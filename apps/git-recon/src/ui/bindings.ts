// The keys a player can move in the Controls cog. The game reads the shipped code of each (KeyW...); `bind.canon`
// turns the key really pressed into it.
import { type Action, loadBindings } from "@rustybuns/game-controls";
import { KEYS } from "../sim/weapons.ts";

export const KEY = "git-recon.controls";
export const ACTIONS: Action[] = [
  { id: "forward", label: "Forward", keys: ["KeyW"] },
  { id: "back", label: "Back", keys: ["KeyS"] },
  { id: "left", label: "Left", keys: ["KeyA"] },
  { id: "right", label: "Right", keys: ["KeyD"] },
  { id: "jump", label: "Jump", keys: ["Space"] },
  { id: "crouch", label: "Crouch", keys: ["KeyC", "ControlLeft"] },
  { id: "prone", label: "Prone", keys: ["KeyZ"] },
  { id: "roll", label: "Dive roll", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "reload", label: "Reload", keys: ["KeyR"] },
  { id: "use", label: "Use", keys: ["KeyF"] },
  { id: "leanLeft", label: "Lean left / leave", keys: ["KeyQ"] },
  { id: "leanRight", label: "Lean right", keys: ["KeyE"] },
  { id: "role", label: "Next role", keys: ["KeyN"] },
  { id: "board", label: "Scoreboard", keys: ["Tab"] },
  ...KEYS.map((code, i) => ({ id: `gun${i + 1}`, label: `Gun slot ${i + 1}`, keys: [code] })),
];
export const bind = loadBindings(KEY, ACTIONS);
