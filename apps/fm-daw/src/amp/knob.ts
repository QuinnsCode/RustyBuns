// A chicken-head knob, 0 to 10: drag up and down, roll the wheel, or use the
// arrow keys (Shift for fine steps); double-click puts it back. A slider to a
// screen reader.

export interface KnobEl { el: HTMLElement; set(v: number): void }

export function knob(label: string, value: number, dflt: number, onChange: (v: number) => void, size: "big" | "small" = "big"): KnobEl {
  const el = document.createElement("div");
  el.className = `knob ${size}`;
  const dial = document.createElement("div");
  dial.className = "dial";
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", label);
  dial.setAttribute("aria-valuemin", "0");
  dial.setAttribute("aria-valuemax", "10");
  const pointer = document.createElement("div");
  pointer.className = "pointer";
  dial.append(pointer);
  const name = document.createElement("span");
  name.className = "knob-label";
  name.textContent = label;
  const readout = document.createElement("span");
  readout.className = "knob-value";
  el.append(dial, name, readout);

  let v = value;
  const show = () => {
    dial.style.setProperty("--turn", `${-135 + v * 27}deg`);
    dial.setAttribute("aria-valuenow", v.toFixed(1));
    readout.textContent = v.toFixed(1);
  };
  const set = (next: number, tell = true) => {
    const c = Math.round(Math.min(10, Math.max(0, next)) * 10) / 10;
    if (c === v) return;
    v = c;
    show();
    if (tell) onChange(v);
  };
  show();

  dial.addEventListener("pointerdown", (e) => {
    dial.setPointerCapture(e.pointerId);
    dial.focus();
    let y = e.clientY;
    const move = (m: PointerEvent) => { set(v + ((y - m.clientY) / (m.shiftKey ? 600 : 150)) * 10); y = m.clientY; };
    const up = () => { dial.removeEventListener("pointermove", move); dial.removeEventListener("pointerup", up); dial.removeEventListener("pointercancel", up); };
    dial.addEventListener("pointermove", move);
    dial.addEventListener("pointerup", up);
    dial.addEventListener("pointercancel", up);
  });
  dial.addEventListener("wheel", (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 0.5)); }, { passive: false });
  dial.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.5;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(v + step);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(v - step);
    else if (e.key === "Home") set(0);
    else if (e.key === "End") set(10);
    else return;
    e.preventDefault();
  });
  dial.addEventListener("dblclick", () => set(dflt));
  return { el, set: (n) => set(n, false) };
}
