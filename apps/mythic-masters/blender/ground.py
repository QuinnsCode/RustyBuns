# A tileable ground layer, headless: `blender -b --factory-startup -P blender/ground.py -- <layer> [--out dir] [--res 512] [--samples 24]`
# or `-- --sheet` for the contact sheet. Each layer is a 2 x 2 m patch of real geometry (a heightfield for the soil, then
# scattered needles, leaves, grass blades, pebbles) built three periods wide so the centre period sees its neighbours
# (ambient occlusion and overlaps wrap), rendered top-down in Cycles under an even sky: what comes out is albedo with
# real contact shadow. Out (public/ground-tex/): <layer>.jpg, a DETAIL map (albedo over its own mean, halved: 0.5 is
# "the tint the vertex gives it", so the biome's palette stays in the vertex colours and the texture only adds grain), and
# <layer>.n.jpg, a normal map (RG: how the surface leans along the image's right and down; B: the layer's FEATURE, the
# dirt's and the mud's cracks, the sand's ripples, 0 elsewhere, which the game fades out where a biome's ground has none).
#
# A new layer is one function in LAYERS: it returns (height field in metres on a GxG torus, colour of it, [instances]).
# An instance is (prototype, x, y, z, yaw, scale, rgb). A fourth value, the feature mask on the same grid, is optional.
# Add its name to LAYERS and `bun run ground <name>`.
import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = 192          # heightfield samples per 2 m period
PERIOD = 2.0
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = lambda n, d: args[args.index(n) + 1] if n in args else d
OUT = opt("--out", os.path.join(ROOT, "public", "ground-tex"))
RES = int(opt("--res", 512))
SAMPLES = int(opt("--samples", 24))
NRES = int(opt("--nres", 256))     # the normal map's size
names = [a for a in args if not a.startswith("--") and a not in (OUT, str(RES), str(SAMPLES), str(NRES))]


# --- tileable noise ----------------------------------------------------------------------------------------------
def rng(seed): return np.random.default_rng(seed)

def fbm(seed, slope=1.8, lo=1, hi=None, n=G):
    """Periodic noise, mean 0 and spread 1: random phases with a 1/f^slope amplitude, between lo and hi cycles a period."""
    r = rng(seed)
    f = np.fft.fftfreq(n, 1.0 / n)
    fx, fy = np.meshgrid(f, f)
    k = np.hypot(fx, fy)
    amp = np.where((k >= lo) & (k <= (hi or n / 2)), 1.0 / np.maximum(k, 1.0) ** slope, 0.0)
    a = np.fft.ifft2(amp * np.exp(2j * np.pi * r.random((n, n)))).real
    return (a - a.mean()) / (a.std() + 1e-9)

def voronoi(seed, cells, n=G, warp=0.0):
    """F1, F2 (in periods) and the id of the nearest of `cells` jittered points on the torus."""
    r = rng(seed)
    side = int(math.ceil(math.sqrt(cells)))
    gx, gy = np.meshgrid(np.arange(side), np.arange(side))
    pts = np.stack([(gx + r.random((side, side)) * 0.9 + 0.05) / side, (gy + r.random((side, side)) * 0.9 + 0.05) / side], -1).reshape(-1, 2)
    u = (np.arange(n) + 0.5) / n
    X, Y = np.meshgrid(u, u)
    if warp:  # bend the cells so their edges meander (periodic, so it still tiles)
        X = X + warp * fbm(seed + 900, 1.6, 1, 8, n) * 0.1; Y = Y + warp * fbm(seed + 901, 1.6, 1, 8, n) * 0.1
        X %= 1.0; Y %= 1.0
    d = np.full((len(pts), n, n), 9.0)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(X - px); dx = np.minimum(dx, 1 - dx)
        dy = np.abs(Y - py); dy = np.minimum(dy, 1 - dy)
        d[i] = np.hypot(dx, dy)
    order = np.argsort(d, axis=0)
    f1 = np.take_along_axis(d, order[:1], 0)[0]; f2 = np.take_along_axis(d, order[1:2], 0)[0]
    return f1, f2, order[0]

