"""Mythic Masters' native plants, grown from a spec in headless Blender.

    blender -b --factory-startup --python-exit-code 1 -P blender/flora.py -- flora/<id>.json [--render] [--seed N] [--variants N]
    blender -b --factory-startup --python-exit-code 1 -P blender/flora.py -- --lineup <name> flora/a.json flora/b.json ...

A spec (`flora/<id>.json`) names a generator and its knobs; scripts/flora.ts is the front door (`bun run flora`).
Every plant is grown twice from the same seed: `<id>` (near, full detail) and `<id>-lo` (fewer, bigger leaves and
thinner tubes, for past 70 m), written together to public/models/flora/<id>.glb. Both stand on their foot at the
origin, Y up, at the spec's `height` in metres; the game scales them to the size it plants.

Generators:
  tree     stems (one is a tree, several a shrub) that branch level by level, with leaves, needle tufts, flat sprays,
           lumpy clumps, compound leaves, berries, flowers, hanging moss and a buttressed, fluted foot
  rosette  blades from one crown: strap, lance, oval, agave, fan (palmetto), pinnate (fern), tube (pitcher), with
           flower stalks: cone (coneflower), cattail, spathe (skunk cabbage), plume (bluestem), cup (pitcher flower)
  cactus   barrel (ribbed, spined, fruit on top) or pads (prickly pear, pad on pad, fruit on the rims)
  knees    a cluster of cypress knees

Colour is per vertex, linear: the spec's palette jittered per leaf, times a baked ray-cast occlusion (inside a crown is
dark, its outside light), a little lighter toward the sun. Leaves carry normals pointing out of the crown, so a canopy
shades like one soft mass instead of a thousand flickering cards. Every random number comes from the seed, so a spec
always grows the same plant.
"""
import colorsys
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
UP = Vector((0, 0, 1))
DOWN = Vector((0, 0, -1))
GOLDEN = math.pi * (3 - math.sqrt(5))
WOOD, LEAF = 0, 1


# --- colour --------------------------------------------------------------------------------------------------------
def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    h = h.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def jitter(c, rng, hue=0.02, sat=0.08, val=0.12):
    """A colour a little off: hue, saturation and value nudged, in sRGB-ish space so the steps look even."""
    s = [x ** (1 / 2.2) for x in c]
    h, l, v = colorsys.rgb_to_hsv(*s)
    h = (h + (rng.random() - 0.5) * 2 * hue) % 1
    l = min(1, max(0, l * (1 + (rng.random() - 0.5) * 2 * sat)))
    v = min(1, max(0, v * (1 + (rng.random() - 0.5) * 2 * val)))
    return tuple(x ** 2.2 for x in colorsys.hsv_to_rgb(h, l, v))


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def pick(rng, cols):
    return cols[rng.randrange(len(cols))]


# --- geometry ------------------------------------------------------------------------------------------------------
class Geo:
    """Vertices with a colour, a tag (wood or leaf) and, for leaves, the way they face; and faces."""

    def __init__(self):
        self.v, self.c, self.tag, self.out, self.f = [], [], [], [], []

    def vert(self, p, col, tag=WOOD, out=None):
        self.v.append(Vector(p))
        self.c.append(col)
        self.tag.append(tag)
        self.out.append(out)
        return len(self.v) - 1

    def face(self, *ids):
        self.f.append(ids)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def perp(t):
    """A unit vector square to t, leaning horizontal when it can (so branch frames don't spin)."""
    s = t.cross(UP)
    if s.length < 1e-4:
        s = t.cross(Vector((1, 0, 0)))
    return s.normalized()


def frames(pts):
    """Tangents and normals along a polyline, carried along it without twisting (parallel transport)."""
    n = len(pts)
    ts = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    ns = [perp(ts[0])]
    for i in range(1, n):
        q = ts[i - 1].rotation_difference(ts[i])
        ns.append((q @ ns[-1]).normalized())
    return ts, ns


