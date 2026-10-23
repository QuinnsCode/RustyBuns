# Far landmarks for the parks beyond the Sierra, modelled in Blender and written out at three polygon budgets.
#
#   blender -b --factory-startup -P apps/skate-tech-park/blender/landmarks.py -- [--render out.png]
#
# Like Half Dome (landmark.py) these are backdrops, not terrain: a silhouette that reads at a kilometre through the
# haze, standing past the park's edge (a `peak` landmark with this model's name, drawn by src/render/peak.ts). Each
# is built in the game's frame (y up) and normalised: its crest is 1 high at x = 0 and its foot is on y = 0, with
# the whole of it inside x -1..1.5 and z -1.3..1.3, so `peak()` scales it by `tall` and stands it on `y`.
#
#   arch     a free-standing sandstone arch on a slickrock pedestal, thicker at the legs than the crown
#   hoodoos  an amphitheatre of spires: banded orange and white, stepped where a harder layer caps a softer one,
#            rising out of a fin that falls away behind them
#   mesa     a flat-topped monolith: sheer banded walls, a pale cap, a talus apron, a notch on one shoulder
#   volcano  a snow-capped cone with glacier-cut ridges, the snowline two thirds of the way up, forest at the foot
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, PALETTE, args, join, obj, render, reset, write_glb  # noqa: E402

hexes = {
    "sandstone": 0xC8744A, "sandstone-dark": 0x9E5536, "sandstone-pale": 0xE2A77C, "slickrock": 0xB9865E,
    "hoodoo": 0xD9804E, "hoodoo-pale": 0xEFD6B8, "hoodoo-dark": 0xA75A33,
    "wall": 0xB45E3C, "wall-dark": 0x7E3F27, "cap": 0xE9DFCF, "talus": 0x9A7A62, "scrub": 0x6B7A4A,
    "snow": 0xF4F6F8, "snow-shade": 0xC9D2DC, "rock": 0x6E6A66, "rock-dark": 0x4C4845, "forest": 0x3F5638,
}
PALETTE.update({k: ((h >> 16) / 255, (h >> 8 & 255) / 255, (h & 255) / 255, 0.95, 0) for k, h in hexes.items()})

BUDGETS = {"hi": 22000, "mid": 8000, "low": 2400}
rng = random.Random(11)


def wobble(x, z, seed, cell):
    return noise.noise(Vector((x / cell, z / cell, seed)))


def field(height, cols, rows, x0, x1, z0, z1):
    """A heightfield as a bmesh: `height(x, z)` sampled on a grid."""
    bm = bmesh.new()
    grid = [[bm.verts.new((x0 + (x1 - x0) * i / cols, height(x0 + (x1 - x0) * i / cols, z0 + (z1 - z0) * j / rows), z0 + (z1 - z0) * j / rows)) for i in range(cols + 1)] for j in range(rows + 1)]
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j + 1][i], grid[j + 1][i + 1], grid[j][i + 1]))
    return bm


def paint(o, mats, pick):
    for f in o.data.polygons:
        f.material_index = mats.index(pick(f.center, f.normal))
    return o


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# --- arch ------------------------------------------------------------------------------------------------

