# Turns a room recipe (recipe.ts) into splats, headless:
#   blender -b --factory-startup -P rooms/bake.py -- <job.json>
# It builds the shell (walls with a door and windows, a corridor behind the door), imports each Poly Haven glTF,
# drops the props onto the furniture by ray casts, then lets Cycles bake every surface's light (direct and
# bounced, from the lamps and from the sky through the windows) into a lightmap. Then it covers every surface in
# flat Gaussians: colour from the model's own texture times the baked light. No training: a mesh's surface is
# already where its splats go, and the light is what a path tracer says reaches it.
# Writes splats.bin (float32 rows: x y z, sx sy sz, qw qx qy qz, r g b, a) and labels.json beside it.
import bpy, json, math, os, sys, time
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
sys.path.append(os.path.dirname(__file__))
from blend import import_asset as _import

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
R = job["recipe"]
rng = np.random.default_rng(R["seed"])
DENSITY = job.get("density", {"shell": 3200, "furniture": 7000, "prop": 22000, "sky": 500})
TEXEL = 0.015          # lightmap texel, metres
SAMPLES = job.get("samples", 128)
LAMP_W = job.get("lamp", 120)
t0 = time.time()
def log(msg): print(f"[bake {time.time() - t0:5.1f}s] {msg}", flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def import_asset(asset_id):
    return _import(job["assets"][asset_id], asset_id)

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
for p in R.get("fixtures", []):
    root, half, height = import_asset(p["asset"])
    put(root, p["x"], p["y"], p["z"], p["yaw"])
    add(p, root, half, height, "furniture")
log(f"{len(R['furniture'])} furniture, {len(R['hangs'])} pictures, {len(R.get('fixtures', []))} lamps")


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

# ---- the shell: every flat surface as (origin, u, v), normal u x v into the room, holes as (a0, a1, b0, b1) in
# the surface's own coordinates (point = origin + a u + b v). Walls run as in recipe.ts: 0 along y = 0, then
# anticlockwise. A window gets reveals (its sill, head and sides); the door opens onto a short dark corridor.
w, d, h = R["room"]["w"], R["room"]["d"], R["room"]["h"]
Z = np.array([0.0, 0, 1])
WALLS = [((0, 0, 0), (1, 0, 0), w), ((w, 0, 0), (0, 1, 0), d), ((w, d, 0), (-1, 0, 0), w), ((0, d, 0), (0, -1, 0), d)]
shell = [  # dicts: o, u, v, kind, holes
    dict(o=(0, 0, 0), u=(w, 0, 0), v=(0, d, 0), kind="floor"),
    dict(o=(0, d, h), u=(w, 0, 0), v=(0, -d, 0), kind="ceiling"),
]
REVEAL, CORRIDOR = 0.15, 1.6
windows = []
for i, (o, A, ln) in enumerate(WALLS):
    o, A = np.array(o, float), np.array(A, float)
    N = np.cross(Z, A)
    ops = [x for x in R.get("openings", []) if x["wall"] == i]
    shell.append(dict(o=o, u=Z * h, v=A * ln, kind="wall",
                      holes=[(x["bottom"] / h, x["top"] / h, x["from"] / ln, x["to"] / ln) for x in ops]))
    for x in ops:
        P = lambda s, z: o + A * s + Z * z
        wd, ht = x["to"] - x["from"], x["top"] - x["bottom"]
        if x["kind"] == "window":
            t = N * REVEAL
            shell += [dict(o=P(x["from"], x["bottom"]) - t, u=A * wd, v=t, kind="reveal"),
                      dict(o=P(x["from"], x["top"]) - t, u=t, v=A * wd, kind="reveal"),
                      dict(o=P(x["from"], x["bottom"]) - t, u=t, v=Z * ht, kind="reveal"),
                      dict(o=P(x["to"], x["bottom"]) - t, u=Z * ht, v=t, kind="reveal")]
            windows.append(dict(centre=P((x["from"] + x["to"]) / 2, (x["bottom"] + x["top"]) / 2) - t, N=N, A=A, wd=wd, ht=ht))
        else:
            t = N * CORRIDOR
            shell += [dict(o=P(x["from"], 0) - t, u=A * wd, v=t, kind="corridor-floor"),
                      dict(o=P(x["from"], x["top"]) - t, u=t, v=A * wd, kind="corridor"),
                      dict(o=P(x["from"], 0) - t, u=t, v=Z * x["top"], kind="corridor"),
                      dict(o=P(x["to"], 0) - t, u=Z * x["top"], v=t, kind="corridor"),
                      dict(o=P(x["from"], 0) - t, u=Z * x["top"], v=A * wd, kind="corridor")]
for s in shell:
    s["o"], s["u"], s["v"] = (np.array(s[k], float) for k in ("o", "u", "v"))
    s.setdefault("holes", [])

def in_holes(a, b, holes):
    out = np.zeros(len(a), bool)
    for a0, a1, b0, b1 in holes:
        out |= (a > a0) & (a < a1) & (b > b0) & (b < b1)
    return out

def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

_px = {}
def pixels(img):
    if img.name not in _px:
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
        _px[img.name] = (a.reshape(img.size[1], img.size[0], 4), img.size[0], img.size[1])
    return _px[img.name]

floor_img = bpy.data.images.load(job["floor"])
fpx, fw, fh = pixels(floor_img)
wall_c = np.array(R["room"]["wall"])
shell_colour = {"wall": wall_c, "corridor": wall_c * 0.9, "reveal": np.array([0.9, 0.9, 0.88]),
                "ceiling": np.array([0.92, 0.92, 0.9]), "floor": fpx[..., :3].reshape(-1, 3).mean(0) ** (1 / 2.2),
                "corridor-floor": fpx[..., :3].reshape(-1, 3).mean(0) ** (1 / 2.2)}

# ---- Cycles: the shell as meshes, every model with a lightmap, lamps, the sky
def lightmap(name, wpx, hpx):
    img = bpy.data.images.new(f"lm_{name}", max(8, wpx), max(8, hpx), float_buffer=True)
    return img

def bake_ready(mat, img, tex_uv=None):
    """Points a material's active image node at the lightmap and makes it plain diffuse, so metal and glass
    still get light (Cycles' diffuse pass is zero on a pure metal). Cycles bakes into the render-active UV
    layer, which is the lightmap's, so the model's own textures get pinned to their layer by name."""
    nt = mat.node_tree
    if tex_uv:
        for n in list(nt.nodes):
            if n.type == "TEX_IMAGE" and not n.inputs["Vector"].links:
                m = nt.nodes.new("ShaderNodeUVMap"); m.uv_map = tex_uv
                nt.links.new(m.outputs["UV"], n.inputs["Vector"])
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED":
            for name, v in (("Metallic", 0.0), ("Roughness", 1.0), ("Transmission Weight", 0.0), ("Specular IOR Level", 0.0), ("Coat Weight", 0.0)):
                if name in n.inputs:
                    for l in list(n.inputs[name].links): nt.links.remove(l)
                    n.inputs[name].default_value = v
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nt.nodes.active = tex

shell_objs = []
for k, s in enumerate(shell):
    o, u, v = s["o"], s["u"], s["v"]
    cuts_a = sorted({0.0, 1.0, *[x for hh in s["holes"] for x in hh[:2]]})
    cuts_b = sorted({0.0, 1.0, *[x for hh in s["holes"] for x in hh[2:]]})
    verts, faces, uvs = [], [], []
    for i in range(len(cuts_a) - 1):
        for j in range(len(cuts_b) - 1):
            a0, a1, b0, b1 = cuts_a[i], cuts_a[i + 1], cuts_b[j], cuts_b[j + 1]
            if in_holes(np.array([(a0 + a1) / 2]), np.array([(b0 + b1) / 2]), s["holes"])[0]: continue
            n0 = len(verts)
            for a, b in ((a0, b0), (a1, b0), (a1, b1), (a0, b1)):
                verts.append(tuple(o + a * u + b * v)); uvs.append((a, b))
            faces.append((n0, n0 + 1, n0 + 2, n0 + 3))
    me = bpy.data.meshes.new(f"shell{k}")
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="light")
    for li, loop in enumerate(me.loops): uvl.data[li].uv = uvs[loop.vertex_index]
    ob = bpy.data.objects.new(f"shell{k}_{s['kind']}", me)
    scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(f"shell{k}")
    bsdf = mat.node_tree.nodes.get("Principled BSDF") or mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*srgb_to_lin(shell_colour[s["kind"]]), 1)
    me.materials.append(mat)
    img = lightmap(ob.name, math.ceil(np.linalg.norm(u) / TEXEL), math.ceil(np.linalg.norm(v) / TEXEL))
    bake_ready(mat, img)
    s["img"] = img
    shell_objs.append(ob)