def smooth(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def mix(a, b, t): return a + (b - a) * t[..., None]
def rgb(*c): return np.array(c, dtype=float)
def unit(x): return (x - x.min()) / (x.max() - x.min() + 1e-9)
def cellval(ids, seed): return rng(seed).random(ids.max() + 1)[ids]
def spread(a, k=2):
    """a, widened by k samples each way (periodic): a feature mask that also covers the slopes beside a crack."""
    for _ in range(k): a = np.maximum.reduce([a, np.roll(a, 1, 0), np.roll(a, -1, 0), np.roll(a, 1, 1), np.roll(a, -1, 1)])
    return a
def resize(a, n):
    """a square periodic field, bilinearly resampled to n x n."""
    m = a.shape[0]
    u = (np.arange(n) + 0.5) * m / n - 0.5
    i0 = np.floor(u).astype(int); t = u - i0; i0 %= m; i1 = (i0 + 1) % m
    rows = a[i0] * (1 - t)[:, None] + a[i1] * t[:, None]
    return rows[:, i0] * (1 - t)[None] + rows[:, i1] * t[None]


# --- scattered things ------------------------------------------------------------------------------------------
def strip(length, width, bend, segs=4):
    """A flat blade: `segs` quads along x, tapering to a point, curling up by `bend` metres at the tip."""
    t = np.linspace(0, 1, segs + 1)
    v, f = [], []
    for i, s in enumerate(t):
        w = width * (1 - s) * 0.5 if i < segs else 0
        v += [(s * length, -w, bend * s * s), (s * length, w, bend * s * s)] if i < segs else [(length, 0, bend)]
    for i in range(segs - 1): a = 2 * i; f += [(a, a + 1, a + 2), (a + 1, a + 3, a + 2)]
    a = 2 * (segs - 1); f += [(a, a + 1, 2 * segs)]
    return np.array(v), np.array(f)

def disc(sides, rx, ry, cup, jitter=0.0, seed=0):
    r = rng(seed)
    v = [(0, 0, -cup * 0.4)]
    for i in range(sides):
        a = 2 * math.pi * i / sides
        k = 1 + (r.random() - 0.5) * jitter
        v.append((math.cos(a) * rx * k, math.sin(a) * ry * k, cup * (0.4 + 0.6 * abs(math.cos(a)))))
    f = [(0, 1 + i, 1 + (i + 1) % sides) for i in range(sides)]
    return np.array(v), np.array(f)

def leaf(length, width, cup):
    """A pointed leaf: base at the origin, tip at +x."""
    t = np.linspace(0, 1, 6)
    v, f = [], []
    for s in t:
        w = width * 0.5 * math.sin(math.pi * min(1, s * 0.92 + 0.04)) ** 0.8
        v += [(s * length, -w, cup * (w / (width / 2 + 1e-9))), (s * length, w, cup * (w / (width / 2 + 1e-9)))]
    for i in range(5): a = 2 * i; f += [(a, a + 1, a + 2), (a + 1, a + 3, a + 2)]
    return np.array(v), np.array(f)

def pebble(seed, sides=7, rings=5):
    r = rng(seed)
    v = []
    for j in range(rings + 1):
        phi = math.pi * j / rings
        for i in range(sides if 0 < j < rings else 1):
            th = 2 * math.pi * i / sides
            k = 1 + (r.random() - 0.5) * 0.35
            v.append((math.sin(phi) * math.cos(th) * k, math.sin(phi) * math.sin(th) * k, math.cos(phi) * 0.55 * k))
    f = []
    ring = lambda j: (0, 1) if j == 0 else (1 + sides * (j - 1), sides) if j < rings else (len(v) - 1, 1)
    for i in range(sides): f.append((0, 1 + i, 1 + (i + 1) % sides))
    for j in range(1, rings - 1):
        a = 1 + sides * (j - 1); b = a + sides
        for i in range(sides):
            f += [(a + i, b + i, a + (i + 1) % sides), (a + (i + 1) % sides, b + i, b + (i + 1) % sides)]
    last = len(v) - 1; a = 1 + sides * (rings - 2)
    for i in range(sides): f.append((a + i, last, a + (i + 1) % sides))
    return np.array(v), np.array(f)


def scatter(seed, protos, n, size, zlift, colours, pull=None, tilt=0.0):
    """n instances of protos at random places and yaws, `size` (lo, hi) times each prototype, in colours (a function of rng), as a list."""
    r = rng(seed)
    out = []
    for _ in range(n):
        x, y = (r.random(2) - 0.5) * PERIOD
        s = size[0] + r.random() * (size[1] - size[0])
        out.append((protos[r.integers(len(protos))], x, y, zlift(r), r.random() * 2 * math.pi, s, colours(r), tilt * (r.random() - 0.5)))
    return out


def sample(h, x, y):
    n = h.shape[0]
    return h[int(((y / PERIOD + 0.5) % 1) * n) % n, int(((x / PERIOD + 0.5) % 1) * n) % n]


# --- the layers ------------------------------------------------------------------------------------------------
def soil(seed, base, lo=0.7, hi=1.1, relief=0.01):
    n = fbm(seed, 1.7, 1, 40)
    return relief * n, mix(base * lo, base * hi, smooth(-1.5, 1.5, n))

def duff(seed, base, relief=0.012):
    h, c = soil(seed, base, 0.55, 1.0, relief)
    return h, c

def needles():
    h, c = duff(1, rgb(0.20, 0.12, 0.07))
    pr = [strip(0.09, 0.0042, 0.012, 3), strip(0.075, 0.0042, 0.008, 3), strip(0.11, 0.0045, 0.014, 3)]
    def col(r):
        t = r.random()
        base = rgb(0.52, 0.31, 0.14) * (0.6 + 0.6 * r.random()) if t < 0.72 else rgb(0.62, 0.50, 0.24) * (0.6 + 0.5 * r.random()) if t < 0.9 else rgb(0.30, 0.34, 0.12) * (0.6 + 0.5 * r.random())
        return base
    items = scatter(11, pr, 15000, (0.8, 1.2), lambda r: 0.003 + 0.035 * r.random() ** 1.6, col, tilt=0.5)
    # fascicle pairs: a second needle lying a few degrees off the first
    items += scatter(12, pr, 3000, (0.8, 1.2), lambda r: 0.012 + 0.03 * r.random(), col)
    items += scatter(13, [strip(0.28, 0.011, 0.01, 4), strip(0.18, 0.008, 0.006, 4)], 18, (0.8, 1.3), lambda r: 0.01 + 0.012 * r.random(), lambda r: rgb(0.20, 0.13, 0.08) * (0.7 + 0.5 * r.random()))
    items += scatter(14, [pebble(3), pebble(4)], 14, (0.012, 0.03), lambda r: 0.004, lambda r: rgb(0.55, 0.5, 0.42) * (0.7 + 0.4 * r.random()))
    return h, c, items

def leaves():
    h, c = duff(2, rgb(0.17, 0.11, 0.065))
    pr = [leaf(0.075, 0.034, 0.006), leaf(0.06, 0.03, 0.008), leaf(0.09, 0.04, 0.005), disc(9, 0.03, 0.022, 0.006, 0.3, 3)]
    pal = [rgb(0.42, 0.24, 0.09), rgb(0.50, 0.34, 0.12), rgb(0.33, 0.20, 0.08), rgb(0.46, 0.17, 0.07), rgb(0.40, 0.38, 0.13), rgb(0.26, 0.17, 0.08), rgb(0.57, 0.45, 0.18)]
    col = lambda r: pal[r.integers(len(pal))] * (0.65 + 0.6 * r.random())
    items = scatter(21, pr, 3800, (0.8, 1.3), lambda r: 0.003 + 0.04 * r.random() ** 1.3, col, tilt=0.5)
    items += scatter(22, [strip(0.22, 0.012, 0.008, 4)], 22, (0.7, 1.3), lambda r: 0.012 + 0.012 * r.random(), lambda r: rgb(0.2, 0.13, 0.08) * (0.7 + 0.5 * r.random()))
    items += scatter(23, [pebble(5), pebble(6)], 10, (0.012, 0.03), lambda r: 0.004, lambda r: rgb(0.5, 0.46, 0.4) * (0.7 + 0.4 * r.random()))
    return h, c, items

def turf():
    h, c = soil(3, rgb(0.16, 0.11, 0.07), 0.6, 1.2, 0.01)
    pr = [strip(0.12, 0.0052, 0.05, 4), strip(0.09, 0.0048, 0.035, 4), strip(0.15, 0.0058, 0.07, 4)]
    def col(r):
        t = r.random()
        g = rgb(0.17, 0.36, 0.07) if t < 0.55 else rgb(0.26, 0.42, 0.09) if t < 0.85 else rgb(0.46, 0.43, 0.14)
        return g * (0.6 + 0.7 * r.random())
    items = scatter(31, pr, 17000, (0.7, 1.2), lambda r: 0.002 + 0.01 * r.random(), col, tilt=1.2)
    # blades lean, so give them pitch: handled by `tilt` rolling each about its length axis; clover leaflets and dry litter on top
    items += scatter(32, [disc(7, 0.014, 0.012, 0.004, 0.25, 8)], 260, (0.7, 1.3), lambda r: 0.01 + 0.012 * r.random(), lambda r: rgb(0.12, 0.36, 0.08) * (0.7 + 0.5 * r.random()))
    items += scatter(33, [strip(0.06, 0.004, 0.003, 3)], 380, (0.7, 1.4), lambda r: 0.012 + 0.008 * r.random(), lambda r: rgb(0.55, 0.46, 0.22) * (0.7 + 0.5 * r.random()))
    return h, c, items

def dirt():
    f1, f2, ids = voronoi(41, 30, warp=0.55)
    edge = f2 - f1
    n1 = fbm(42, 1.6, 1, 60); n2 = fbm(43, 1.0, 20, 90)
    patch = smooth(0.2, 1.1, fbm(46, 1.8, 1, 5))      # the cracks only show where the ground has dried
    crack = (1 - smooth(0.0, 0.016, edge)) * patch
    dome = smooth(0.0, 0.06, edge) * patch
    h = 0.008 * n1 + 0.012 * dome * (0.6 + 0.4 * cellval(ids, 5)) - 0.03 * crack
    base = rgb(0.43, 0.32, 0.21)
    c = mix(base * 0.8, base * 1.15, smooth(-1.2, 1.4, n1 + 0.5 * n2))
    c = c * (0.9 + 0.2 * cellval(ids, 6))[..., None]
    c = mix(c, rgb(0.14, 0.10, 0.07), crack * 0.9)
    c = mix(c, rgb(0.62, 0.52, 0.38), smooth(1.0, 2.2, n2) * 0.45)
    items = scatter(44, [pebble(7), pebble(8), pebble(9)], 150, (0.008, 0.026), lambda r: 0.002, lambda r: rgb(0.46, 0.40, 0.32) * (0.6 + 0.7 * r.random()))
    items += scatter(45, [strip(0.06, 0.004, 0.004, 3)], 120, (0.6, 1.4), lambda r: 0.004 + 0.004 * r.random(), lambda r: rgb(0.45, 0.35, 0.17) * (0.6 + 0.6 * r.random()))
    return h, c, items, spread(crack)

def mud():
    f1, f2, ids = voronoi(51, 16, warp=0.6)
    edge = f2 - f1
    crack = 1 - smooth(0.0, 0.03, edge)
    rim = smooth(0.0, 0.04, edge) * (1 - smooth(0.04, 0.12, edge))
    n1 = fbm(52, 1.5, 1, 50); n2 = fbm(53, 1.2, 3, 12)
    h = 0.01 * n1 + 0.022 * smooth(0, 0.18, edge) + 0.01 * rim - 0.03 * crack
    base = rgb(0.22, 0.15, 0.09)
    c = mix(base * 0.75, base * 1.25, smooth(-1.4, 1.4, n1))
    c = c * (0.85 + 0.3 * cellval(ids, 7))[..., None]
    c = mix(c, rgb(0.07, 0.05, 0.035), crack * 0.95)
    wet = smooth(0.4, 1.4, n2)
    c = mix(c, rgb(0.10, 0.08, 0.06), wet * 0.6)
    c = mix(c, rgb(0.42, 0.33, 0.22), rim * 0.4 * (1 - wet))
    items = scatter(54, [pebble(10), pebble(11)], 40, (0.008, 0.02), lambda r: 0.003, lambda r: rgb(0.32, 0.27, 0.2) * (0.6 + 0.6 * r.random()))
    items += scatter(55, [strip(0.1, 0.006, 0.005, 3)], 90, (0.6, 1.3), lambda r: 0.004 + 0.004 * r.random(), lambda r: rgb(0.3, 0.26, 0.12) * (0.6 + 0.6 * r.random()))
    return h, c, items, spread(crack)

def sand():
    n1 = fbm(61, 1.4, 1, 40); n2 = fbm(62, 0.4, 30, 90); warp = fbm(63, 1.8, 1, 6)
    u = (np.arange(G) + 0.5) / G
    X, Y = np.meshgrid(u, u)
    rip = np.sin(2 * np.pi * (7 * X + 3 * Y + 0.35 * warp))
    rip2 = np.sin(2 * np.pi * (3 * X - 9 * Y + 0.5 * warp + 0.3))
    h = 0.006 * rip + 0.002 * rip2 + 0.002 * n1 + 0.0007 * n2
    base = rgb(0.80, 0.66, 0.44)
    c = mix(base * 0.85, base * 1.08, smooth(-1, 1, rip + 0.5 * n1))
    c = c * (0.95 + 0.05 * n2 / 3)[..., None]
    c = mix(c, rgb(0.56, 0.42, 0.26), smooth(0.9, 2.2, n1) * 0.35)
    items = scatter(64, [pebble(12), pebble(13)], 70, (0.004, 0.012), lambda r: 0.002, lambda r: rgb(0.5, 0.42, 0.33) * (0.6 + 0.8 * r.random()))
    items += scatter(65, [disc(8, 0.008, 0.006, 0.002, 0.3, 4)], 40, (0.7, 1.5), lambda r: 0.003, lambda r: rgb(0.85, 0.78, 0.65) * (0.7 + 0.4 * r.random()))
    return h, c, items, np.ones_like(h)  # the ripples are the whole patch

def rock():
    n1 = fbm(72, 1.3, 1, 70); n2 = fbm(73, 1.0, 2, 14); n3 = fbm(74, 1.1, 3, 40); n4 = fbm(75, 1.6, 2, 18)
    u = (np.arange(G) + 0.5) / G
    X, Y = np.meshgrid(u, u)
    strata = np.sin(2 * np.pi * (4 * X + 2 * Y + 0.5 * n4 / 3))
    crack = (1 - smooth(0.0, 0.11, np.abs(n3))) * smooth(-0.3, 0.8, n4) + 0.7 * (1 - smooth(0.0, 0.05, np.abs(n2 + 0.3 * n1)))
    crack = np.clip(crack, 0, 1)
    h = 0.03 * n4 / 3 + 0.014 * strata + 0.01 * n1 / 2 + 0.006 * fbm(76, 0.6, 20, 80) - 0.035 * crack
    base = rgb(0.43, 0.41, 0.38)
    c = mix(base * 0.7, base * 1.2, smooth(-1.3, 1.5, n1))
    c = c * (0.93 + 0.07 * strata)[..., None]
    lich = smooth(0.8, 1.7, n2 + 0.4 * n1)
    c = mix(c, rgb(0.46, 0.50, 0.20), lich * 0.45)
    c = mix(c, rgb(0.62, 0.57, 0.48), smooth(1.4, 2.6, n1 + n2) * 0.35)
    c = mix(c, rgb(0.20, 0.19, 0.18), smooth(0.4, 1.4, -n4) * 0.3)
    c = mix(c, rgb(0.07, 0.065, 0.06), crack * 0.85)
    items = scatter(74, [pebble(14), pebble(15), pebble(16)], 90, (0.008, 0.03), lambda r: 0.01, lambda r: rgb(0.43, 0.41, 0.38) * (0.6 + 0.7 * r.random()))
    return h, c, items

def snow():
    n1 = fbm(81, 1.9, 1, 50); n2 = fbm(82, 1.0, 25, 90); warp = fbm(83, 1.6, 1, 5)
    u = (np.arange(G) + 0.5) / G
    X, Y = np.meshgrid(u, u)
    rip = np.sin(2 * np.pi * (5 * X + 2 * Y + 0.5 * warp))
    f1, f2, ids = voronoi(84, 18, warp=0.9)
    crack = 1 - smooth(0.0, 0.012, f2 - f1)
    h = 0.012 * n1 + 0.004 * rip + 0.0015 * n2 - 0.008 * crack
    c = mix(rgb(0.80, 0.86, 0.95), rgb(0.97, 0.98, 1.0), smooth(-1.4, 1.2, n1 + 0.3 * rip))
    c = c * (0.97 + 0.03 * n2 / 3)[..., None]
    c = mix(c, rgb(0.62, 0.70, 0.84), crack * 0.22)
    items = scatter(85, [pebble(17)], 24, (0.004, 0.011), lambda r: 0.004, lambda r: rgb(0.34, 0.31, 0.28) * (0.6 + 0.6 * r.random()))
    items += scatter(86, [strip(0.05, 0.003, 0.003, 3)], 60, (0.6, 1.3), lambda r: 0.004, lambda r: rgb(0.32, 0.27, 0.2) * (0.6 + 0.6 * r.random()))
    return h, c, items

LAYERS = {"needles": needles, "leaves": leaves, "turf": turf, "dirt": dirt, "mud": mud, "sand": sand, "rock": rock, "snow": snow}
# how much of the litter drops out in the field's low patches (bare ground shows) and how far the field tints it
CLUMP = {"needles": (0.75, 0.55), "leaves": (0.65, 0.5), "turf": (0.55, 0.5), "dirt": (0.0, 0.4), "mud": (0.0, 0.3), "sand": (0.0, 0.2), "rock": (0.0, 0.3), "snow": (0.0, 0.1)}
# how hard each layer's normal map leans on the light (the height's range is small; this is a gain on its slope)
NORMAL_GAIN = {"needles": 2.2, "leaves": 2.2, "turf": 2.0, "dirt": 3.0, "mud": 3.0, "sand": 3.4, "rock": 3.0, "snow": 3.0}


# --- Blender ------------------------------------------------------------------------------------------------------
def mesh_from(verts, faces, cols, name):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    a = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
    a.data.foreach_set("color", cols.reshape(-1))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def build(h, c, items, layer_name=''):
    """The scene: the soil three periods wide, each instance repeated where it reaches the centre period or beyond it."""
    z = h - h.min()
    reps = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    n = G
    xs = (np.arange(n * 3) + 0.5) / n - 1.5
    X, Y = np.meshgrid(xs * PERIOD, xs * PERIOD)
    Z = np.tile(z, (3, 3)); C = np.tile(c, (3, 3, 1))
    idx = np.arange(n * 3 * n * 3).reshape(n * 3, n * 3)
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    faces = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    cols = np.concatenate([np.clip(C, 0, 1).reshape(-1, 3), np.ones((n * n * 9, 1))], 1)
    mesh_from(verts, faces, cols, "soil")
    V, F, K = [], [], []
    base = 0
    # clumps: a slow field that thins the litter into bare patches and tints what is left, so the layer reads from across a field
    patchy, tint = CLUMP.get(layer_name, (0.0, 0.0))
    field = fbm(900 + len(items), 1.5, 2, 9)
    r = rng(5)
    for proto, x, y, zl, yaw, s, colr, tilt in items:
        f = sample(field, x, y)
        if patchy and len(pv_ := proto[0]) and r.random() > 1 - patchy * smooth(-0.2, 1.1, -f): continue
        colr = colr * (1 + tint * np.clip(f, -1.6, 1.6) * 0.5)
        pv, pf = proto
        reach = (np.abs(pv[:, 0]).max() + np.abs(pv[:, 1]).max()) * s
        floor = sample(z, x, y)
        co, si = math.cos(yaw), math.sin(yaw)
        roll = tilt
        for i, j in reps:
            ox, oy = x + i * PERIOD, y + j * PERIOD
            if abs(ox) > PERIOD * 0.5 + reach + 0.02 or abs(oy) > PERIOD * 0.5 + reach + 0.02: continue
            p = pv * s
            # roll about the length axis, then yaw, then lay at the floor under it plus its own lift
            p = np.stack([p[:, 0], p[:, 1] * math.cos(roll) - p[:, 2] * math.sin(roll), p[:, 1] * math.sin(roll) + p[:, 2] * math.cos(roll)], -1)
            q = np.stack([p[:, 0] * co - p[:, 1] * si + ox, p[:, 0] * si + p[:, 1] * co + oy, p[:, 2] + floor + zl], -1)
            V.append(q); F.append(pf + base); K.append(np.tile(np.append(np.clip(colr, 0, 1), 1.0), (len(pv), 1)))
            base += len(pv)
    if V: mesh_from(np.concatenate(V), np.concatenate(F), np.concatenate(K), "bits")
    return float(Z.max()) + 0.25

def material(name, height_pass=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    for n in list(t.nodes): t.nodes.remove(n)
    out = t.nodes.new("ShaderNodeOutputMaterial")
    if height_pass is None:
        attr = t.nodes.new("ShaderNodeVertexColor"); attr.layer_name = "col"
        bsdf = t.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.85
        t.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        t.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    else:
        pos = t.nodes.new("ShaderNodeNewGeometry"); sep = t.nodes.new("ShaderNodeSeparateXYZ")
        rng_ = t.nodes.new("ShaderNodeMapRange"); rng_.inputs["From Min"].default_value = 0.0; rng_.inputs["From Max"].default_value = height_pass
        em = t.nodes.new("ShaderNodeEmission")
        t.links.new(pos.outputs["Position"], sep.inputs["Vector"]); t.links.new(sep.outputs["Z"], rng_.inputs["Value"])
        t.links.new(rng_.outputs["Result"], em.inputs["Color"]); t.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

def render(path, res, samples, world_light, denoise):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = denoise
    sc.cycles.device = "CPU"
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.filepath = path
    w = bpy.data.worlds.new("sky"); w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (world_light,) * 3 + (1,); bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(res, res, 4)[:, :, :3][::-1]  # top first
    bpy.data.images.remove(img)
    return a

def camera(top):
    cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = PERIOD
    cam.clip_start = 0.01; cam.clip_end = top + 2
    ob = bpy.data.objects.new("cam", cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (0, 0, top); ob.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = ob

def srgb(l): return np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(np.maximum(l, 0), 1 / 2.4) - 0.055)
def lin(s): return np.where(s <= 0.04045, s / 12.92, np.power((s + 0.055) / 1.055, 2.4))

def save(path, a, quality):
    """a: top-first float RGB 0..1, written as a JPEG as it is (no colour transform)."""
    h, w = a.shape[:2]
    img = bpy.data.images.new("o", w, w, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    px = np.concatenate([np.clip(a, 0, 1)[::-1], np.ones((h, w, 1))], -1).astype(np.float32)
    img.pixels.foreach_set(px.reshape(-1))
    img.file_format = "JPEG"
    img.filepath_raw = path
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = quality; sc.render.image_settings.color_mode = "RGB"
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)

def down(a, n):
    k = a.shape[0] // n
    return a.reshape(n, k, n, k, -1).mean((1, 3)) if k > 1 else a

def make(layer):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    h, c, items, *feature = LAYERS[layer]()
    # the grid runs +y up its rows, the picture top-first: flip it to match
    feature = np.clip(resize(feature[0][::-1], NRES), 0, 1) if feature else np.zeros((NRES, NRES))
    top = build(h, c, items, layer)
    camera(top)
    for ob in bpy.context.scene.collection.objects:
        if ob.type == "MESH": ob.data.materials.append(material("albedo"))
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, f".{layer}.png")
    big = RES * 2
    alb = render(tmp, big, SAMPLES, 1.0, True)
    for ob in bpy.context.scene.collection.objects:
        if ob.type == "MESH": ob.data.materials.clear(); ob.data.materials.append(material("height", top))
    bpy.context.scene.cycles.use_denoising = False
    hp = render(tmp, big, 4, 0.0, False)[:, :, 0]
    os.remove(tmp)
    # albedo: linear light over its own mean, halved, so 0.5 (linear) is the tint the vertex colour gives
    L = down(lin(alb), RES)
    detail = np.clip(L / (L.mean((0, 1), keepdims=True) + 1e-6) * 0.5, 0, 1)
    save(os.path.join(OUT, f"{layer}.jpg"), srgb(detail), 86)
    # normal: the height (srgb-encoded by the Standard view transform, so undo it) as slope along the image's right and down
    ht = down(lin(hp)[..., None], NRES)[..., 0]
    px = NRES / PERIOD
    gx = (np.roll(ht, -1, 1) - np.roll(ht, 1, 1)) * 0.5 * px * (top - 0.25) * NORMAL_GAIN[layer]
    gy = (np.roll(ht, -1, 0) - np.roll(ht, 1, 0)) * 0.5 * px * (top - 0.25) * NORMAL_GAIN[layer]
    nl = np.sqrt(gx * gx + gy * gy + 1)
    nrm = np.stack([0.5 - 0.5 * gx / nl, 0.5 - 0.5 * gy / nl, feature], -1)
    save(os.path.join(OUT, f"{layer}.n.jpg"), nrm, 88)
    print(f"ground {layer}: {len(items)} bits, {os.path.getsize(os.path.join(OUT, layer + '.jpg')) // 1024} KB + {os.path.getsize(os.path.join(OUT, layer + '.n.jpg')) // 1024} KB")

def sheet():
    """Every layer tiled 2 x 2 with a tint on it, as sheet.png (not shipped)."""
    cell = 256
    tiles = []
    for name in LAYERS:
        p = os.path.join(OUT, f"{name}.jpg")
        if not os.path.exists(p): continue
        img = bpy.data.images.load(p)
        w = img.size[0]
        a = np.array(img.pixels[:], dtype=np.float32).reshape(w, w, 4)[:, :, :3]
        bpy.data.images.remove(img)
        a = lin(a) * 2
        tint = {"needles": (0.62, 0.45, 0.28), "leaves": (0.5, 0.36, 0.2), "turf": (0.3, 0.5, 0.15), "dirt": (0.55, 0.42, 0.28), "mud": (0.3, 0.22, 0.14), "sand": (0.8, 0.68, 0.45), "rock": (0.5, 0.48, 0.46), "snow": (0.9, 0.93, 0.98)}[name]
        t = np.tile(np.clip(a * np.array(tint), 0, 1), (2, 2, 1))[::1]
        t = down(t, cell * 2 // 2) if t.shape[0] > cell * 2 else t
        t = t[::t.shape[0] // (cell * 2) or 1, ::t.shape[1] // (cell * 2) or 1][:cell * 2, :cell * 2]
        tiles.append(srgb(t))
    cols = 4
    rows = [np.concatenate(tiles[i:i + cols], 1) for i in range(0, len(tiles), cols)]
    sheet_ = np.concatenate([r for r in rows if r.shape[1] == rows[0].shape[1]], 0)
    img = bpy.data.images.new("sheet", sheet_.shape[1], sheet_.shape[0], alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(np.concatenate([sheet_[::-1], np.ones(sheet_.shape[:2] + (1,))], -1).astype(np.float32).reshape(-1))
    img.file_format = "PNG"
    os.makedirs(os.path.join(ROOT, "blender", "out"), exist_ok=True)
    out = os.path.join(ROOT, "blender", "out", "ground-sheet.png")
    sc = bpy.context.scene; sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
    img.save_render(out, scene=sc)
    print("ground sheet ->", out)

if "--sheet" in args: sheet()
else:
    for nm in names:
        if nm not in LAYERS: raise SystemExit(f"no layer {nm}: {', '.join(LAYERS)}")
        make(nm)
