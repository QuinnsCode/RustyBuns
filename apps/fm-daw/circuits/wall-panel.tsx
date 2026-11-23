// A sound wall module's front panel as a board of its own (WALL.md): plain 1.6 mm FR4 the panel's size, its jack,
// pot and rail screw holes where circuits/wall-panels.ts puts them (panelHoles), the module's name and each label
// in silkscreen. No copper and no parts: a fab makes it beside the module's board, so nobody drills aluminium from
// drill.svg. Units are mm, y up, from the middle of the panel (the module's board sits on the same middle).
import { PANEL_H, panelHoles, panelWidth, type Panel } from "./wall-panels.ts";

/** How far a label sits above its hole's edge: clear of a jack's nut and a knob's cap. */
const LABEL_UP = 3.2;

export function panelBoard(p: Panel) {
  const w = panelWidth(p.hp), at = (x: number, y: number) => ({ pcbX: x - w / 2, pcbY: PANEL_H / 2 - y });
  const holes = panelHoles(p);
  return (
    <board width={`${w}mm`} height={`${PANEL_H}mm`}>
      <silkscreentext text={p.name} pcbX={0} pcbY={PANEL_H / 2 - 13} fontSize="2.4mm" />
      {holes.map((h, i) => <hole key={`h${i}`} diameter={`${h.drill}mm`} {...at(h.x, h.y)} />)}
      {holes.filter((h) => h.name !== "screw").map((h, i) => {
        const c = at(h.x, h.y);
        return <silkscreentext key={`t${i}`} text={h.name} pcbX={c.pcbX} pcbY={c.pcbY + h.drill / 2 + LABEL_UP} fontSize="1.4mm" />;
      })}
    </board>
  );
}