def sweep(profile, path, closed=False):
    """Extrude a profile (list of (u, v) in the path's normal plane) along a list of (point, normal, binormal)."""
    bm = bmesh.new()
    rings = []
    for p, n, b in path:
        rings.append([bm.verts.new(p + n * u + b * v) for u, v in profile])
    for a, c in zip(rings, rings[1:]):
        for i in range(len(profile)):
            bm.faces.new((a[i], a[(i + 1) % len(profile)], c[(i + 1) % len(profile)], c[i]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return bm


def arch(budget):
    segs = {"hi": 48, "mid": 28, "low": 14}[budget]
    prof_n = {"hi": 14, "mid": 10, "low": 7}[budget]
    # the arch's centre line: a semicircle of radius R in the x-y plane, legs splayed and sunk into the pedestal
    R, span = 0.58, 0.95
    path = []
    for i in range(segs + 1):
        t = i / segs
        a = math.pi * (1 - t)  # from the -x foot over the crown to the +x foot
        x, y = span / 2 * math.cos(a) * (1 + 0.15 * math.sin(a)), 0.12 + R * math.sin(a) * 1.45
        p = Vector((x, max(0.0, y), 0))
        tangent = Vector((-span / 2 * math.sin(a) * (1 + 0.15 * math.sin(a)) + span / 2 * math.cos(a) * 0.15 * math.cos(a), R * 1.45 * math.cos(a), 0)).normalized()
        n = Vector((0, 0, 1))
        b = tangent.cross(n).normalized()
        # one leg is a fat buttress and the other slender, as the wind leaves them; the crown is the thinnest and is
        # wider front to back than across, so the opening reads as a window from the side
        leg = (1 - math.sin(a)) ** 1.3
        fat = smooth(1 - t / 0.5) * 1.6 + smooth((t - 0.5) / 0.5) * 0.9
        thick = 0.11 + 0.12 * leg * fat
        depth = 0.2 + 0.08 * leg * fat
        path.append((p, n * depth, b * thick))
    profile = [(math.cos(2 * math.pi * k / prof_n), math.sin(2 * math.pi * k / prof_n)) for k in range(prof_n)]
    bm = sweep(profile, path)
    for v in bm.verts:
        v.co += Vector((0, 0, 0)) + Vector((1, 0, 1)) * 0.012 * wobble(v.co.x * 3, v.co.y * 3 + v.co.z, 2.0, 0.3)
    mats = ["sandstone", "sandstone-dark", "sandstone-pale", "slickrock"]
    o = obj("arch", bm, mats)
    # the pedestal: a bowl of slickrock the arch stands on, higher under the legs, with ledges like the real fins
    cols = {"hi": 90, "mid": 56, "low": 30}[budget]

    def ground(x, z):
        r = math.hypot(x * 0.9, z * 1.2)
        base = 0.16 * smooth(1 - r / 1.25) + 0.06 * smooth(1 - r / 0.55)
        ledges = 0.012 * math.floor(6 * (0.5 + 0.5 * wobble(x, z, 7.0, 0.6))) / 6
        return max(0.0, base + 0.02 * wobble(x, z, 3.0, 0.25) + ledges) - 0.004

    ped = paint(obj("pedestal", field(ground, cols, int(cols * 0.8), -1.0, 1.4, -1.3, 1.3), ["slickrock", "sandstone-dark", "sandstone"]),
                ["slickrock", "sandstone-dark", "sandstone"], lambda c, n: "sandstone-dark" if n.y < 0.75 else "sandstone" if wobble(c.x, c.z, 5.0, 0.12) > 0.3 else "slickrock")

    def pick(c, n):
        band = wobble(0, c.y * 4, 1.0, 0.5)
        return "sandstone-pale" if c.y > 0.9 and n.y > 0.4 else "sandstone-dark" if band > 0.2 else "sandstone"

    paint(o, mats, pick)
    # the crest is at 1: the crown of the arch
    return [o, ped], 1.0


# --- hoodoos ----------------------------------------------------------------------------------------------

def hoodoos(budget):
    n_spires = {"hi": 40, "mid": 28, "low": 16}[budget]
    rings = {"hi": 22, "mid": 14, "low": 8}[budget]
    segs = {"hi": 16, "mid": 10, "low": 7}[budget]
    cols = {"hi": 80, "mid": 52, "low": 28}[budget]
    rng.seed(11)

    def fin(x, z):  # the amphitheatre wall the spires grow from: high at the back (+x), falling away to the front (-x)
        back = smooth((x + 0.6) / 1.6) * 0.52
        return max(0.0, back * (1 - 0.35 * smooth(abs(z) / 1.3 - 0.4)) + 0.03 * wobble(x, z, 2.0, 0.3)) - 0.004

    base = paint(obj("fin", field(fin, cols, int(cols * 0.8), -1.0, 1.5, -1.3, 1.3), ["hoodoo", "hoodoo-dark", "scrub"]),
                 ["hoodoo", "hoodoo-dark", "scrub"], lambda c, n: "scrub" if c.y < 0.03 and n.y > 0.9 else "hoodoo-dark" if n.y < 0.6 else "hoodoo")
    out = [base]
    mats = ["hoodoo", "hoodoo-pale", "hoodoo-dark"]
    spires = [(0.0, 0.0, 1.0)]  # the tallest at the origin: the crest
    for _ in range(n_spires - 1):
        x, z = rng.uniform(-0.5, 1.1), rng.uniform(-1.0, 1.0)
        spires.append((x, z, rng.uniform(0.3, 0.75)))
    for x, z, h in spires:
        foot = fin(x, z)
        h = foot + h * (1 - foot) if h < 1 else h  # the tallest stands at the origin as the crest; the rest rise out of the fin
        r0 = 0.045 + 0.035 * h
        bm = bmesh.new()
        prev = None
        cuts = [rng.uniform(0.25, 0.45), rng.uniform(0.6, 0.8)]  # where a harder cap steps the spire in
        for k in range(rings + 1):
            t = k / rings
            r = r0 * (1 - 0.55 * t) * (1 + 0.08 * wobble(t * 3, x + z, 4.0, 0.3))
            for c in cuts:  # a hard layer: fat just under it, thinner above
                if abs(t - c) < 0.05:
                    r *= 1.18
                elif t > c:
                    r *= 0.9
            ring = [bm.verts.new((x + r * math.cos(2 * math.pi * i / segs), foot + (h - foot) * t, z + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)]
            if prev:
                for i in range(segs):
                    bm.faces.new((prev[i], prev[(i + 1) % segs], ring[(i + 1) % segs], ring[i]))
            prev = ring
        bm.faces.new(prev)
        o = obj("spire", bm, mats)
        paint(o, mats, lambda c, n, h=h, foot=foot, cuts=cuts: "hoodoo-pale" if any(abs((c.y - foot) / (h - foot) - cut) < 0.06 for cut in cuts) or (c.y - foot) / (h - foot) > 0.93 else "hoodoo-dark" if wobble(0, c.y * 9, 2.0, 0.5) > 0.25 else "hoodoo")
        out.append(o)
    return out, 1.0


# --- mesa -------------------------------------------------------------------------------------------------

def mesa(budget):
    cols = {"hi": 150, "mid": 96, "low": 52}[budget]

    def height(x, z):
        # a rounded-rectangle plan with a notch on the +x shoulder; sheer walls over a talus apron
        qx, qz = abs(x - 0.15) - 0.42, abs(z) - 0.6
        d = math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0) - 0.18  # signed distance to the cap's edge
        d += 0.05 * wobble(x, z, 6.0, 0.35)
        notch = smooth(1 - math.hypot((x - 0.55) * 2.2, z + 0.5) / 0.5) * 0.3
        cap = 0.98 - 0.08 * smooth((x - 0.3) / 0.6) + 0.015 * wobble(x, z, 1.0, 0.2)
        wall_w = 0.08
        if d < 0:
            top = cap
        elif d < wall_w:  # the wall: nearly vertical, fluted
            t = d / wall_w
            top = 0.3 + (cap - 0.3) * (1 - t ** 1.6) + 0.02 * wobble(x * 0.2, z, 9.0, 0.06) * (1 - t)
        else:  # the talus apron
            top = 0.3 * max(0.0, 1 - (d - wall_w) / 0.7) ** 1.7
        top = max(0.0, top - notch) + 0.01 * wobble(x, z, 3.0, 0.15)
        return max(0.0, top * smooth(1 - math.hypot(x / 1.4, z / 1.3) ** 2 * 0.3)) - 0.004

    mats = ["cap", "wall", "wall-dark", "talus", "scrub"]
    o = paint(obj("mesa", field(height, cols, int(cols * 0.9), -1.0, 1.5, -1.3, 1.3), mats), mats,
              lambda c, n: "scrub" if c.y < 0.06 and n.y > 0.85 else "talus" if c.y < 0.3 and n.y > 0.5 else "cap" if n.y > 0.8 and c.y > 0.6 else ("wall-dark" if wobble(0, c.y * 8, 2.0, 0.5) > 0.2 else "wall"))
    return [o], 1.0


# --- volcano ----------------------------------------------------------------------------------------------

def volcano(budget):
    cols = {"hi": 150, "mid": 96, "low": 52}[budget]

    def height(x, z):
        r = math.hypot(x, z * 0.95)
        a = math.atan2(z, x)
        cone = max(0.0, 1 - r / 1.25) ** 1.55
        # ridges and the glacier valleys between them: eight spokes, sharper and deeper further from the crater
        spoke = math.cos(a * 8 + 0.4 + 0.6 * wobble(x, z, 2.0, 0.6))
        ridges = 1 + (0.05 + 0.16 * smooth(r / 0.9)) * (abs(spoke) ** 0.6 * (1 if spoke > 0 else -1)) * smooth(r / 0.15) + 0.05 * wobble(x, z, 5.0, 0.22)
        crater = -0.06 * smooth(1 - r / 0.08)
        return max(0.0, cone * ridges + crater) * (1 - 0.1 * smooth(r / 1.1)) - 0.004

    mats = ["snow", "snow-shade", "rock", "rock-dark", "forest"]

    def pick(c, n):
        a = math.atan2(c.z, c.x)
        valley = smooth(-math.cos(a * 8 + 0.4) * 1.5)  # 1 in a glacier valley, 0 on a ridge
        snowline = 0.62 - 0.22 * valley + 0.04 * wobble(c.x, c.z, 4.0, 0.3)  # glaciers reach further down the valleys
        if c.y > snowline:
            return "snow" if n.y > 0.6 else "snow-shade"
        if c.y < 0.18 + 0.05 * wobble(c.x, c.z, 6.0, 0.2) and n.y > 0.7:
            return "forest"
        return "rock-dark" if n.y < 0.62 else "rock"

    o = paint(obj("volcano", field(height, cols, cols, -1.0, 1.5, -1.3, 1.3), mats), mats, pick)
    return [o], 1.0


MODELS = {"arch": arch, "hoodoos": hoodoos, "mesa": mesa, "volcano": volcano}
VIEWS = {"arch": (2.6, -3.0, 1.0), "hoodoos": (-2.8, -2.4, 1.4), "mesa": (2.8, -2.8, 1.4), "volcano": (2.6, -3.0, 1.6)}


def normalise(o):
    """Foot exactly on 0 and crest exactly at 1 (Blender's z is the game's y after join), the same scale all round."""
    zs = [v.co.z for v in o.data.vertices]
    lo, hi = min(zs), max(zs)
    o.data.transform(Matrix.Translation((0, 0, -lo)) @ Matrix.Identity(4))
    o.data.transform(Matrix.Scale(1 / (hi - lo), 4))


def main():
    opts = args()
    out = opts[opts.index("--render") + 1] if "--render" in opts else None
    for name, build in MODELS.items():
        for budget, target in BUDGETS.items():
            reset()
            parts, crest = build(budget)
            o = join(parts, name, smooth=50)
            normalise(o)
            write_glb(o, os.path.join(OUT, f"landmark-{name}-{budget}.glb"), target)
            if out and budget == "mid":
                stem, ext = os.path.splitext(out)
                render(f"{stem}-{name}{ext}", [("", VIEWS[name])], target=(0.2, 0, 0.4), size=(1400, 700))


main()