model_meshes = [o for root, _ in inst for o in [root] + list(root.children_recursive) if o.type == "MESH"]
for ob in model_meshes:
    if ob.data.users > 1: ob.data = ob.data.copy()
    me = ob.data
    tex_uv = me.uv_layers[0].name if len(me.uv_layers) else None
    lay = me.uv_layers.new(name="light")
    me.uv_layers.active = lay
    lay.active_render = True
    ob["tex_uv"] = tex_uv or ""
    if not ob.material_slots:
        me.materials.append(bpy.data.materials.new(f"plain_{ob.name}"))
    for slot in ob.material_slots:
        if slot.material is None: slot.material = bpy.data.materials.new(f"plain_{ob.name}")
        slot.material = slot.material.copy()
bpy.ops.object.select_all(action="DESELECT")
for ob in model_meshes: ob.select_set(True)
bpy.context.view_layer.objects.active = model_meshes[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")
dg = bpy.context.evaluated_depsgraph_get()
for ob in model_meshes:
    m = np.array(ob.matrix_world)
    me = ob.data
    area = sum(p.area for p in me.polygons) * abs(np.linalg.det(m[:3, :3])) ** (2 / 3)
    side = int(min(1024, max(16, 2 ** math.ceil(math.log2(max(1e-6, math.sqrt(area)) / TEXEL * 1.6)))))
    img = lightmap(ob.name, side, side)
    for slot in ob.material_slots: bake_ready(slot.material, img, ob["tex_uv"] or None)
    ob["lm"] = img.name
log(f"lightmaps: {len(model_meshes)} model meshes, {len(shell_objs)} shell surfaces")

lights = np.array(R["lights"], float)
for i, L_ in enumerate(lights):
    ld = bpy.data.lights.new(f"lamp{i}", "POINT"); ld.energy = LAMP_W; ld.shadow_soft_size = 0.08
    ld.color = (1.0, 0.86, 0.68)
    lo = bpy.data.objects.new(f"lamp{i}", ld); lo.location = tuple(L_); scene.collection.objects.link(lo)
for i, win in enumerate(windows):   # portals: Cycles aims sky samples through the windows
    ld = bpy.data.lights.new(f"portal{i}", "AREA"); ld.shape = "RECTANGLE"; ld.size, ld.size_y = win["wd"], win["ht"]
    try: ld.cycles.is_portal = True
    except AttributeError: ld.is_portal = True
    lo = bpy.data.objects.new(f"portal{i}", ld); lo.location = tuple(win["centre"])
    lo.rotation_euler = (Matrix((tuple(win["A"]), (0, 0, 1), tuple(-win["N"]))).transposed()).to_euler()
    scene.collection.objects.link(lo)
sky = bpy.data.images.load(job["sky"])
world = bpy.data.worlds.new("sky"); scene.world = world
env = world.node_tree.nodes.new("ShaderNodeTexEnvironment"); env.image = sky
bg = world.node_tree.nodes.get("Background") or world.node_tree.nodes.new("ShaderNodeBackground")
world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
out_node = next(n for n in world.node_tree.nodes if n.type == "OUTPUT_WORLD") if any(n.type == "OUTPUT_WORLD" for n in world.node_tree.nodes) else world.node_tree.nodes.new("ShaderNodeOutputWorld")
world.node_tree.links.new(bg.outputs["Background"], out_node.inputs["Surface"])

scene.render.engine = "CYCLES"
try:
    if job.get("device", "CPU") != "GPU": raise RuntimeError("CPU asked for")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    log(f"baking on the CPU ({e})")
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 4; scene.cycles.diffuse_bounces = 3; scene.cycles.glossy_bounces = 1; scene.cycles.transmission_bounces = 2
bake_objs = model_meshes + shell_objs
bpy.ops.object.select_all(action="DESELECT")
for ob in bake_objs: ob.select_set(True)
bpy.context.view_layer.objects.active = bake_objs[0]
scene.render.bake.margin = 4
log(f"baking {len(bake_objs)} objects at {SAMPLES} samples on {scene.cycles.device}...")
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, use_clear=True, target="IMAGE_TEXTURES")
log("baked")
if os.environ.get("BAKE_DEBUG"):
    t = next(o for o in model_meshes if o.name.startswith("side_table"))
    bpy.ops.object.select_all(action="DESELECT"); t.select_set(True); bpy.context.view_layer.objects.active = t
    def m_(): a = np.empty(t_img.size[0] * t_img.size[1] * 4, np.float32); t_img.pixels.foreach_get(a); return a.reshape(-1, 4)[:, :3].mean()
    t_img = t.material_slots[0].material.node_tree.nodes.active.image
    me_ = t.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    log(f"STEP eval layers {[ (l.name, l.active, l.active_render) for l in me_.uv_layers]} polys {len(me_.polygons)} scale {tuple(t.matrix_world.to_scale())}")
    u = np.empty(len(me_.loops) * 2, np.float32); me_.uv_layers['light'].data.foreach_get('uv', u); log(f"STEP eval light uv {u.min()}..{u.max()}")
    for step in ("as is",):
        if step == "no shell":
            for o in shell_objs: o.hide_render = True
        if step == "no portals":
            for o in scene.objects:
                if o.name.startswith("portal"): o.hide_render = True
        if step == "no world": scene.world = None
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, use_clear=True, target="IMAGE_TEXTURES")
        log(f"STEP {step}: {m_():.4f}")
    log(f"alone: {t.name} mats {[s.material.name for s in t.material_slots]} active {[s.material.node_tree.nodes.active.image.name for s in t.material_slots]}")
    os.makedirs(f"{job['out']}/lm", exist_ok=True)
    for img in [i for i in bpy.data.images if i.name.startswith("lm_")][:400]:
        a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
        log(f"{img.name} {img.size[0]}x{img.size[1]} mean {a.reshape(-1, 4)[:, :3].mean():.4f} zero {(a.reshape(-1, 4)[:, :3].sum(1) == 0).mean():.2f}")

