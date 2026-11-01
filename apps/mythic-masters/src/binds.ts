// Every key the game reads, as rebindable actions. The game keeps asking for the shipped key codes; `bind.canon`
// turns the key really pressed into the shipped code of the action it is bound to (packages/game-controls).
import { type Action, loadBindings } from "@rustybuns/game-controls";

export const KEY = "mythic-masters.controls";

export const ACTIONS: Action[] = [
  { id: "forward", label: "Move forward", keys: ["KeyW"] }, { id: "back", label: "Move back", keys: ["KeyS"] },
  { id: "left", label: "Move left", keys: ["KeyA"] }, { id: "right", label: "Move right", keys: ["KeyD"] },
  { id: "jump", label: "Jump / fly up", keys: ["Space"] }, { id: "down", label: "Fly down", keys: ["KeyC"] },
  { id: "dash", label: "Dash (world: run)", keys: ["ShiftLeft"] },
  { id: "light", label: "Light attack", keys: ["KeyJ"] }, { id: "heavy", label: "Heavy attack", keys: ["KeyK"] },
  { id: "special", label: "Special", keys: ["KeyL"] }, { id: "ultimate", label: "Ultimate", keys: ["KeyU"] },
  { id: "guard", label: "Guard (world: turn left)", keys: ["KeyQ"] }, { id: "charge", label: "Charge (world: turn right)", keys: ["KeyE"] },
  { id: "bind", label: "Bind a wild one", keys: ["KeyB"] }, { id: "map", label: "World map", keys: ["KeyM"] },
  { id: "journal", label: "Eldritch Compendium", keys: ["Tab"] },
];

export const keymap = loadBindings(KEY, ACTIONS);