def tube(g, pts, radii, sides, colour, flare=None, cap=True):
    """A tube along `pts`, `radii` at each, `sides` round; `colour(u, angle, at, off)` paints it; `flare(i, angle)`
    pushes a ring out (buttresses, ribs). The tip closes to a point."""
    if sides < 3 or len(pts) < 2:
        return
    ts, ns = frames(pts)
    rings = []
    for i, (p, r) in enumerate(zip(pts, radii)):
        b = ts[i].cross(ns[i])
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            off = ns[i] * math.cos(a) + b * math.sin(a)
            rr = r * (flare(i, a) if flare else 1)
            at = p + off * rr
            ring.append(g.vert(at, colour(i / (len(pts) - 1), a, at, off)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            a, b_ = rings[i][k], rings[i][(k + 1) % sides]
            c, d = rings[i + 1][(k + 1) % sides], rings[i + 1][k]
            g.face(a, b_, c, d)
    if cap:
        tip = g.vert(pts[-1] + ts[-1] * radii[-1], colour(1, 0, pts[-1], ts[-1]))
        for k in range(sides):
            g.face(rings[-1][k], rings[-1][(k + 1) % sides], tip)


def card(g, base, d, side, length, width, col, out, fold=0.25, tip_col=None, at=0.45):
    """A leaf as a diamond: base, two shoulders `at` along it, tip, creased along the midrib by `fold`."""
    n = d.cross(side).normalized()
    a = g.vert(base, col, LEAF, out)
    m = base + d * (length * at) + n * (width * fold)
    l = g.vert(m + side * (width / 2), col, LEAF, out)
    r = g.vert(m - side * (width / 2), col, LEAF, out)
    t = g.vert(base + d * length, tip_col or col, LEAF, out)
    g.face(a, l, t)
    g.face(a, t, r)


def blob(g, centre, r, col, rng, subdiv=1, lump=0.3, squash=1.0, tag=LEAF, out_from=None, jit=0.0):
    """A lumpy ball: a dense clump of scale leaves, a berry, a fruit."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1)
    seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
    ids = {}
    from mathutils import noise
    turn = Matrix.Rotation(rng.random() * math.tau, 3, UP) @ Matrix.Rotation(rng.random() * 0.6, 3, Vector((1, 0, 0)))
    for v in bm.verts:
        c = turn @ v.co
        # two octaves of lumps, so a clump's edge breaks up instead of reading as a polygon
        k = 1 + lump * (noise.noise(c * 2.4 + seed) + 0.5 * noise.noise(c * 5.1 + seed * 1.7))
        p = centre + Vector((c.x * r * k, c.y * r * k, c.z * r * k * squash))
        # each clump shades as its own ball, leaning toward the crown's outside
        o = (c.normalized() * 0.55 + (p - out_from).normalized() * 0.45).normalized() if out_from is not None else c.normalized()
        ids[v.index] = g.vert(p, jitter(col, rng, 0.01, 0.05, jit) if jit else col, tag, o if tag == LEAF else None)
    for f in bm.faces:
        g.face(*[ids[v.index] for v in f.verts])
    bm.free()


def blade(g, base, d, length, width, shape, arch, segs, cols, rng, fold=0.2, side=None, tag=LEAF, out=None, droop_tip=0.0):
    """A long leaf from `base` along `d`, bending down by `arch` as it goes, `width` at its widest; `shape` sets
    how wide along it (strap, lance, oval, agave, grass). Three vertices a row: the midrib and both edges, the
    edges lifted by `fold` so it has a crease. `cols` runs base to tip."""
    side = (side or perp(d)).normalized()
    pts, p, dd = [], Vector(base), Vector(d).normalized()
    for j in range(segs + 1):
        pts.append(p.copy())
        u = (j + 1) / segs
        dd = (dd + DOWN * (arch * 1.6 / segs) * (0.4 + u)).normalized()
        p = p + dd * (length / segs)
    ts, _ = frames(pts)
    rows = []
    for j, p in enumerate(pts):
        u = j / segs
        if shape == "strap":
            w = 1 - u ** 3
        elif shape == "grass":
            w = (1 - u) ** 0.8
        elif shape == "agave":
            w = (1 - u) ** 0.7 * (0.6 + 0.4 * min(1, u * 4))
        elif shape == "oval":
            w = math.sin(math.pi * min(1, 0.04 + u * 0.96)) ** 0.6
        else:  # lance
            w = math.sin(math.pi * min(1, 0.03 + u * 0.97)) ** 0.8
        w *= width / 2
        s = ts[j].cross(side.cross(ts[j])).normalized() if False else side
        n = ts[j].cross(s).normalized()
        if n.dot(UP) < 0:
            n = -n
        col = mix(cols[0], cols[-1], u)
        o = out if out is not None else (n * 0.6 + UP * 0.4).normalized()
        mid = g.vert(p, col, tag, o)
        left = g.vert(p + s * w + n * (w * fold), col, tag, o)
        right = g.vert(p - s * w + n * (w * fold), col, tag, o)
        rows.append((mid, left, right))
    for j in range(segs):
        m0, l0, r0 = rows[j]
        m1, l1, r1 = rows[j + 1]
        g.face(m0, l0, l1, m1)
        g.face(m0, m1, r1, r0)
    return pts


def pinnate(g, base, d, length, pairs, leaflet, arch, cols, rng, out=None, flat=None, rachis=None):
    """A compound leaf or a fern frond: a stem arching from `base`, leaflets in pairs along it, longest in the middle."""
    side = (flat or perp(d)).normalized()
    pts, p, dd = [], Vector(base), Vector(d).normalized()
    segs = max(3, pairs)
    for j in range(segs + 1):
        pts.append(p.copy())
        dd = (dd + DOWN * (arch * 1.8 / segs)).normalized()
        p = p + dd * (length / segs)
    ts, _ = frames(pts)
    if rachis:
        tube(g, pts, [rachis * (1 - j / (segs + 1)) for j in range(segs + 1)], 3, lambda *_: cols[0], cap=False)
    for k in range(pairs):
        u = (k + 0.5) / pairs
        i = min(segs - 1, int(u * segs))
        f = u * segs - i
        at = pts[i].lerp(pts[i + 1], f)
        t = ts[i]
        s = (side - t * side.dot(t)).normalized()
        span = leaflet * (math.sin(math.pi * (0.15 + 0.85 * u)) ** 0.7) * (1.15 - u * 0.4)
        col = jitter(mix(cols[0], cols[-1], u), rng, 0.01, 0.05, 0.08)
        for sg in (1, -1):
            dir_ = (s * sg + t * 0.55 + DOWN * 0.1).normalized()
            card(g, at, dir_, t.cross(dir_).normalized() if t.cross(dir_).length > 1e-4 else perp(dir_), span, span * 0.38, col, out, fold=0.15)


# --- trees and shrubs ------------------------------------------------------------------------------------------------
class Axis:
    def __init__(self, pts, radii, level):
        self.pts, self.radii, self.level, self.parent = pts, radii, level, None
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + (b - a).length)
        self.length = self.cum[-1]

    def at(self, t):
        """Where along it a share t of its length lands: the point, the way it runs, its radius there."""
        s = t * self.length
        for i in range(len(self.pts) - 1):
            if self.cum[i + 1] >= s or i == len(self.pts) - 2:
                seg = self.cum[i + 1] - self.cum[i] or 1
                f = max(0, min(1, (s - self.cum[i]) / seg))
                return (self.pts[i].lerp(self.pts[i + 1], f), (self.pts[i + 1] - self.pts[i]).normalized(),
                        self.radii[i] + (self.radii[i + 1] - self.radii[i]) * f)
        return self.pts[-1], UP, self.radii[-1]


def envelope(shape, u):
    """How long a branch is at a share u up the part of its parent that branches (0 bottom, 1 top)."""
    if shape == "conical":
        return 1 - 0.88 * u
    if shape == "columnar":
        return 0.55 + 0.45 * math.sin(math.pi * min(1, 0.2 + u * 0.8)) - 0.35 * u
    if shape == "ovoid":
        return math.sin(math.pi * (0.18 + 0.82 * u)) ** 0.8
    if shape == "round":
        return max(0.15, math.sin(math.pi * u)) ** 0.5
    if shape == "spreading":
        return 0.7 + 0.3 * u
    if shape == "flat":
        return 0.5 + 0.5 * u ** 0.5
    return 1.0


def grow_path(start, d0, length, segs, rng, droop=0.0, rise=0.0, wobble=0.0, kink=0.0):
    """A branch's line: `segs` steps from `start`, pulled down by `droop`, up by `rise`, wandering by `wobble`."""
    pts, p, d = [Vector(start)], Vector(start), Vector(d0).normalized()
    step = length / segs
    for i in range(segs):
        r = Vector((rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5))
        d = (d + DOWN * (droop * 2.2 / segs) + UP * (rise * 2.2 / segs) + r * (wobble * 1.2 / segs ** 0.5)).normalized()
        if kink and rng.random() < kink:
            d = (d + r * 1.2).normalized()
        p = p + d * step
        pts.append(p.copy())
    return pts


def bark_colour(spec, rng, height):
    """A function painting the bark: the spec's colours in its pattern, darker at the foot."""
    from mathutils import noise
    b = spec.get("bark", {})
    cols = [hexc(c) for c in b.get("colors", ["#5a4634", "#3c2e22"])]
    pattern = b.get("pattern", "plain")
    moss = hexc(b["moss"]) if b.get("moss") else None
    seed = Vector((rng.random() * 99, rng.random() * 99, rng.random() * 99))

    def paint(u, a, at, off):
        k = noise.noise(at * 2.3 + seed) * 0.5 + 0.5
        c = mix(cols[0], cols[-1], k)
        if pattern == "birch":
            white = hexc(b.get("light", "#e8e4d8"))
            dash = noise.noise(Vector((at.x * 1.5, at.y * 1.5, at.z * 14)) + seed)
            c = mix(white, cols[-1], 1.0 if dash > 0.42 else 0.12 + 0.1 * k)
            if at.z < height * 0.06:
                c = mix(c, cols[-1], 0.7)
        elif pattern == "plates":
            ridge = abs(noise.noise(Vector((at.x * 6, at.y * 6, at.z * 1.4)) + seed))
            c = mix(cols[0], cols[-1], 1.0 if ridge < 0.12 else 0.2 * k)
        elif pattern == "fibrous":
            streak = noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, at.z * 0.6)) + seed)
            c = mix(cols[0], cols[-1], 0.5 + 0.5 * streak)
        if moss and off.z > -0.1:
            m = max(0, off.z + 0.25) * (0.6 + 0.4 * noise.noise(at * 3.1 + seed * 2))
            c = mix(c, moss, min(1, m * b.get("moss_amount", 1.0)))
        foot = min(1, at.z / (height * 0.08 + 1e-3))
        return mix(tuple(x * 0.55 for x in c), c, foot)

    return paint