def light_at(img, uv):
    px, iw, ih = pixels(img)
    ix = np.clip((uv[:, 0] * iw).astype(int), 0, iw - 1)
    iy = np.clip((uv[:, 1] * ih).astype(int), 0, ih - 1)
    return px[iy, ix, :3]

def image_of(mat):
    """The image feeding Base Color, or the flat colour (sRGB) when there is none."""
    if mat is None:
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

def sample_tris(v, uvsets, n_per):
    """Uniform points on triangles: v (T,3,3), each of uvsets (T,3,2) or None, counts per triangle."""
    idx = np.repeat(np.arange(len(v)), n_per)
    r1, r2 = rng.random(len(idx)), rng.random(len(idx))
    s = np.sqrt(r1)
    b = np.stack([1 - s, s * (1 - r2), s * r2], 1)
    pts = np.einsum("ij,ijk->ik", b, v[idx])
    return idx, pts, [np.einsum("ij,ijk->ik", b, u[idx]) if u is not None else None for u in uvsets]

def counts(area, dens):
    e = area * dens
    return (np.floor(e) + (rng.random(len(e)) < e - np.floor(e))).astype(int)

P, N, C, Lt, A, S = [], [], [], [], [], []   # positions, normals, albedo (sRGB), baked light (linear), alpha, spacing

