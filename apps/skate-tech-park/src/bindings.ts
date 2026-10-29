// The keys a player can move in the Controls cog. The game reads the shipped code of each (KeyW...); `bind.canon`
// turns the key really pressed into it. `hint` is the key cap an on-screen line shows for an action.
import { type Action, keyName, loadBindings } from "@rustybuns/game-controls";

export const KEY = "skate-tech-park.controls";
export const ACTIONS: Action[] = [
  { id: "push", label: "Push", keys: ["KeyW", "ArrowUp"] },
  { id: "brake", label: "Brake / reverse", keys: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Steer left", keys: ["KeyA", "ArrowLeft"] },
  { id: "right", label: "Steer right", keys: ["KeyD", "ArrowRight"] },
  { id: "ollie", label: "Ollie / jump", keys: ["Space"] },
  { id: "nollie", label: "Nollie", keys: ["KeyN"] },
  { id: "kickflip", label: "Kickflip", keys: ["KeyF"] },
  { id: "heelflip", label: "Heelflip", keys: ["KeyG"] },
  { id: "shoveit", label: "Shove-it", keys: ["KeyV"] },
  { id: "varial", label: "Varial (also restarts)", keys: ["KeyR"] },
  { id: "tre", label: "Tre flip", keys: ["KeyT"] },
  { id: "laser", label: "Laser flip", keys: ["KeyY"] },
  { id: "hardflip", label: "Hardflip", keys: ["KeyU"] },
  { id: "inward", label: "Inward heel", keys: ["KeyI"] },
  { id: "varialHeel", label: "Varial heel", keys: ["KeyO"] },
  { id: "fsShoveit", label: "Frontside shove-it", keys: ["KeyB"] },
  { id: "shoveit360", label: "360 shove-it", keys: ["KeyM"] },
  { id: "doubleKick", label: "Double kickflip", keys: ["KeyK"] },
  { id: "doubleHeel", label: "Double heelflip", keys: ["KeyL"] },
  { id: "fsShoveit360", label: "Frontside 360 shove-it", keys: ["KeyP"] },
  { id: "hardflip360", label: "360 hardflip", keys: ["KeyH"] },
  { id: "nightmare", label: "Nightmare flip", keys: ["KeyJ"] },
  { id: "boost", label: "Rear jets / pump", keys: ["ShiftLeft", "ShiftRight"] },
  { id: "fan", label: "Suction fan", keys: ["KeyE"] },
  { id: "manual", label: "Manual (in the air: tail grab; with steer, a rail grab)", keys: ["KeyQ"] },
  { id: "noseManual", label: "Nose manual (in the air: nose grab; with steer, a rail grab)", keys: ["KeyZ"] },
  { id: "swap", label: "Swap board and roadster", keys: ["Tab"] },
];
export const bind = loadBindings(KEY, ACTIONS);
/** The key cap for an action as it reads now. */
export const hint = (id: string) => keyName(bind.get(id)[0] ?? "");
