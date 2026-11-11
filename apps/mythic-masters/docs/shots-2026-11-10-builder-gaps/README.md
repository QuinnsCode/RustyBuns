# Builder gaps: open jaw, knees and elbows, fur colour (#4172)

The Hodag rebuild (#4171) found three things `blender/beast.py` couldn't do. Each one is now a sheet option,
and a sheet that doesn't use them builds exactly as before (the Hodag and Ahuizotl GLBs came out byte for byte the same).

- **Open jaw**: on a `skull` part, `gape: 28` hangs a lower jaw open from under the stop. The gap is lined in
  the palette's `mouth` colour (or `dark`), and `teeth: 5` puts a row along each lip, top and bottom, with the
  front pair as fangs. `tooth: [len, base]` sizes them; `tooth_mat` colours them (default `fang`, `tooth`, then `claw`).
- **Knees and elbows**: on a `limb` part, `shoulder: 0.25` swells the top of the leg, and `elbow: 0.3` puts a
  knob on each middle node that juts out at the back more than at the sides.
- **Fur colour**: a `tuft` with no `material` takes the palette's `tuft` colour when there is one, so fur
  can be a different colour from the hide.

`before.jpg` is the old Hodag sheet. `open-jaw-knees-fur.jpg` is the same sheet with `gape: 28, teeth: 5` on
the skull (its old `teeth` part removed), `shoulder: 0.25, elbow: 0.3` on the legs, and a pale `tuft` ruff
along the back.