def emit(pts, nrm, col, light, alpha, dens):
    P.append(pts); N.append(nrm); C.append(col); Lt.append(light); A.append(np.full(len(pts), alpha)); S.append(np.full(len(pts), 1 / math.sqrt(dens)))

# models
dg = bpy.context.evaluated_depsgraph_get()
for root, kind in inst:
    dens = DENSITY[kind]
    for o in [root] + list(root.children_recursive):
        if o.type != "MESH": continue
        lm = bpy.data.images[o["lm"]]
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
        def loop_uv(layer):
            u = np.empty(len(me.loops) * 2, np.float32); layer.data.foreach_get("uv", u)
            return u.reshape(-1, 2)[tl.reshape(-1, 3)]
        tex_layer = next((l for l in me.uv_layers if l.name != "light"), None)
        uvs = loop_uv(tex_layer) if tex_layer else None
        luv = loop_uv(me.uv_layers["light"])
        cr = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        area = np.linalg.norm(cr, axis=1) / 2
        nrm = cr / np.maximum(np.linalg.norm(cr, axis=1, keepdims=True), 1e-12)
        for k in np.unique(mi):
            sel = mi == k
            mat = o.material_slots[k].material if k < len(o.material_slots) else None
            img, flat = image_of(mat)
            idx, pts, (uv, lu) = sample_tris(v[sel], [uvs[sel] if (uvs is not None and img) else None, luv[sel]], counts(area[sel], dens))
            if not len(pts): continue
            light = light_at(lm, lu)
            if img is not None:
                px, iw, ih = pixels(img)
                ix = (np.mod(uv[:, 0], 1) * iw).astype(int) % iw
                iy = (np.mod(uv[:, 1], 1) * ih).astype(int) % ih
                texel = px[iy, ix]
                keep = texel[:, 3] > 0.5   # cut-out leaves and labels
                emit(pts[keep], nrm[sel][idx][keep], texel[keep, :3], light[keep], 0.95, dens)
            else:
                emit(pts, nrm[sel][idx], np.tile(flat, (len(pts), 1)), light, 0.95, dens)
        o.evaluated_get(dg).to_mesh_clear()
