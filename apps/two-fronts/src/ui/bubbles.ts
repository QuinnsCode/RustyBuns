// Speech bubbles over heads, for comrades in a battle and actors in a cutscene: one div per
// speaker, moved each frame to where their head is on screen and dropped when they stop talking.
export interface Bubbles {
  // Shows text over a speaker at x, y (pixels in the host), or hides it when at is null (off screen).
  put(id: string | number, text: string, at: { x: number; y: number } | null, kind?: string): void;
  // Drops every bubble not put since the last sweep.
  sweep(): void;
  remove(): void;
}

export function makeBubbles(host: HTMLElement): Bubbles {
  const layer = document.createElement("div");
  layer.className = "bubbles";
  host.append(layer);
  const live = new Map<string, HTMLElement>(), touched = new Set<string>();
  return {
    put(id, text, at, kind = "") {
      const key = String(id);
      touched.add(key);
      let el = live.get(key);
      if (!el) {
        el = document.createElement("div");
        live.set(key, el);
        layer.append(el);
      }
      const cls = `bubble ${kind}`;
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !at;
      if (at) el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    },
    sweep() {
      for (const [k, el] of live) if (!touched.has(k)) { el.remove(); live.delete(k); }
      touched.clear();
    },
    remove: () => layer.remove(),
  };
}