def tree(spec, g, rng, lo):
    H = spec["height"]
    tr = spec.get("trunk", {})
    stems = tr.get("stems", 1)
    sides = max(3, round(tr.get("sides", 9) * (0.6 if lo else 1)))
    bark = bark_colour(spec, rng, H)
    axes = []
    for s in range(stems):
        az = s * GOLDEN * 2.3 + rng.random() * 0.6
        spread = tr.get("spread", 0.0) * (0.4 + 0.6 * rng.random()) if stems > 1 else 0
        lean = tr.get("lean", 0.0) if stems == 1 else tr.get("splay", 0.25) * (0.5 + rng.random())
        d = (UP + Vector((math.cos(az), math.sin(az), 0)) * lean).normalized()
        base = Vector((math.cos(az) * spread, math.sin(az) * spread, -0.05 * H))
        length = H * tr.get("length", 1.0) * ((0.65 + 0.35 * rng.random()) if stems > 1 else 1)
        segs = tr.get("segments", 12)
        pts = grow_path(base, d, length, segs, rng, droop=tr.get("droop", 0), rise=tr.get("rise", 0), wobble=tr.get("wobble", 0.15), kink=tr.get("kink", 0))
        r0 = tr.get("radius", 0.02 * H) * ((0.6 + 0.4 * rng.random()) if stems > 1 else 1)
        taper = tr.get("taper", 0.9)
        radii = [r0 * max(0.04, 1 - taper * (i / segs) ** tr.get("taper_power", 1.0)) for i in range(segs + 1)]
        axes.append(Axis(pts, radii, 0))
    # the foot: flared, and fluted into buttresses
    flare_k, lobes, flute = tr.get("flare", 0.0), tr.get("lobes", 0), tr.get("flute", 0.0)

    def foot(i, a):
        z = i / max(1, tr.get("segments", 12))
        f = 1 + flare_k * math.exp(-z / 0.06)
        if lobes:
            f *= 1 + flute * max(0, math.cos(lobes * a)) ** 2 * math.exp(-z / 0.1)
        return f

    for ax in axes:
        tube(g, ax.pts, ax.radii, sides, bark, flare=foot if (flare_k or lobes) and len(axes) == 1 else None)

    # branch levels
    parents = axes
    tips = []
    levels = spec.get("levels", [])
    for li, L in enumerate(levels):
        children = []
        last = li == len(levels) - 1
        for par in parents:
            n = L.get("count", 6)
            if lo and last:
                n = max(1, round(n * L.get("lo", 0.6)))
            if par.level > 0:
                n = max(1, round(n * (0.5 + 0.5 * par.length / max(1e-3, L.get("ref", par.length)))))
            start, end = L.get("start", 0.3), L.get("end", 0.95)
            for k in range(n):
                t = start + (end - start) * ((k + 0.5) / n if L.get("even", True) else rng.random())
                t = min(0.999, max(0, t + (rng.random() - 0.5) * (end - start) / n * 0.8))
                at, tan, rad = par.at(t)
                if L.get("plane"):
                    side = perp(tan) * (1 if k % 2 else -1)
                    radial = (side + Vector((0, 0, (rng.random() - 0.5) * 0.4))).normalized()
                else:
                    phi = k * L.get("phyllo", math.degrees(GOLDEN)) * math.pi / 180 + rng.random() * 0.5
                    n1 = perp(tan)
                    n2 = tan.cross(n1)
                    radial = n1 * math.cos(phi) + n2 * math.sin(phi)
                ang = math.radians(L.get("angle", 50) + (rng.random() - 0.5) * L.get("angle_jitter", 16))
                d = (tan * math.cos(ang) + radial * math.sin(ang)).normalized()
                u = (t - start) / max(1e-3, end - start)
                length = L.get("length", 0.3) * par.length * envelope(L.get("shape", "even"), u) * (0.78 + 0.44 * rng.random())
                if par.level == 0 and L.get("absolute"):
                    length = L["absolute"] * H * envelope(L.get("shape", "even"), u) * (0.78 + 0.44 * rng.random())
                segs = L.get("segments", 5)
                pts = grow_path(at, d, length, segs, rng, droop=L.get("droop", 0.1), rise=L.get("rise", 0), wobble=L.get("wobble", 0.2), kink=L.get("kink", 0))
                r0 = min(rad * 0.92, rad * L.get("radius", 0.5))
                radii = [r0 * max(0.06, 1 - 0.9 * (j / segs)) for j in range(segs + 1)]
                ax = Axis(pts, radii, li + 1)
                ax.parent = par
                children.append(ax)
                bs = max(3, round(L.get("sides", 5) * (0.6 if lo else 1)))
                if not (lo and last and L.get("skip_lo", True)) and r0 > H * L.get("min_radius", 0.0012):
                    tube(g, pts, radii, bs, bark)
        parents = children
        tips = children
    if not levels:
        tips = axes
    if lo and not spec.get("lo_leaves"):
        masses(spec, g, rng, tips, axes, H)
    else:
        foliage(spec, g, rng, lo, tips, axes, H)
    return tips


