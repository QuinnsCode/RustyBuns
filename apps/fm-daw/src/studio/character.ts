// Your character as a dialog over the room (#5819): the top bar's Character door and the menu's New look open the shared
// picker (@rustybuns/models/picker, the same one eqosys's Me tab mounts) in a <dialog>, and Save or Cancel closes it back
// to the room, which plays on behind it. Signed in, it reads and saves the character kept on eqosys with your token
// (GET and PUT /me/avatar, checked by the AvatarReply guard); a guest's look stays in this browser. The picker loads on
// first open, so the room's page doesn't wait for it. On a phone the dialog fills the screen.
import "./character.css";
import type { Avatar } from "@rustybuns/util/avatar";
import type { Kept, Picker } from "@rustybuns/models/picker";

export type CharacterDialog = { open: () => Promise<void>; close: () => void; isOpen: () => boolean; picker: () => Picker | null };

/** The dialog, made once: `load` and `save` are the picker's (eqosys, or this browser), `wear` puts a saved look on you in the room. */
export function characterDialog(o: { load: () => Promise<Kept | null>; save: (a: Avatar) => Promise<Kept | null>; wear: (a: Avatar) => void }): CharacterDialog {
  const dialog = document.createElement("dialog");
  dialog.id = "character";
  dialog.className = "qs-ch";
  dialog.setAttribute("aria-label", "Your character");
  const box = document.createElement("div");
  dialog.append(box);
  document.body.append(dialog);
  // the room's keys (walk, play, Esc into the room) stay out of it while it's open
  for (const t of ["keydown", "keyup"] as const) dialog.addEventListener(t, (e) => { if (e.key !== "Escape") e.stopPropagation(); });
  let picker: Picker | null = null, opened = 0;
  const close = () => { if (!dialog.open) return; dialog.close(); };
  const drop = () => { picker?.dispose(); picker = null; };
  // closed by Esc, Save or Cancel: let go of the picker's GPU context so the room has it back (the close event comes a
  // task later, so one opened again in between keeps its new picker)
  dialog.addEventListener("close", () => { if (!dialog.open) drop(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  return {
    async open() {
      if (dialog.open) return;
      document.exitPointerLock?.();
      drop();
      box.textContent = "";
      dialog.showModal();
      const mine = ++opened;
      const { mountPicker } = await import("@rustybuns/models/picker");
      if (!dialog.open || mine !== opened) return;
      // its own holder, so a stale one cleared on dispose takes nothing of the next
      const holder = document.createElement("div");
      holder.className = "character";
      box.replaceChildren(holder);
      const p = await mountPicker(holder, { load: o.load, save: o.save, cancel: close, saved: (a) => { o.wear(a); close(); } });
      // closed (or closed and opened again) while it loaded: nothing to keep
      if (!dialog.open || mine !== opened) p?.dispose(); else picker = p;
    },
    close,
    isOpen: () => dialog.open,
    picker: () => picker,
  };
}
