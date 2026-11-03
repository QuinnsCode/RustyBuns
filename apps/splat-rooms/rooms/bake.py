# Turns a room recipe (recipe.ts) into splats, headless:
#   blender -b --factory-startup -P rooms/bake.py -- <job.json>
# It builds the shell, imports each Poly Haven glTF, drops the props onto the furniture by ray casts, then
# covers every surface in flat Gaussians: colour from the model's own texture, light baked in from ambient
# occlusion and the ceiling lights. No training, no GPU: a mesh's surface is already where its splats go.
# Writes splats.bin (float32 rows: x y z, sx sy sz, qw qx qy qz, r g b, a) and labels.json beside it.
import bpy, bmesh, json, math, sys, time
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
R = job["recipe"]
rng = np.random.default_rng(R["seed"])
DENSITY = job.get("density", {"shell": 3200, "furniture": 7000, "prop": 22000})
t0 = time.time()
def log(msg): print(f"[bake {time.time() - t0:5.1f}s] {msg}", flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def import_asset(asset_id):
    """Imports one model, sitting on z = 0 and centred on x, y, under an empty. Returns (empty, half-sizes, height)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=job["assets"][asset_id])
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    shift = Matrix.Translation(Vector(((lo.x + hi.x) / -2, (lo.y + hi.y) / -2, -lo.z)))
    root = bpy.data.objects.new(f"inst_{asset_id}", None)
    scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.matrix_world = shift @ o.matrix_world
            o.parent = root
            o.matrix_parent_inverse = Matrix.Identity(4)
    return root, ((hi.x - lo.x) / 2, (hi.y - lo.y) / 2), hi.z - lo.z

def put(root, x, y, z, yaw):
    root.location = (x, y, z)
    root.rotation_euler = (0, 0, math.radians(yaw))
    bpy.context.view_layer.update()

def corners(x, y, z, yaw, half, height):
    """InteriorGS box: bottom face then top face, same corner order (x0y0, x0y1, x1y1, x1y0)."""
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    hx, hy = half
    out = []
    for zz in (z, z + height):
        for lx, ly in ((-hx, -hy), (-hx, hy), (hx, hy), (hx, -hy)):
            out.append({"x": x + c * lx - s * ly, "y": y + s * lx + c * ly, "z": zz})
    return out

labels, kind_of, inst = [], {}, []   # inst: (root, density key)

def add(p, root, half, height, kind):
    labels.append({"ins_id": p["id"], "label": p["label"], "bounding_box": corners(p["x"], p["y"], p["z"], p["yaw"], half, height)})
    inst.append((root, kind))

# ---- furniture and pictures, where the recipe says
for p in R["furniture"]:
    root, half, height = import_asset(p["asset"])
    put(root, p["x"], p["y"], p["z"], p["yaw"])
    root["host"] = p["host"]
    add(p, root, half, height, "furniture")
for p in R["hangs"]:
    root, half, height = import_asset(p["asset"])
    put(root, p["x"], p["y"], p["z"], p["yaw"])
    add(p, root, half, height, "furniture")
log(f"{len(R['furniture'])} furniture, {len(R['hangs'])} pictures")

def world_tris(objs):
    """All triangles of these objects in world space, as (verts, tris, owner index per tri)."""
    dg = bpy.context.evaluated_depsgraph_get()
    V, T, O = [], [], []
    off = 0
    for i, ob in enumerate(objs):
        for o in [ob] + list(ob.children_recursive):
            if o.type != "MESH":
                continue
            me = o.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            v = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", v)
            v = v.reshape(-1, 3)
            m = np.array(o.matrix_world, np.float32)
            v = v @ m[:3, :3].T + m[:3, 3]
            t = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get("vertices", t)
            V.append(v); T.append(t.reshape(-1, 3) + off); O.append(np.full(len(t) // 3, i))
            off += len(v)
            o.evaluated_get(dg).to_mesh_clear()
    return np.concatenate(V), np.concatenate(T), np.concatenate(O)

# ---- props: pick a host, a spot on it, cast down to find the shelf or top, check it is flat, clear and free
hosts = [r for r, _ in inst if r.get("host")]
hv, ht, ho = world_tris(hosts)
host_bvh = BVHTree.FromPolygons([Vector(v) for v in hv], ht.tolist())
def host_box(r):
    pts = [c.matrix_world @ Vector(b) for c in r.children_recursive if c.type == "MESH" for b in c.bound_box]
    return [min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts), max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)]
boxes = [host_box(r) for r in hosts]
placed, skipped = [], []
for p in R["props"]:
    root, half, height = import_asset(p["asset"])
    ok = False
    for _ in range(80):
        hi_ = int(rng.integers(len(hosts)))
        b = boxes[hi_]
        yaw = float(rng.uniform(0, 360))
        c, s = abs(math.cos(math.radians(yaw))), abs(math.sin(math.radians(yaw)))
        ex, ey = c * half[0] + s * half[1], s * half[0] + c * half[1]   # rotated footprint, axis-aligned
        if b[3] - b[0] < 2 * ex + 0.02 or b[4] - b[1] < 2 * ey + 0.02:
            continue
        x, y = rng.uniform(b[0] + ex + 0.01, b[3] - ex - 0.01), rng.uniform(b[1] + ey + 0.01, b[4] - ey - 0.01)
        z0 = rng.uniform(b[2] + 0.15, b[5] + 0.05)
        hit = host_bvh.ray_cast(Vector((x, y, z0)), Vector((0, 0, -1)), 3)
        if hit[0] is None or hit[1].z < 0.95 or ho[hit[2]] != hi_:
            continue
        hz = hit[0].z
        feet = [(x + dx * ex * 0.9, y + dy * ey * 0.9) for dx in (-1, 1) for dy in (-1, 1)] + [(x, y)]
        flat = all((h := host_bvh.ray_cast(Vector((fx, fy, hz + 0.02)), Vector((0, 0, -1)), 0.05))[0] is not None and abs(h[0].z - hz) < 0.012 for fx, fy in feet)
        clear = all(host_bvh.ray_cast(Vector((fx, fy, hz + 0.004)), Vector((0, 0, 1)), height + 0.02)[0] is None for fx, fy in feet)
        free = all(x + ex < q[0] or x - ex > q[2] or y + ey < q[1] or y - ey > q[3] or abs(hz - q[4]) > 0.05 for q in placed)
        if flat and clear and free:
            p.update(x=round(float(x), 3), y=round(float(y), 3), z=round(hz, 3), yaw=round(yaw, 1))
            put(root, p["x"], p["y"], p["z"], p["yaw"])
            placed.append((x - ex, y - ey, x + ex, y + ey, hz))
            add(p, root, half, height, "prop")
            ok = True
            break
    if not ok:
        skipped.append(p["label"])
        bpy.data.objects.remove(root, do_unlink=True)
log(f"{len(placed)} props placed, skipped: {skipped or 'none'}")

# ---- the shell: floor, walls, ceiling as quads facing in
w, d, h = R["room"]["w"], R["room"]["d"], R["room"]["h"]
shell = [  # origin, edge u, edge v (normal = u x v points into the room), kind
    ((0, 0, 0), (w, 0, 0), (0, d, 0), "floor"),
    ((0, d, h), (w, 0, 0), (0, -d, 0), "ceiling"),
    ((0, 0, 0), (0, 0, h), (w, 0, 0), "wall"),
    ((w, 0, 0), (0, 0, h), (0, d, 0), "wall"),
    ((w, d, 0), (0, 0, h), (-w, 0, 0), "wall"),
    ((0, d, 0), (0, 0, h), (0, -d, 0), "wall"),
]
sv, st = [], []
for o, u, v, _ in shell:
    o, u, v = np.array(o, float), np.array(u, float), np.array(v, float)
    k = len(sv)
    sv += [o, o + u, o + u + v, o + v]
    st += [[k, k + 1, k + 2], [k, k + 2, k + 3]]

# ---- one BVH over everything, for the light
av, at, _ = world_tris([r for r, _ in inst])
all_v = np.concatenate([av, np.array(sv, np.float32)])
all_t = np.concatenate([at, np.array(st) + len(av)])
bvh = BVHTree.FromPolygons([Vector(v) for v in all_v], all_t.tolist())
log(f"BVH over {len(all_t)} triangles")

def image_of(mat):
    """The image feeding Base Color, or the flat colour (sRGB) when there is none."""
    if mat is None or not mat.use_nodes:
        return None, np.array([0.7, 0.7, 0.7])
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return None, np.array([0.7, 0.7, 0.7])
    sock = bsdf.inputs["Base Color"]
    seen, stack = set(), [l.from_node for l in sock.links]
    while stack:
        n = stack.pop()
        if n in seen: continue
        seen.add(n)
        if n.type == "TEX_IMAGE" and n.image:
            return n.image, None
        stack += [l.from_node for i in n.inputs for l in i.links]
    lin = np.array(sock.default_value[:3])
    return None, np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)

_px = {}
def pixels(img):
    if img.name not in _px:
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
        _px[img.name] = (a.reshape(img.size[1], img.size[0], 4), img.size[0], img.size[1])
    return _px[img.name]

def sample_tris(v, uvs, n_per):
    """Uniform points on triangles: v (T,3,3), uvs (T,3,2) or None, counts per triangle."""
    idx = np.repeat(np.arange(len(v)), n_per)
    r1, r2 = rng.random(len(idx)), rng.random(len(idx))
    s = np.sqrt(r1)
    b = np.stack([1 - s, s * (1 - r2), s * r2], 1)
    pts = np.einsum("ij,ijk->ik", b, v[idx])
    uv = np.einsum("ij,ijk->ik", b, uvs[idx]) if uvs is not None else None
    return idx, pts, uv

def counts(area, dens):
    e = area * dens
    return (np.floor(e) + (rng.random(len(e)) < e - np.floor(e))).astype(int)

P, N, C, A, S = [], [], [], [], []   # positions, normals, albedo, alpha, spacing

def emit(pts, nrm, col, alpha, dens):
    P.append(pts); N.append(nrm); C.append(col); A.append(np.full(len(pts), alpha)); S.append(np.full(len(pts), 1 / math.sqrt(dens)))

# models
dg = bpy.context.evaluated_depsgraph_get()
for root, kind in inst:
    dens = DENSITY[kind]
    for o in [root] + list(root.children_recursive):
        if o.type != "MESH": continue
        me = o.evaluated_get(dg).to_mesh(); me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        if not nt: continue
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co)
        m = np.array(o.matrix_world, np.float32)
        co = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
        tv = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("vertices", tv)
        tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("loops", tl)
        mi = np.empty(nt, np.int32); me.loop_triangles.foreach_get("material_index", mi)
        v = co[tv.reshape(-1, 3)]
        uvl = me.uv_layers.active
        uvs = None
        if uvl:
            u = np.empty(len(me.loops) * 2, np.float32); uvl.data.foreach_get("uv", u)
            uvs = u.reshape(-1, 2)[tl.reshape(-1, 3)]
        cr = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        area = np.linalg.norm(cr, axis=1) / 2
        nrm = cr / np.maximum(np.linalg.norm(cr, axis=1, keepdims=True), 1e-12)
        for k in np.unique(mi):
            sel = mi == k
            mat = o.material_slots[k].material if k < len(o.material_slots) else None
            img, flat = image_of(mat)
            idx, pts, uv = sample_tris(v[sel], uvs[sel] if (uvs is not None and img) else None, counts(area[sel], dens))
            if not len(pts): continue
            if img is not None:
                px, iw, ih = pixels(img)
                ix = (np.mod(uv[:, 0], 1) * iw).astype(int) % iw
                iy = (np.mod(uv[:, 1], 1) * ih).astype(int) % ih
                texel = px[iy, ix]
                keep = texel[:, 3] > 0.5   # cut-out leaves and labels
                emit(pts[keep], nrm[sel][idx][keep], texel[keep, :3], 0.95, dens)
            else:
                emit(pts, nrm[sel][idx], np.tile(flat, (len(pts), 1)), 0.95, dens)
        o.evaluated_get(dg).to_mesh_clear()
log(f"models: {sum(len(p) for p in P)} splats")

# shell: floor texture tiled every 2 m, painted walls with a little grain, a pale ceiling
floor = bpy.data.images.load(job["floor"])
fpx, fw, fh = pixels(floor)
wall_c = np.array(R["room"]["wall"])
for o, u, v, kind in shell:
    o, u, v = np.array(o, float), np.array(u, float), np.array(v, float)
    area = np.linalg.norm(np.cross(u, v))
    # a jittered grid, not random points: flat walls show every gap random sampling leaves
    step = 1 / math.sqrt(DENSITY["shell"])
    nu, nv = max(1, int(np.linalg.norm(u) / step)), max(1, int(np.linalg.norm(v) / step))
    gu, gv = np.meshgrid(np.arange(nu), np.arange(nv), indexing="ij")
    a_ = (gu.ravel() + rng.random(nu * nv)) / nu
    b_ = (gv.ravel() + rng.random(nu * nv)) / nv
    n = len(a_)
    pts = o + a_[:, None] * u + b_[:, None] * v
    nrm = np.tile(np.cross(u, v) / area, (n, 1))
    if kind == "floor":
        ix = (np.mod(pts[:, 0] / 2, 1) * fw).astype(int) % fw
        iy = (np.mod(pts[:, 1] / 2, 1) * fh).astype(int) % fh
        col = fpx[iy, ix, :3]
    elif kind == "wall":
        col = wall_c * (0.97 + 0.03 * rng.random((n, 1)))
        col[pts[:, 2] < 0.1] = [0.93, 0.92, 0.88]   # a skirting board
    else:
        col = np.tile([0.92, 0.92, 0.9], (n, 1))
    emit(pts, nrm, col, 0.9, DENSITY["shell"])

P, N, C, A, S = (np.concatenate(x) for x in (P, N, C, A, S))
log(f"{len(P)} splats, lighting...")

# ---- light, per 3 cm cell (split by which way the surface faces): ambient occlusion from 12 cosine rays
# out to 0.5 m, plus the ceiling lights as soft area lights. One estimate shared by a cell's splats is smooth
# where one per splat is speckle, and it takes fewer rays.
lights = np.array(R["lights"], float)
face = np.argmax(np.abs(N), 1) * 2 + (N[np.arange(len(N)), np.argmax(np.abs(N), 1)] > 0)
cell = np.floor(P / 0.03).astype(np.int64)
key = ((cell[:, 0] + 4096) << 40) | ((cell[:, 1] + 4096) << 26) | ((cell[:, 2] + 4096) << 12) | face
_, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
cells = len(cnt)
cp = np.stack([np.bincount(inv, P[:, a], cells) for a in range(3)], 1) / cnt[:, None]
cn = np.stack([np.bincount(inv, N[:, a], cells) for a in range(3)], 1)
cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-9)
log(f"{cells} light cells")
def tangent(n):
    t = np.cross(n, [0, 0, 1]) if abs(n[2]) < 0.9 else np.cross(n, [1, 0, 0])
    return t / np.linalg.norm(t)
rc = bvh.ray_cast
AO_RAYS, LIGHT_RAYS = 12, 3
cshade = np.empty(cells, np.float32)
cvis = np.ones(cells, bool)
for i in range(cells):
    p, n = cp[i], cn[i]
    o = Vector(p + n * 0.004)
    t1 = tangent(n); t2 = np.cross(n, t1)
    free = 0
    for _ in range(AO_RAYS):
        r1, r2 = rng.random(), rng.random()
        ph, sr = 2 * math.pi * r1, math.sqrt(r2)
        dvec = t1 * math.cos(ph) * sr + t2 * math.sin(ph) * sr + n * math.sqrt(1 - r2)
        if rc(o, Vector(dvec), 0.5)[0] is None: free += 1
    direct = 0.0
    for L in lights:
        for _ in range(LIGHT_RAYS):
            lp = L + rng.uniform(-0.3, 0.3, 3) * [1, 1, 0]
            dv = lp - p; dist = math.sqrt(dv @ dv); dv /= dist
            ndl = float(n @ dv)
            if ndl > 0 and rc(o, Vector(dv), dist - 0.02)[0] is None:
                direct += ndl * 2.2 / (1 + 0.35 * dist * dist) / LIGHT_RAYS
    if free == 0 and direct == 0: cvis[i] = False
    cshade[i] = 0.18 + 0.42 * free / AO_RAYS + 0.5 * min(direct, 1.4)
# blur each cell's light with its 26 neighbours facing the same way: estimates are noisy, light is smooth
ukeys = np.unique(key)
acc, wsum = np.zeros(cells), np.zeros(cells)
for dx in (-1, 0, 1):
    for dy in (-1, 0, 1):
        for dz in (-1, 0, 1):
            nk = ukeys + ((dx << 40) + (dy << 26) + (dz << 12))
            j = np.clip(np.searchsorted(ukeys, nk), 0, cells - 1)
            hit = (ukeys[j] == nk) & cvis[j]
            acc[hit] += cshade[j[hit]]; wsum[hit] += 1
cshade = np.where(wsum > 0, acc / np.maximum(wsum, 1), cshade).astype(np.float32)
shade, vis = cshade[inv], cvis[inv]
log(f"lit; {int((~vis).sum())} hidden splats dropped")

P, N, C, A, S, shade = P[vis], N[vis], C[vis], A[vis], S[vis], shade[vis]
col = np.clip(C * shade[:, None], 0, 1)

# ---- Gaussians: flat discs in the surface plane, turned at random about the normal
n_ = len(P)
t1 = np.where(np.abs(N[:, 2:3]) < 0.9, np.cross(N, [0, 0, 1]), np.cross(N, [1, 0, 0]))
t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
t2 = np.cross(N, t1)
ang = rng.random(n_) * 2 * math.pi
a1 = t1 * np.cos(ang)[:, None] + t2 * np.sin(ang)[:, None]
a2 = np.cross(N, a1)
M = np.stack([a1, a2, N], 2)   # columns are the local x, y, z axes
def quats(M):
    """Rotation matrices (n,3,3) to unit quaternions (w, x, y, z), branching on the largest diagonal term."""
    m00, m11, m22 = M[:, 0, 0], M[:, 1, 1], M[:, 2, 2]
    tr = m00 + m11 + m22
    q = np.empty((len(M), 4))
    k = np.argmax(np.stack([tr, m00, m11, m22], 1), 1)
    for case in range(4):
        i = k == case
        if not i.any(): continue
        A = M[i]
        if case == 0:
            s = np.sqrt(1 + tr[i]) * 2
            q[i] = np.stack([s / 4, (A[:, 2, 1] - A[:, 1, 2]) / s, (A[:, 0, 2] - A[:, 2, 0]) / s, (A[:, 1, 0] - A[:, 0, 1]) / s], 1)
        elif case == 1:
            s = np.sqrt(1 + A[:, 0, 0] - A[:, 1, 1] - A[:, 2, 2]) * 2
            q[i] = np.stack([(A[:, 2, 1] - A[:, 1, 2]) / s, s / 4, (A[:, 0, 1] + A[:, 1, 0]) / s, (A[:, 0, 2] + A[:, 2, 0]) / s], 1)
        elif case == 2:
            s = np.sqrt(1 + A[:, 1, 1] - A[:, 0, 0] - A[:, 2, 2]) * 2
            q[i] = np.stack([(A[:, 0, 2] - A[:, 2, 0]) / s, (A[:, 0, 1] + A[:, 1, 0]) / s, s / 4, (A[:, 1, 2] + A[:, 2, 1]) / s], 1)
        else:
            s = np.sqrt(1 + A[:, 2, 2] - A[:, 0, 0] - A[:, 1, 1]) * 2
            q[i] = np.stack([(A[:, 1, 0] - A[:, 0, 1]) / s, (A[:, 0, 2] + A[:, 2, 0]) / s, (A[:, 1, 2] + A[:, 2, 1]) / s, s / 4], 1)
    return q
q = quats(M)
q /= np.linalg.norm(q, axis=1, keepdims=True)
sig = S * 0.85 * (0.9 + 0.2 * rng.random(n_))
scale = np.stack([sig, sig, np.full(n_, 0.0012)], 1)
rows = np.concatenate([P, scale, q, col, A[:, None]], 1).astype(np.float32)
out = job["out"]
rows.tofile(f"{out}/splats.bin")
json.dump(labels, open(f"{out}/labels.json", "w"))
log(f"wrote {n_} splats, {len(labels)} labels to {out}")

# ---- optional: a plain render of the meshes from a corner, to compare against the splats
if job.get("preview"):
    for o, u, v, kind in shell[:1] + shell[3:5]:
        bm_ = bpy.data.meshes.new(kind)
        o_, u_, v_ = Vector(o), Vector(u), Vector(v)
        bm_.from_pydata([o_, o_ + u_, o_ + u_ + v_, o_ + v_], [], [(0, 1, 2, 3)])
        scene.collection.objects.link(bpy.data.objects.new(kind, bm_))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 18
    cam.location = (0.35, 0.35, 1.6)
    look = Vector((w * 0.65, d * 0.75, 0.7)) - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    for L in lights:
        ld = bpy.data.lights.new("l", "POINT"); ld.energy = 300; ld.shadow_soft_size = 0.25
        lo = bpy.data.objects.new("l", ld); lo.location = tuple(L); scene.collection.objects.link(lo)
    scene.world = bpy.data.worlds.new("w"); scene.world.color = (0.25, 0.25, 0.25)
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.filepath = f"{out}/preview.png"
    bpy.ops.render.render(write_still=True)
    log("preview.png")