def masses(spec, g, rng, twigs, trunks, H):
    """The far model's crown: instead of every leaf, one lumpy mass round each limb's twigs (the first level with eight
    or more limbs), in the leaves' own colours. A hundred metres off it is the same tree for a tenth of the triangles.
    Fruit and flowers on the tips stay, a few."""
    if not twigs:
        return
    leafy = [fs for fs in spec.get("foliage", []) if fs["type"] in ("leaves", "tuft", "spray", "clump", "compound") and not fs.get("trunk")]
    if not leafy:
        return foliage(spec, g, rng, True, twigs, trunks, H)
    cols = [hexc(c) for fs in leafy for c in fs.get("colors", [])]
    depth = twigs[0].level
    level = next((l for l in range(depth + 1) if sum(1 for t in twigs if anc(t, l) is not None) and len({id(anc(t, l)) for t in twigs}) >= spec.get("masses_min", 8)), depth)
    groups = {}
    for t in twigs:
        groups.setdefault(id(anc(t, level)), []).append(t.at(1)[0])
    pts = [p for ps in groups.values() for p in ps]
    centre = sum(pts, Vector()) / len(pts)
    size = leafy[0].get("size", 0.05) * H
    for ps in groups.values():
        m = sum(ps, Vector()) / len(ps)
        spread = math.sqrt(sum((p - m).length_squared for p in ps) / len(ps))
        r = max(size * 1.1, spread * spec.get("mass_fill", 0.95))
        col = jitter(pick(rng, cols), rng, 0.01, 0.06, 0.1)
        blob(g, m, r, mix(col, (0.02, 0.03, 0.02), 0.15), rng, subdiv=1, lump=0.5, squash=leafy[0].get("mass_squash", 0.8), out_from=centre)
    # a scatter of the real leaves over the masses, so their edges break up like a crown's
    sparse = [{**fs, "share": fs.get("share", 1.0) * spec.get("lo_scatter", 0.45), "core": 0} for fs in leafy]
    foliage({**spec, "foliage": sparse}, g, rng, True, twigs, trunks, H)
    for fs in spec.get("foliage", []):
        if fs["type"] in ("cone", "berries", "truss"):
            foliage({**spec, "foliage": [{**fs, "share": fs.get("share", 1.0) * 0.4}]}, g, rng, True, twigs, trunks, H)


def anc(t, level):
    """The axis `t` grows from at `level` (itself, its parent, ...), or None if it's shallower."""
    while t is not None and t.level > level:
        t = t.parent
    return t if t is not None and t.level == level else None


