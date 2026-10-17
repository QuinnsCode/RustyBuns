# Half Dome as a far landmark, modelled in Blender and written out at three polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/landmark.py -- [--render out.png]
#
# A backdrop, not terrain: nothing rides on it. The park's own ground already has the dome's shape, but from
# the spawn, through fog and grey-on-grey, it is mud. This is the silhouette that reads at a kilometre: a
# sheer face on the west (-x), a rounded shoulder falling away east, forest and talus at the foot, dark water
# streaks down the face. Built in the game's frame (y up) and normalised: the crest is 1 high at x = 0, the
# shoulder runs out to x = SHOULDER and the foot of the face to x = -FOOT, z runs -DEPTH..DEPTH. `peak()` in
# src/render/peak.ts scales it to metres and stands it behind the park's edge; the glTF materials are named
# for what it paints and the page tints them toward the haze.
import math
import os
import sys

import bmesh
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, join, obj, render, reset, write_glb  # noqa: E402

hexes = {"granite": 0x9A958C, "granite-dark": 0x6A655E, "streak": 0x45413C, "lichen": 0x7A8A5A, "forest": 0x3F5638, "talus": 0x8A8478}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.95, 0) for k, h in hexes.items()})

SHOULDER, FOOT, DEPTH = 1.5, 0.55, 1.3
WALL = 0.1  # the sheer wall's share of the way from the crest line to the foot (it drops 1 - TALUS in WALL * FOOT)
TALUS = 0.2  # how high the apron of fallen rock rises against the wall
TREELINE = 0.2
BUDGETS = {"hi": (120, 96), "mid": (72, 56), "low": (40, 30)}  # columns along x, rows along z


def xs(n):
    """Columns from the foot of the face to the end of the shoulder, packed round the face where the shape turns."""
    out = []
    for i in range(n + 1):
        t = i / n
        # t -> x: dense over the face (x in -FOOT..0.15), looser out along the shoulder
        out.append(-FOOT + (SHOULDER + FOOT) * (t ** 1.6 if t > 0.0 else 0))
    return out


def wobble(x, z, seed, cell):
    return noise.noise(Vector((x / cell, z / cell, seed)))


def height(x, z):
    # Across: a rounded ridge, flat-topped near z = 0 and falling to nothing at +-DEPTH.
    across = max(0.0, 1 - (abs(z) / DEPTH) ** 2.4) ** 0.8
    if x >= 0:  # the shoulder: domed at the crest, then a long curve down
        u = min(1.0, x / SHOULDER)
        along = max(0.0, 1 - u ** 1.9) ** 0.7
    else:  # the face: a cliff from the crest down to the talus apron
        u = -x / FOOT
        if u < WALL:  # the wall: vertical to within a few degrees, a lip rounded off at the crest
            t = u / WALL
            along = 1 - (1 - TALUS) * (t ** 1.4 if t > 0.1 else 0.1 ** 1.4 * (t / 0.1) ** 2)
        else:  # the talus apron, steep at the wall and easing out
            along = TALUS * (1 - (u - WALL) / (1 - WALL)) ** 1.8
    h = across * along
    # Ridges and ledges: a little broken stone on the shoulder, vertical fluting down the face.
    if x >= 0:
        h *= 1 + 0.025 * wobble(x, z, 3.1, 0.18) + 0.012 * wobble(x, z, 8.3, 0.05)
    else:
        h *= 1 + 0.03 * wobble(x * 0.15, z, 5.7, 0.07)
    return h


def build(cols, rows):
    bm = bmesh.new()
    cx = xs(cols)
    cz = [-DEPTH + 2 * DEPTH * (i / rows) for i in range(rows + 1)]
    grid = [[bm.verts.new((x, height(x, z), z)) for x in cx] for z in cz]
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    return bm


def landmark(cols, rows):
    bm = build(cols, rows)
    mats = ["granite", "granite-dark", "streak", "lichen", "forest", "talus"]
    o = obj("half-dome", bm, mats)
    for f in o.data.polygons:
        c, n = f.center, f.normal
        flat = n.y  # 1 on level ground, near 0 on the sheer face
        if c.y < TREELINE * (0.8 + 0.4 * wobble(c.x, c.z, 1.7, 0.2)) and flat > 0.55:
            name = "forest"
        elif c.y < 0.16 and flat > 0.2:
            name = "talus"
        elif flat < 0.45:  # the face: pale rock with dark streaks running down it
            streak = wobble(c.x * 0.1, c.z, 9.1, 0.12)
            name = "streak" if streak > 0.1 else "granite-dark" if streak > -0.12 else "granite"
        else:  # the cap and shoulder: pale, mottled, a patch of lichen
            k = wobble(c.x, c.z, 4.4, 0.7)
            name = "lichen" if k > 0.3 and c.y < 0.7 else "granite-dark" if k < -0.25 else "granite"
        f.material_index = mats.index(name)
    print({m: sum(1 for f in o.data.polygons if f.material_index == i) for i, m in enumerate(mats)})
    return [o]


def main():
    for budget, (cols, rows) in BUDGETS.items():
        reset()
        write_glb(join(landmark(cols, rows), "half-dome", smooth=55), os.path.join(OUT, f"landmark-half-dome-{budget}.glb"))
    if "--render" in sys.argv:
        path = os.path.abspath(sys.argv[sys.argv.index("--render") + 1])
        reset()
        join(landmark(*BUDGETS["mid"]), "half-dome", smooth=55)
        # Blender's frame: y is the game's -z... the view is from the east, where the park (and its spawn) is, then from the south-west.
        render(path, (("", (6.0, 0.4, 0.7)), ("-face", (-3.5, -3.5, 1.4))), target=(0, 0, 0.45), size=(1400, 600))


main()
