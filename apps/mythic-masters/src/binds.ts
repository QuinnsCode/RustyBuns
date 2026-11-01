// Every key the game reads, as rebindable actions. The game asks for actions by id ("light", "jump"), never for a
// key: `actionOf` turns the key (or mouse button) really pressed into the id of the action it is bound to.
//
// The shipped layout is a laptop's: no mouse needed. The left hand moves (WASD, Space jump, Shift dash) and the
// right hand fights from the home row, the way a platform fighter plays on a keyboard: J attack, K strong, L special,
// ; guard, with U ultimate and I charge above. Direction does the rest (jump held + strong is the launcher, guard
// in the air drops). A click and a right click are attack and strong too, so a mouse works without a preset.
import { type Action, type Bindings, loadBindings } from "@rustybuns/game-controls";

export const KEY = "mythic-masters.controls";

export const ACTIONS: Action[] = [
  { id: "forward", label: "Move forward", keys: ["KeyW", "ArrowUp"] }, { id: "back", label: "Move back", keys: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Move left", keys: ["KeyA"] }, { id: "right", label: "Move right", keys: ["KeyD"] },
  { id: "jump", label: "Jump / fly up (tap: short hop)", keys: ["Space"] },
  { id: "dash", label: "Dash (world: run)", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "light", label: "Attack", keys: ["KeyJ", "MouseLeft"] },
  { id: "heavy", label: "Strong (jump held: launcher)", keys: ["KeyK", "MouseRight"] },
  { id: "special", label: "Special (moving at them: beam)", keys: ["KeyL"] },
  { id: "guard", label: "Guard (in the air: drop, or dive)", keys: ["Semicolon"] },
  { id: "ultimate", label: "Ultimate", keys: ["KeyU"] },
  { id: "charge", label: "Charge energy (hold)", keys: ["KeyI"] },
  { id: "bind", label: "Bind a wild one", keys: ["KeyB"] }, { id: "map", label: "World map", keys: ["KeyM"] },
  { id: "journal", label: "Eldritch Compendium", keys: ["Tab"] },
  { id: "turnLeft", label: "World: turn camera left", keys: ["KeyQ", "ArrowLeft"] },
  { id: "turnRight", label: "World: turn camera right", keys: ["KeyE", "ArrowRight"] },
];

export const keymap = loadBindings(KEY, ACTIONS);

/** The id of the action `code` is bound to now, or "" for a key the game doesn't use. */
export const actionOf = (code: string): string => ACTIONS.find((a) => keymap.get(a.id).includes(code))?.id ?? "";

/** Whole layouts, one click each in Settings. Only what differs from the shipped (laptop) layout is listed. */
export const PRESETS: { id: string; label: string; hint: string; keys: Bindings }[] = [
  { id: "laptop", label: "Laptop", hint: "WASD moves, the right hand fights from J K L ;", keys: {} },
  {
    id: "mouse", label: "Mouse", hint: "WASD moves, click attacks, right click is strong, the rest sits by the left hand",
    keys: { special: ["KeyE"], guard: ["KeyQ"], ultimate: ["KeyR"], charge: ["KeyF"], light: ["MouseLeft"], heavy: ["MouseRight"], turnLeft: ["ArrowLeft", "KeyZ"], turnRight: ["ArrowRight", "KeyX"] },
  },
  {
    id: "arrows", label: "Arrows", hint: "the arrow keys move, the left hand fights from Z X C V",
    keys: {
      forward: ["ArrowUp"], back: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
      light: ["KeyZ", "MouseLeft"], heavy: ["KeyX", "MouseRight"], special: ["KeyC"], guard: ["KeyV"], ultimate: ["KeyS"], charge: ["KeyD"],
      turnLeft: ["KeyQ"], turnRight: ["KeyE"],
    },
  },
];