def foliage(spec, g, rng, lo, twigs, trunks, H):
    """Leaves on the last level's twigs: where, what kind and what colour, from the spec's `foliage` list."""
    if not twigs:
        return
    anchors = [tw.at(1)[0] for tw in twigs]
    centre = sum(anchors, Vector()) / len(anchors)
    centre.z = max(centre.z, H * 0.3)
    for fs in spec.get("foliage", []):
        kind = fs["type"]
        cols = [hexc(c) for c in fs.get("colors", ["#3f6a2e"])]
        tip_cols = [hexc(c) for c in fs.get("tip_colors", [])] or None
        size = fs.get("size", 0.06) * H * (fs.get("lo_size", 1.5) if lo else 1)
        per = fs.get("per", 6)
        if lo:
            per = max(1, round(per * fs.get("lo", 0.35)))
        start, end = fs.get("start", 0.4), fs.get("end", 1.0)
        share = fs.get("share", 1.0)
        on = twigs if not fs.get("trunk") else trunks
        for tw in on:
            if rng.random() > share:
                continue
            col = jitter(pick(rng, cols), rng, 0.015, 0.08, 0.14)
            if fs.get("core"):
                # a dark mass inside the twig's leaves: the crown has a body, not a scatter of cards with sky between
                at, tan, _ = tw.at(fs.get("core_at", 0.75))
                o = (at - centre).normalized() if (at - centre).length > 1e-4 else UP
                blob(g, at + o * size * 0.2, size * fs["core"] * (0.8 + 0.4 * rng.random()), mix(col, (0.02, 0.03, 0.02), fs.get("core_dark", 0.35)), rng,
                     subdiv=1, lump=0.4, squash=fs.get("core_squash", 0.7), out_from=centre)
            for k in range(per):
                t = start + (end - start) * (rng.random() if fs.get("random", True) else (k + 0.5) / per)
                at, tan, rad = tw.at(t)
                out = (at - centre)
                out = (out.normalized() * 0.75 + UP * 0.35).normalized() if out.length > 1e-4 else UP
                if fs.get("trunk"):
                    if at.z < H * fs.get("min_z", 0.15):
                        continue
                    out = (Vector((at.x, at.y, 0)).normalized() if Vector((at.x, at.y)).length > 1e-3 else perp(tan))
                c = jitter(col, rng, 0.006, 0.04, 0.07)
                tc = jitter(pick(rng, tip_cols), rng, 0.01, 0.05, 0.08) if tip_cols else None
                if kind == "leaves":
                    spread = fs.get("spread", 1.6) * size
                    p = at + Vector((rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5)) * spread
                    d = (out * fs.get("outward", 0.6) + tan * 0.4 + Vector((rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5)) * 0.9 + DOWN * fs.get("hang", 0.1)).normalized()
                    s = d.cross(Vector((rng.random() - 0.5, rng.random() - 0.5, 1))).normalized()
                    card(g, p, d, s, size * (0.7 + 0.6 * rng.random()), size * fs.get("width", 0.5), c, out, fold=0.22, tip_col=tc)
                elif kind == "tuft":
                    # a bottlebrush of needles round the twig's last stretch: thin triangles raked forward, over a
                    # dark core so the brush reads dense from any side
                    n = fs.get("needles", 14) if not lo else max(5, fs.get("needles", 14) // 3)
                    fwd = (tan + UP * fs.get("up", 0.35)).normalized()
                    sp = perp(fwd)
                    brush = size * fs.get("brush", 0.5)
                    if not lo:
                        blob(g, at + fwd * brush * 0.4, size * 0.22, mix(c, (0.02, 0.03, 0.02), 0.45), rng, subdiv=1, lump=0.2, squash=1.0, out_from=centre)
                    for j in range(n):
                        a = 2 * math.pi * j / n * 2.618 + rng.random() * 0.5
                        radial = (Matrix.Rotation(a, 3, fwd) @ sp)
                        base = at - fwd * brush * (0.2 + 0.6 * rng.random())
                        nd = (fwd * fs.get("reach", 0.9) + radial * fs.get("splay", 0.7)).normalized()
                        tip = base + nd * size * (0.75 + 0.5 * rng.random())
                        side = radial.cross(nd).normalized() * size * fs.get("needle_width", 0.035) * (2.5 if lo else 1)
                        b0 = g.vert(base, mix(c, (0.05, 0.05, 0.03), 0.3), LEAF, out)
                        g.face(b0, g.vert(tip + side, tc or c, LEAF, out), g.vert(tip - side, tc or c, LEAF, out))
                elif kind == "spray":
                    # a flat frond lying along the twig, drooping, feathered both sides
                    d = (tan + DOWN * fs.get("hang", 0.25)).normalized()
                    side = perp(d)
                    if lo:
                        blade(g, at, d, size * 1.4, size * 0.9, "lance", fs.get("arch", 0.3), 2, [c, tc or c], rng, fold=0.1, side=side, out=out)
                    else:
                        pinnate(g, at, d, size * 1.5, fs.get("pairs", 4), size * 0.55, fs.get("arch", 0.3), [c, tc or c], rng, out=out, flat=side)
                elif kind == "clump":
                    r = size * (0.7 + 0.6 * rng.random())
                    blob(g, at + out * r * 0.3, r, c, rng, subdiv=1 if lo else fs.get("subdiv", 1), lump=fs.get("lump", 0.45), squash=fs.get("squash", 0.75), out_from=centre, jit=0.1)
                elif kind == "compound":
                    d = (out * 0.6 + tan * 0.5 + Vector((rng.random() - 0.5, rng.random() - 0.5, 0.2))).normalized()
                    pinnate(g, at, d, size * 2.2, fs.get("pairs", 6) if not lo else 3, size * 0.7, fs.get("arch", 0.35), [c, tc or c], rng, out=out)
                elif kind == "berries":
                    for _ in range(fs.get("cluster", 4) if not lo else 1):
                        blob(g, at + Vector((rng.random() - 0.5, rng.random() - 0.5, -0.2 - rng.random())) * size * 0.8, size * 0.28 * (0.8 + 0.4 * rng.random()), c, rng, subdiv=1, lump=0.1)
                elif kind == "truss":
                    # a ball of flowers: petals on a sphere facing out
                    r = size
                    for j in range(fs.get("petals", 14) if not lo else 5):
                        z = 1 - 2 * (j + 0.5) / 14
                        rr = math.sqrt(max(0, 1 - z * z))
                        a = j * GOLDEN
                        o = Vector((rr * math.cos(a), rr * math.sin(a), abs(z) * 0.6 + 0.4)).normalized()
                        card(g, at + o * r * 0.4, o, perp(o), r * 0.7, r * 0.6, jitter(c, rng, 0.01, 0.05, 0.1), o, fold=0.3, tip_col=tc)
                elif kind == "cone":
                    # an upright spike of fruit or flower (staghorn sumac's drupes)
                    blob(g, at + UP * size * 0.6, size * 0.38, c, rng, subdiv=1, lump=0.25, squash=2.0)
                elif kind == "drape":
                    # hanging moss: a beard of ragged ribbons falling from the branch, wide at the top, to a point
                    for strand in range(fs.get("strands", 4) if not lo else 1):
                        length = size * (0.5 + 0.9 * rng.random())
                        segs = 3 if lo else 5
                        w = size * fs.get("drape_width", 0.22) * (1.8 if lo else 1)
                        turn_ = rng.random() * math.tau
                        side = Vector((math.cos(turn_), math.sin(turn_), 0)) * w
                        top = at + Vector((rng.random() - 0.5, rng.random() - 0.5, 0)) * w * 2
                        prev = None
                        for j in range(segs + 1):
                            u = j / segs
                            p = top + DOWN * length * u + side.cross(UP).normalized() * w * 0.6 * math.sin(u * 6 + strand)
                            ww = (1 - u) ** 0.8
                            cc = mix(c, tuple(x * 0.55 for x in c), u * 0.5)
                            a_ = g.vert(p + side * ww, cc, LEAF, out)
                            b_ = g.vert(p - side * ww, cc, LEAF, out)
                            if prev:
                                g.face(prev[0], prev[1], b_, a_)
                            prev = (a_, b_)


# --- rosettes --------------------------------------------------------------------------------------------------------
def rosette(spec, g, rng, lo):
    H = spec["height"]
    L = spec.get("leaves", {})
    cols = [hexc(c) for c in L.get("colors", ["#4a7a30"])]
    tips = [hexc(c) for c in L.get("tip_colors", [])] or None
    n = L.get("count", 12)
    if lo:
        n = max(3, round(n * L.get("lo", 0.5)))
    shape = L.get("shape", "lance")
    rise = L.get("rise", [30, 70])
    crown = L.get("crown", 0.02) * H
    for i in range(n):
        az = i * GOLDEN + rng.random() * 0.3
        u = i / max(1, n - 1)
        # outer leaves lie lower and longer, inner ones stand up: a rosette's whorl
        el = math.radians(rise[0] + (rise[1] - rise[0]) * (u if L.get("inner_up", True) else rng.random()) + (rng.random() - 0.5) * 10)
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        length = H * L.get("length", 0.8) * (0.7 + 0.3 * rng.random()) * (1 - 0.3 * u if L.get("inner_up", True) else 1)
        width = length * L.get("width", 0.15)
        base = Vector((math.cos(az) * crown, math.sin(az) * crown, L.get("lift", 0.0) * H))
        c = jitter(pick(rng, cols), rng, 0.012, 0.06, 0.12)
        tc = jitter(pick(rng, tips), rng, 0.01, 0.05, 0.08) if tips else c
        segs = L.get("segments", 5) if not lo else max(2, L.get("segments", 5) // 2)
        arch = L.get("arch", 0.3) * (0.7 + 0.6 * rng.random())
        if shape == "pinnate":
            pinnate(g, base, d, length, L.get("pairs", 14) if not lo else 6, length * L.get("leaflet", 0.16), arch, [c, tc], rng,
                    rachis=None if lo else length * 0.008)
        elif shape == "fan":
            fan(g, base, d, length, width, L, [c, tc], rng, lo)
        elif shape == "tube":
            pitcher(g, base, az, length, width, L, [c, tc], rng, lo)
        else:
            blade(g, base, d, length, width, shape, arch, segs, [c, tc], rng, fold=L.get("fold", 0.2), side=Vector((-math.sin(az), math.cos(az), 0)))
    for s in spec.get("stalks", []):
        stalks(spec, s, g, rng, lo, H)


def fan(g, base, d, length, width, L, cols, rng, lo):
    """A palmetto frond: a stalk rising to a pleated fan held up and open, its tips split and drooping."""
    pet = L.get("petiole", 0.55)
    pts = grow_path(base, d, length * pet, 4, rng, droop=0.05, wobble=0.05)
    tube(g, pts, [width * 0.06 * (1 - 0.5 * j / 4) for j in range(5)], 3, lambda *_: cols[0], cap=False)
    hub, axis = pts[-1], (pts[-1] - pts[-2]).normalized()
    face = (axis * 0.5 + UP * 0.6).normalized()  # the fan's flat side faces up and out
    side = perp(axis)
    up_ = side.cross(axis).normalized()
    if up_.dot(UP) < 0:
        up_ = -up_
    seg = L.get("segments_fan", 16) if not lo else 7
    spread = math.radians(L.get("spread", 220))
    r = length * (1 - pet) * 1.1
    centre = g.vert(hub, cols[0], LEAF, face)
    prev = None
    for j in range(seg + 1):
        a = -spread / 2 + spread * j / seg
        ray = (axis * math.cos(a) + side * math.sin(a)).normalized()
        pleat = up_ * (r * 0.05 * (1 if j % 2 else -1))
        mid = hub + ray * r * 0.55 + pleat + DOWN * r * 0.04
        tip = hub + ray * r + DOWN * r * (0.18 + 0.2 * abs(math.sin(a))) + pleat * 0.5
        c = mix(cols[0], cols[1], 0.4 + 0.6 * rng.random())
        m_ = g.vert(mid, c, LEAF, face)
        t_ = g.vert(tip, mix(c, cols[1], 0.5), LEAF, face)
        if prev:
            g.face(centre, prev[0], m_)
            g.face(prev[0], prev[1], t_, m_)
        prev = (m_, t_)


def pitcher(g, base, az, length, width, L, cols, rng, lo):
    """A pitcher plant's leaf: a curved tube widening to an open mouth, a hood over it, green going to veined red."""
    from mathutils import noise
    d = Vector((math.cos(az) * 0.35, math.sin(az) * 0.35, 1)).normalized()
    pts = grow_path(base, d, length, 5 if not lo else 3, rng, rise=0.25, wobble=0.04)
    radii = [width * (0.25 + 0.75 * (j / (len(pts) - 1)) ** 1.3) for j in range(len(pts))]
    vein = cols[1]
    seed = Vector((rng.random() * 9, rng.random() * 9, 0))

    def paint(u, a, at, off):
        v = abs(noise.noise(Vector((math.cos(a) * 4, math.sin(a) * 4, at.z * 30)) + seed))
        return mix(cols[0], vein, min(1, u * 1.4) * (1.0 if v < 0.18 else 0.55))

    tube(g, pts, radii, 7 if not lo else 5, paint, cap=False)
    top, tan = pts[-1], (pts[-1] - pts[-2]).normalized()
    out = Vector((math.cos(az), math.sin(az), 0))
    blade(g, top - out * radii[-1] * 0.6, (UP * 0.6 - out * 0.8).normalized(), radii[-1] * 2.4, radii[-1] * 2.2, "oval", 0.5, 3, [vein, vein], rng, fold=0.35, side=Vector((-out.y, out.x, 0)))


def stalks(spec, s, g, rng, lo, H):
    """Flower or seed stalks rising from the crown, each with its head."""
    cols = [hexc(c) for c in s.get("colors", ["#4a6a30"])]
    head = s.get("head", "cone")
    hc = [hexc(c) for c in s.get("head_colors", ["#6a3a20"])]
    pc = [hexc(c) for c in s.get("petal_colors", ["#c070a0"])]
    n = s.get("count", 3)
    if lo:
        n = max(1, round(n * 0.5))
    for i in range(n):
        az = i * GOLDEN * 1.7 + rng.random()
        spread = s.get("spread", 0.15)
        d = Vector((math.cos(az) * spread * rng.random(), math.sin(az) * spread * rng.random(), 1)).normalized()
        h = H * s.get("height", 1.0) * (0.75 + 0.25 * rng.random())
        segs = 6 if not lo else 3
        pts = grow_path(Vector((0, 0, 0)), d, h, segs, rng, droop=s.get("droop", 0.0), wobble=s.get("wobble", 0.06))
        r = H * s.get("radius", 0.006)
        tube(g, pts, [r * (1 - 0.5 * j / segs) for j in range(segs + 1)], 4 if not lo else 3, lambda *_: cols[0], cap=False)
        top, tan = pts[-1], (pts[-1] - pts[-2]).normalized()
        hs = H * s.get("head_size", 0.04)
        c = jitter(pick(rng, hc), rng, 0.01, 0.05, 0.1)
        if head == "cone":
            blob(g, top + tan * hs * 0.3, hs * 0.55, c, rng, subdiv=1 if lo else 2, lump=0.2, squash=0.9, tag=LEAF, out_from=top - tan)
            petals = s.get("petals", 12) if not lo else 6
            for j in range(petals):
                a = 2 * math.pi * j / petals + rng.random() * 0.2
                o = Vector((math.cos(a), math.sin(a), -s.get("reflex", 0.6))).normalized()
                card(g, top + o * hs * 0.35, o, Vector((-math.sin(a), math.cos(a), 0)), hs * s.get("petal_length", 1.7), hs * 0.45,
                     jitter(pick(rng, pc), rng, 0.01, 0.05, 0.1), UP, fold=0.1)
        elif head == "cattail":
            spike = [top - tan * hs * 3.2, top - tan * hs * 0.3]
            tube(g, [spike[0].lerp(spike[1], j / 4) for j in range(5)], [hs * (0.25 if j in (0, 4) else 0.38) for j in range(5)], 7 if not lo else 4, lambda *_: c, cap=False)
            tube(g, [top - tan * hs * 0.3, top + tan * hs * 1.4], [r * 0.6, r * 0.3], 3, lambda *_: mix(c, (0.5, 0.45, 0.3), 0.4))
        elif head == "spathe":
            # a yellow hood wrapped round a green club
            tube(g, [top - tan * hs * 0.2, top + tan * hs * 1.1], [hs * 0.16, hs * 0.1], 5, lambda *_: hexc("#6a8a30"))
            blade(g, top - tan * hs * 0.6, (tan + Vector((0.2, 0, 0))).normalized(), hs * 3, hs * 1.6, "oval", -0.15, 4, [c, mix(c, (1, 1, 0.7), 0.3)], rng, fold=0.9, side=Vector((0, 1, 0)))
        elif head == "plume":
            for j in range(s.get("fingers", 3)):
                a = 2 * math.pi * j / s.get("fingers", 3) + rng.random()
                fd = (tan + Vector((math.cos(a), math.sin(a), 0)) * 0.35).normalized()
                blade(g, top, fd, hs * 2.4, hs * 0.18, "grass", 0.15, 3 if not lo else 1, [c, jitter(c, rng)], rng, fold=0.0)
        elif head == "cup":
            # a nodding flower: the stalk's tip turns down to a red umbrella with petals hanging
            o = (DOWN * 0.8 + tan * 0.2).normalized()
            blob(g, top + o * hs * 0.4, hs * 0.5, c, rng, subdiv=1, lump=0.1, squash=0.5)
            for j in range(5):
                a = 2 * math.pi * j / 5
                pd = (DOWN + Vector((math.cos(a), math.sin(a), 0)) * 0.6).normalized()
                card(g, top + o * hs * 0.5, pd, Vector((-math.sin(a), math.cos(a), 0)), hs * 1.4, hs * 0.7, jitter(pick(rng, pc), rng), pd, fold=0.2)


# --- cacti and knees -------------------------------------------------------------------------------------------------
def lathe(g, profile, sides, colour, ribs=0, rib_depth=0.0, at=Vector(), lean=None):
    """A solid of revolution from (radius, z) pairs bottom to top, optionally ribbed like a barrel cactus."""
    rings = []
    rot = UP.rotation_difference(lean) if lean is not None else None
    for i, (r, z) in enumerate(profile):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            rr = r * (1 + rib_depth * (math.cos(ribs * a) if ribs else 0))
            p = Vector((math.cos(a) * rr, math.sin(a) * rr, z))
            if rot is not None:
                p = rot @ p
            crest = ribs and math.cos(ribs * a) > 0.85
            ring.append(g.vert(at + p, colour(i / (len(profile) - 1), a, p, crest)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            g.face(rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k])
    top = profile[-1]
    tip = Vector((0, 0, top[1] + 0.02 * profile[0][0]))
    if rot is not None:
        tip = rot @ tip
    t = g.vert(at + tip, colour(1, 0, tip, False))
    for k in range(sides):
        g.face(rings[-1][k], rings[-1][(k + 1) % sides], t)


def cactus(spec, g, rng, lo):
    from mathutils import noise
    H = spec["height"]
    C = spec.get("cactus", {})
    body = [hexc(c) for c in C.get("colors", ["#4a7a4a", "#3a6040"])]
    spine = hexc(C.get("spine", "#e0c890"))
    fruit = [hexc(c) for c in C.get("fruit", ["#c0305a"])]
    seed = Vector((rng.random() * 9, rng.random() * 9, rng.random() * 9))
    if C.get("form") == "barrel":
        R = H * C.get("girth", 0.42)
        prof = []
        rings = 14 if not lo else 7
        for i in range(rings + 1):
            u = i / rings
            prof.append((R * max(0.06, math.sin(math.pi * (0.1 + 0.85 * u)) ** 0.55) * (1 - 0.12 * u), H * u))

        def paint(u, a, p, crest):
            c = mix(body[0], body[-1], 0.5 + 0.5 * noise.noise(p * 3 + seed))
            if crest:
                c = mix(c, spine, 0.75)
            return mix(tuple(x * 0.6 for x in c), c, min(1, u * 5))

        lathe(g, prof, C.get("ribs", 18) * (2 if not lo else 1), paint, ribs=C.get("ribs", 18), rib_depth=0.09)
        for j in range(C.get("fruits", 8) if not lo else 3):
            a = 2 * math.pi * j / C.get("fruits", 8)
            blob(g, Vector((math.cos(a) * R * 0.3, math.sin(a) * R * 0.3, H * 0.97)), R * 0.11, jitter(pick(rng, fruit), rng), rng, subdiv=1, lump=0.1, squash=1.3, tag=WOOD)
        return
    # pads: each pad a flattened, slightly lumpy egg; up to `depth` pads stand on a pad's rim
    pad_h = H * C.get("pad", 0.32)

    def pad(at, d, size, depth):
        w, t = size * 0.72, size * 0.16
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12 if not lo else 7, v_segments=8 if not lo else 5, radius=1)
        face = d.cross(UP) if d.cross(UP).length > 1e-3 else Vector((1, 0, 0))
        face = (Matrix.Rotation(rng.random() * 2 - 1, 3, d) @ face.normalized())
        side = d.cross(face).normalized()
        ids = {}
        for v in bm.verts:
            x, y, z = v.co
            k = 1 + 0.06 * noise.noise(v.co * 2 + seed)
            p = at + d * (size / 2) * (1 + z * k) + side * (x * w / 2 * k) + face * (y * t / 2)
            c = mix(body[0], body[-1], 0.5 + 0.5 * noise.noise(p * 5 + seed))
            if noise.noise(p * 40 + seed) > 0.5:
                c = mix(c, spine, 0.85)
            ids[v.index] = g.vert(p, c)
        for f in bm.faces:
            g.face(*[ids[v.index] for v in f.verts])
        bm.free()
        tip = at + d * size
        if depth <= 0:
            for j in range(C.get("fruit_per_pad", 3) if not lo else 1):
                a = (j - 1) * 0.5
                p = at + d * size * (0.95 - abs(a) * 0.2) + side * (w / 2) * a * 1.4
                blob(g, p, size * 0.07, jitter(pick(rng, fruit), rng), rng, subdiv=1, lump=0.1, squash=1.4, tag=WOOD)
            return
        for j in range(rng.choice(C.get("branching", [1, 2, 2, 3]))):
            a = (j - 0.5) * 0.9 + (rng.random() - 0.5) * 0.4
            nd = (d * 0.8 + side * math.sin(a) * 0.8).normalized()
            pad(at + d * size * 0.88 + side * (w / 2) * math.sin(a) * 0.7, nd, size * (0.82 + 0.15 * rng.random()), depth - 1)

    for s in range(C.get("stems", 3)):
        az = s * GOLDEN * 2 + rng.random()
        d = (UP + Vector((math.cos(az), math.sin(az), 0)) * 0.4).normalized()
        pad(Vector((math.cos(az) * pad_h * 0.15, math.sin(az) * pad_h * 0.15, 0)), d, pad_h, C.get("depth", 3))


def knees(spec, g, rng, lo):
    from mathutils import noise
    H = spec["height"]
    K = spec.get("knees", {})
    cols = [hexc(c) for c in K.get("colors", ["#6a5040", "#3a2c22"])]
    seed = Vector((rng.random() * 9, rng.random() * 9, 0))
    for i in range(K.get("count", 9)):
        a, d = rng.random() * math.pi * 2, math.sqrt(rng.random()) * H * K.get("spread", 1.6)
        h = H * (0.35 + 0.65 * rng.random())
        r = h * K.get("girth", 0.28)
        prof = [(r * (1 - u) ** 0.6 * (1 + 0.25 * (1 - u) ** 6) + r * 0.08, h * u) for u in [j / (8 if not lo else 4) for j in range(9 if not lo else 5)]]

        def paint(u, ang, p, crest, h=h):
            c = mix(cols[0], cols[-1], 0.5 + 0.5 * noise.noise(Vector((p.x * 4, p.y * 4, p.z * 1.2)) + seed))
            return mix(tuple(x * 0.5 for x in c), c, min(1, u * 3 + 0.2))

        lean = (UP + Vector((rng.random() - 0.5, rng.random() - 0.5, 0)) * 0.35).normalized()
        lathe(g, prof, 8 if not lo else 5, paint, at=Vector((math.cos(a) * d, math.sin(a) * d, -0.02 * H)), lean=lean)


GENERATORS = {"tree": tree, "rosette": rosette, "cactus": cactus, "knees": knees}


# --- normals, occlusion, mesh --------------------------------------------------------------------------------------
def shade(g, spec):
    """Vertex normals (wood from its faces, leaves out of the crown) and baked occlusion into the colours."""
    n = len(g.v)
    acc = [Vector() for _ in range(n)]
    for f in g.f:
        if len(f) < 3:
            continue
        a, b, c = g.v[f[0]], g.v[f[1]], g.v[f[2]]
        fn = (b - a).cross(c - a)
        if len(f) == 4:
            fn += (c - a).cross(g.v[f[3]] - a)
        for i in f:
            acc[i] += fn
    norms = []
    for i in range(n):
        nn = acc[i].normalized() if acc[i].length > 1e-12 else UP.copy()
        if g.tag[i] == LEAF and g.out[i] is not None:
            o = Vector(g.out[i]).normalized()
            if nn.dot(o) < 0:
                nn = -nn
            nn = (nn * 0.3 + o * 0.7).normalized()
        norms.append(nn)
    tree = BVHTree.FromPolygons(g.v, g.f, all_triangles=False)
    H = spec["height"]
    reach = spec.get("ao_reach", 0.3) * H
    rays = 14
    local = []
    for i in range(rays):
        z = math.sqrt((i + 0.5) / rays)
        r = math.sqrt(1 - z * z)
        local.append(Vector((r * math.cos(i * GOLDEN), r * math.sin(i * GOLDEN), z)))
    lo_ao = spec.get("ao_min", 0.42)
    sun = spec.get("sun", 0.25)
    out = []
    for i in range(n):
        nn = norms[i]
        frame = nn.to_track_quat("Z", "Y")
        origin = g.v[i] + nn * (H * 0.004)
        hit = 0.0
        for d in local:
            _, _, _, t = tree.ray_cast(origin, frame @ d, reach)
            if t is not None:
                hit += 1 - t / reach
        ao = 1 - hit / rays
        k = lo_ao + (1 - lo_ao) * ao
        if g.tag[i] == LEAF:
            k *= 1 - sun / 2 + sun * min(1, max(0, g.v[i].z / H))
        out.append(tuple(min(1, x * k) for x in g.c[i]))
    return norms, out


def to_object(g, name, spec):
    norms, cols = shade(g, spec)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in g.v], [], g.f)
    me.update()
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    flat = []
    for c in cols:
        flat.extend((c[0], c[1], c[2], 1.0))
    attr.data.foreach_set("color", flat)
    me.color_attributes.active_color = attr
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices([tuple(nv) for nv in norms])
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(vertex_material())
    return o


