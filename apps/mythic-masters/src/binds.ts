// Every key the game reads, as rebindable actions. The game asks for actions by id ("light", "jump"), never for a
// key: `actionOf` turns the key (or mouse button) really pressed into the id of the action it is bound to.
//
// The shipped layout is a laptop's: no mouse needed. The left hand moves (WASD, Space jump, Shift dash) and the
// right hand fights from the home row, the way a platform fighter plays on a keyboard: J attack, K strong, L special,
// ; guard, with U ultimate and I big above (the heavy ranged move: hold it to charge, or to keep a stream on). Direction does the rest (jump held + strong is the launcher, guard
// in the air drops). A click and a right click are attack and strong too, so a mouse works without a preset.
import { type Action, type Bindings, keyName, loadBindings } from "@rustybuns/game-controls";

export const KEY = "mythic-masters.controls";

// In the order the Settings dialog lists them, under a heading per group: moving (the fight and the world alike),
// fighting, and the open world.
const MOVE = "Moving", FIGHT = "Fighting", WORLD = "Open world";
export const ACTIONS: Action[] = [
  { id: "forward", label: "Move forward", keys: ["KeyW", "ArrowUp"] }, { id: "back", label: "Move back", keys: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Move left", keys: ["KeyA"] }, { id: "right", label: "Move right", keys: ["KeyD"] },
  { id: "jump", label: "Jump / fly up (tap: short hop)", keys: ["Space"] },
  { id: "dash", label: "Dash (world: run)", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "light", label: "Attack", keys: ["KeyJ", "MouseLeft"], group: FIGHT },
  { id: "heavy", label: "Strong (hold: a bigger slam; jump held: launcher)", keys: ["KeyK", "MouseRight"], group: FIGHT },
  { id: "special", label: "Special", keys: ["KeyL"], group: FIGHT },
  { id: "guard", label: "Guard (in the air: drop, or dive)", keys: ["Semicolon"], group: FIGHT },
  { id: "ultimate", label: "Ultimate", keys: ["KeyU"], group: FIGHT },
  { id: "big", label: "Big (hold: charge it, or keep a stream on)", keys: ["KeyI"], group: FIGHT },
  { id: "bind", label: "Bind a worn-down wild one", keys: ["KeyB"], group: FIGHT },
  { id: "turnLeft", label: "Turn the camera left", keys: ["KeyQ", "ArrowLeft"], group: WORLD },
  { id: "turnRight", label: "Turn the camera right", keys: ["KeyE", "ArrowRight"], group: WORLD },
  { id: "map", label: "World map", keys: ["KeyM"], group: WORLD },
  { id: "journal", label: "Eldritch Compendium", keys: ["Tab"], group: WORLD },
].map((a) => ({ group: MOVE, ...a }));

export const keymap = loadBindings(KEY, ACTIONS);

/** The id of the action `code` is bound to now, or "" for a key the game doesn't use. */
export const actionOf = (code: string): string => ACTIONS.find((a) => keymap.get(a.id).includes(code))?.id ?? "";

/** Whole layouts, one click each in Settings. Only what differs from the shipped (laptop) layout is listed. */
export const PRESETS: { id: string; label: string; hint: string; keys: Bindings }[] = [
  { id: "laptop", label: "Laptop", hint: "WASD moves, the right hand fights from J K L ;", keys: {} },
  {
    id: "mouse", label: "Mouse", hint: "WASD moves, click attacks, right click is strong, the rest sits by the left hand",
    keys: { special: ["KeyE"], guard: ["KeyQ"], ultimate: ["KeyR"], big: ["KeyF"], light: ["MouseLeft"], heavy: ["MouseRight"], turnLeft: ["ArrowLeft", "KeyZ"], turnRight: ["ArrowRight", "KeyX"] },
  },
  {
    id: "arrows", label: "Arrows", hint: "the arrow keys move, the left hand fights from Z X C V",
    keys: {
      forward: ["ArrowUp"], back: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
      light: ["KeyZ", "MouseLeft"], heavy: ["KeyX", "MouseRight"], special: ["KeyC"], guard: ["KeyV"], ultimate: ["KeyS"], big: ["KeyD"],
      turnLeft: ["KeyQ"], turnRight: ["KeyE"],
    },
  },
];

/** The few keys the on-screen card shows where you are (moving only; every other key is in Settings), from the bindings as they are now. */
export function moveKeys(where: "fight" | "world", get: (id: string) => string[] = keymap.get): { keys: string; does: string }[] {
  const first = (id: string) => keyName(get(id)[0] ?? "") || "?";
  const walk = ["forward", "left", "back", "right"].map(first).join("");
  return where === "fight"
    ? [{ keys: walk, does: "Move" }, { keys: first("jump"), does: "Jump" }, { keys: first("dash"), does: "Dash" }]
    : [{ keys: walk, does: "Walk" }, { keys: first("dash"), does: "Run" }, { keys: `${first("turnLeft")} ${first("turnRight")}`, does: "Turn" }];
}