log(f"models: {sum(len(p) for p in P)} splats")

# shell: a jittered grid, not random points (flat walls show every gap random sampling leaves). Floor texture
# tiled every 2 m, painted walls with a little grain and a skirting board, a pale ceiling.
for s in shell:
    o, u, v, kind = s["o"], s["u"], s["v"], s["kind"]
    step = 1 / math.sqrt(DENSITY["shell"])
    nu, nv = max(1, int(np.linalg.norm(u) / step)), max(1, int(np.linalg.norm(v) / step))
    gu, gv = np.meshgrid(np.arange(nu), np.arange(nv), indexing="ij")
    a_ = (gu.ravel() + rng.random(nu * nv)) / nu
    b_ = (gv.ravel() + rng.random(nu * nv)) / nv
    keep = ~in_holes(a_, b_, s["holes"])
    a_, b_ = a_[keep], b_[keep]
    n = len(a_)
    pts = o + a_[:, None] * u + b_[:, None] * v
    nrm = np.tile(np.cross(u, v) / np.linalg.norm(np.cross(u, v)), (n, 1))
    if kind in ("floor", "corridor-floor"):
        ix = (np.mod(pts[:, 0] / 2, 1) * fw).astype(int) % fw
        iy = (np.mod(pts[:, 1] / 2, 1) * fh).astype(int) % fh
        col = fpx[iy, ix, :3]
    else:
        col = shell_colour[kind] * (0.97 + 0.03 * rng.random((n, 1)))
        if kind == "wall": col[pts[:, 2] < 0.1] = [0.93, 0.92, 0.88]   # a skirting board
    emit(pts, nrm, col, light_at(s["img"], np.stack([a_, b_], 1)), 0.9, DENSITY["shell"])

P, N, C, Lt, A, S = (np.concatenate(x) for x in (P, N, C, Lt, A, S))
log(f"{len(P)} splats, smoothing the light...")