def vertex_material():
    m = bpy.data.materials.get("flora")
    if m:
        return m
    m = bpy.data.materials.new("flora")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    return m


def grow(spec, seed, lo):
    g = Geo()
    GENERATORS[spec["generator"]](spec, g, random.Random(seed), lo)
    return g


def build(spec, seed, name):
    hi = grow(spec, seed, False)
    lo = grow(spec, seed, True)
    budget = spec.get("budget", [3000, 800])
    for label, g, cap in (("near", hi, budget[0]), ("far", lo, budget[1])):
        warn = "  OVER BUDGET" if g.tris() > cap else ""
        print(f"{name} {label}: {g.tris()} triangles (budget {cap}){warn}")
    return to_object(hi, name, spec), to_object(lo, name + "-lo", spec)


# --- output ----------------------------------------------------------------------------------------------------------
def write_glb(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_normals=True, export_materials="NONE", export_vertex_color="ACTIVE", export_texcoords=False,
                              export_active_vertex_color_when_no_material=True, export_meshopt_compression_enable=True)
    print(f"-> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")


def stage(width, height, path, objs, cam_h=None):
    """Renders `objs` (already placed) on a ground with a 1.8 m post for scale: a contact sheet."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.62, 0.78, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
    scene.world = world
    bpy.context.view_layer.update()
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(48), math.radians(-12), math.radians(-35))
    scene.collection.objects.link(sun)
    xs = [(o.matrix_world @ Vector(c)) for o in objs for c in o.bound_box]
    x0, x1 = min(p.x for p in xs), max(p.x for p in xs)
    top = max(p.z for p in xs)
    post = bpy.data.objects.new("post", bpy.data.meshes.new("post"))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=0.05, radius2=0.05, depth=1.8, segments=8)
    bm.to_mesh(post.data)
    bm.free()
    post.location = (x0 - 0.8, 0, 0.9)
    scene.collection.objects.link(post)
    ground = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=max(60, (x1 - x0) * 3))
    bm.to_mesh(ground.data)
    bm.free()
    gm = bpy.data.materials.new("ground")
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.14, 0.1, 1)
    ground.data.materials.append(gm)
    scene.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    scene.collection.objects.link(cam)
    scene.camera = cam
    span = max(x1 - x0 + 1.6, top * width / height)
    d = span * 1.5
    cx = (x0 - 0.8 + x1) / 2
    cam.location = (cx, -d, (cam_h if cam_h is not None else top * 0.45) + d * 0.12)
    cam.rotation_euler = (Vector((cx, 0, top * 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"render -> {os.path.relpath(path)}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit(__doc__)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if argv[0] == "--lineup":
        # every plant of a set side by side at its own height: what a biome looks like together
        name, paths = argv[1], argv[2:]
        x, objs = 0.0, []
        for p in paths:
            with open(p) as f:
                spec = json.load(f)
            hi = to_object(grow(spec, spec.get("seed", 1), False), spec["id"], spec)
            w = max(hi.dimensions.x, hi.dimensions.y)
            hi.location = (x + w / 2, 0, 0)
            x += w + 0.6
            objs.append(hi)
        stage(2400, 900, os.path.join(HERE, "out", "flora", f"lineup-{name}.png"), objs)
        return
    with open(argv[0]) as f:
        spec = json.load(f)
    seed = spec.get("seed", 1)
    if "--seed" in argv:
        seed = int(argv[argv.index("--seed") + 1])
    variants = int(argv[argv.index("--variants") + 1]) if "--variants" in argv else 0
    if variants:
        # the same spec from `variants` seeds in a row, to pick the best seed by eye; writes no GLB
        objs, x = [], 0.0
        for k in range(variants):
            o = to_object(grow(spec, seed + k, False), f"{spec['id']}.{seed + k}", spec)
            w = max(o.dimensions.x, o.dimensions.y)
            o.location = (x + w / 2, 0, 0)
            x += w + 0.5
            objs.append(o)
        stage(2400, 900, os.path.join(HERE, "out", "flora", f"{spec['id']}.variants.png"), objs)
        return
    hi, lo = build(spec, seed, spec["id"])
    lo_ = lo.dimensions
    print(f"{spec['id']}: {hi.dimensions.x:.1f} x {hi.dimensions.y:.1f} m, {hi.dimensions.z:.1f} m tall")
    write_glb([hi, lo], os.path.join(APP, "public", "models", "flora", spec["id"] + ".glb"))
    if "--render" in argv:
        # near model from the front and the three-quarter, then the far one beside it
        w = max(hi.dimensions.x, hi.dimensions.y, 0.5)
        b = hi.copy()
        bpy.context.collection.objects.link(b)
        b.rotation_euler = (0, 0, math.radians(-70))
        hi.location = (0, 0, 0)
        b.location = (w * 1.15, 0, 0)
        lo.location = (w * 2.3, 0, 0)
        stage(1800, 800, os.path.join(HERE, "out", "flora", spec["id"] + ".png"), [hi, b, lo])


main()
