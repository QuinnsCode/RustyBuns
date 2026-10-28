// The keys a player can move in the Controls cog. The game reads the shipped code of each (KeyW...); `bind.canon`
// turns the key really pressed into it.
import { type Action, loadBindings } from "@rustybuns/game-controls";

export const KEY = "park-hide-seek.controls";
export const ACTIONS: Action[] = [
  { id: "forward", label: "Forward", keys: ["KeyW", "ArrowUp"] },
  { id: "back", label: "Back", keys: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Left", keys: ["KeyA", "ArrowLeft"] },
  { id: "right", label: "Right", keys: ["KeyD", "ArrowRight"] },
  { id: "run", label: "Run", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "crouch", label: "Crouch (hold: prone)", keys: ["KeyC"] },
  { id: "climb", label: "Climb a tree", keys: ["KeyX"] },
  { id: "camera", label: "First or third person", keys: ["KeyV"] },
  { id: "light", label: "Flashlight", keys: ["KeyF"] },
  { id: "call", label: "Call out (rangers)", keys: ["KeyQ"] },
  { id: "prop", label: "Become a prop", keys: ["KeyE"] },
  { id: "map", label: "Map and radio", keys: ["KeyM"] },
  { id: "music", label: "Music", keys: ["KeyN"] },
  { id: "follow", label: "Follow someone", keys: ["Tab"] },
];
export const bind = loadBindings(KEY, ACTIONS);