# ---- smooth the baked light per 3 cm cell (split by which way the surface faces), each cell blurred with its
# 26 neighbours facing the same way: a bake at a few hundred samples is noisy, and light is smooth. Cells with no
# light at all are inside something (a sofa's underside on the floor, a cabinet's back on the wall): dropped.
face = np.argmax(np.abs(N), 1) * 2 + (N[np.arange(len(N)), np.argmax(np.abs(N), 1)] > 0)
cell = np.floor(P / 0.03).astype(np.int64)
key = ((cell[:, 0] + 4096) << 40) | ((cell[:, 1] + 4096) << 26) | ((cell[:, 2] + 4096) << 12) | face
ukeys, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
cells = len(cnt)
clight = np.stack([np.bincount(inv, Lt[:, c], cells) for c in range(3)], 1) / cnt[:, None]
lum = clight @ [0.2126, 0.7152, 0.0722]
cvis = lum > 0.01 * np.median(lum)
acc, wsum = np.zeros((cells, 3)), np.zeros(cells)
for dx in (-1, 0, 1):
    for dy in (-1, 0, 1):
        for dz in (-1, 0, 1):
            nk = ukeys + ((dx << 40) + (dy << 26) + (dz << 12))
            j = np.clip(np.searchsorted(ukeys, nk), 0, cells - 1)
            hit = (ukeys[j] == nk) & cvis[j]
            acc[hit] += clight[j[hit]]; wsum[hit] += 1
clight = np.where(wsum[:, None] > 0, acc / np.maximum(wsum, 1)[:, None], clight)
light, vis = clight[inv], cvis[inv]
log(f"{cells} light cells; {int((~vis).sum())} hidden splats dropped")
P, N, C, A, S, light = P[vis], N[vis], C[vis], A[vis], S[vis], light[vis]

# ---- exposure: what a camera would do. Radiance is albedo times the baked light; scale so the median surface
# sits mid-grey, roll the highlights off (a window's sill in daylight shouldn't clip to flat white), then sRGB.
radiance = srgb_to_lin(C) * light
k = -math.log(1 - 0.3) / max(1e-6, float(np.median(radiance @ [0.2126, 0.7152, 0.0722])))
def expose(x):
    y = 1 - np.exp(-k * x)
    return np.clip(np.where(y <= 0.0031308, y * 12.92, 1.055 * np.power(np.maximum(y, 0), 1 / 2.4) - 0.055), 0, 1)
col = expose(radiance)

# ---- the view out of each window: a backdrop beyond it, coloured by the sky in that direction from the room,
# exposed the same way (so it's as bright as daylight should look from inside). Not in the bake: it would shade.
sp, sh = pixels(sky)[0], sky.size
eye = np.array([w / 2, d / 2, 1.5])
for win in windows:
    far, grow = 2.5, 2.5 * 1.6
    uu, vv = win["A"] * (win["wd"] + 2 * grow), Z * (win["ht"] + 2 * grow)
    o = win["centre"] - win["N"] * far - uu / 2 - vv / 2
    step = 1 / math.sqrt(DENSITY["sky"])
    nu, nv = int(np.linalg.norm(uu) / step), int(np.linalg.norm(vv) / step)
    gu, gv = np.meshgrid(np.arange(nu), np.arange(nv), indexing="ij")
    pts = o + ((gu.ravel() + rng.random(nu * nv)) / nu)[:, None] * uu + ((gv.ravel() + rng.random(nu * nv)) / nv)[:, None] * vv
    dv = pts - eye; dv /= np.linalg.norm(dv, axis=1, keepdims=True)
    ix = ((-np.arctan2(dv[:, 1], dv[:, 0]) / (2 * math.pi) + 0.5) * sh[0]).astype(int) % sh[0]
    iy = np.clip(((np.arctan2(dv[:, 2], np.hypot(dv[:, 0], dv[:, 1])) / math.pi + 0.5) * sh[1]).astype(int), 0, sh[1] - 1)
    n = len(pts)
    P = np.concatenate([P, pts]); N = np.concatenate([N, np.tile(win["N"], (n, 1))])
    col = np.concatenate([col, expose(sp[iy, ix, :3])]); A = np.concatenate([A, np.full(n, 0.95)])
    S = np.concatenate([S, np.full(n, step * 1.3)])
log(f"lit, {len(windows)} windows")

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

# ---- optional: Cycles' own render of the meshes from a corner, the reference the splats should match
if job.get("preview"):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 18
    cam.location = (0.35, 0.35, 1.6)
    look = Vector((w * 0.65, d * 0.75, 0.7)) - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.filepath = f"{out}/preview.png"
    bpy.ops.render.render(write_still=True)
    log("preview.png")
