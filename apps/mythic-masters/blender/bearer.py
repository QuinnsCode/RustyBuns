# The Book's bearer's body, built round a stretched humanoid rig (scripts/bearer.ts makes the rig and runs this).
#
#   blender -b --factory-startup --python-exit-code 1 -P blender/bearer.py -- \
#     --rig blender/out/bearer-stretched.glb --sheet blender/bearer.json --out public/models/bearer.glb [--render out.png]
#
# The body is a skin-modifier frame over the bones (a vertex at each joint, a radius from the sheet's `radii`),
# smoothed once and bound to the rig by bone heat. Onto it, each weighted to one bone: the head (a stretched ball with
# a chin and a goatee), a mop (a shell hanging in ragged locks, a few clumps, a fringe), two glowing eyes, bell-bottom flares on the shins, big sneakers,
# and the Book held in the left hand. Three materials: the black body, the Book's cover, and the glow (pages, eyes).
import bpy, bmesh, json, math, os, random, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
arg = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
sheet = json.load(open(arg("--sheet")))
R = sheet["radii"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=arg("--rig"))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.data.objects.remove(o)
bpy.context.view_layer.update()
# the rig's actions are named by their role (idle, walk, ...): Blender may add a suffix on import
for a in bpy.data.actions:
    a.name = a.name.split("_Armature")[0].split("|")[-1]


def at(bone):
    """A bone's head, in the world, at rest."""
    return arm.matrix_world @ arm.data.bones[bone].head_local


def side(name):
    return [f"Left{name}", f"Right{name}"]


forward = (at("headfront") - at("Head")); forward.z = 0; forward.normalize()
up = Vector((0, 0, 1))


def material(name, colour, glow=0.0, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    if glow:
        b.inputs["Emission Color"].default_value = (*colour, 1)
        b.inputs["Emission Strength"].default_value = glow
    return m


C = sheet["colours"]
BODY = material("bearer", C["body"], rough=1.0)
COVER = material("cover", C["cover"], rough=0.7)
GLOW = material("glow", C["glow"], glow=2.0)
SOLE = material("sole", C["sole"], rough=0.8)


def obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def weighted(o, bone):
    """All of `o` follows one bone."""
    g = o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
    return o


# --- the frame: a vertex per joint, edges along the bones ------------------------------------------------------
points, radii, edges = [], [], []
index = {}


def node(key, p, r):
    index[key] = len(points)
    points.append(p)
    radii.append(r)


for b in ("Hips", "Spine02", "Spine01", "Spine", "neck", "Head"):
    node(b, at(b), R[b])
for s in ("Left", "Right"):
    for b in ("UpLeg", "Leg", "Foot", "ToeBase"):
        node(s + b, at(s + b), R[b])
    toe = at(s + "ToeBase") - at(s + "Foot"); toe.z = 0
    node(s + "toe", at(s + "ToeBase") + toe.normalized() * 0.06, R["toe"])
    # the shoulders roll forward and drop: the skin's joints sit in front of and under the bones, so the back
    # curves into the arms instead of running a bar across it (the bones still turn the arms as they did)
    for b in ("Shoulder", "Arm", "ForeArm", "Hand"):
        f, d = sheet.get("slump", {}).get(b, (0.0, 0.0))
        node(s + b, at(s + b) + forward * f - up * d, R[b])
    node(s + "hand", at(s + "Hand") + (at(s + "Hand") - at(s + "ForeArm")).normalized() * 0.03, R["hand"])
chain = ["Hips", "Spine02", "Spine01", "Spine", "neck", "Head"]
edges += list(zip(chain, chain[1:]))
for s in ("Left", "Right"):
    leg = ["Hips", s + "UpLeg", s + "Leg", s + "Foot", s + "ToeBase", s + "toe"]
    armc = ["Spine", s + "Shoulder", s + "Arm", s + "ForeArm", s + "Hand", s + "hand"]
    edges += list(zip(leg, leg[1:])) + list(zip(armc, armc[1:]))

me = bpy.data.meshes.new("frame")
me.from_pydata([tuple(p) for p in points], [(index[a], index[b]) for a, b in edges], [])
body = bpy.data.objects.new("bearer", me)
bpy.context.collection.objects.link(body)
sk = body.modifiers.new("skin", "SKIN")
sk.branch_smoothing = 1.0
sk.use_smooth_shade = True
for i, r in enumerate(radii):
    v = me.skin_vertices[0].data[i]
    v.radius = (r, r)
    v.use_root = i == index["Hips"]
body.modifiers.new("sub", "SUBSURF").levels = 2
dg = bpy.context.evaluated_depsgraph_get()
skinned = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
body.modifiers.clear()
body.data = skinned
body.data.materials.append(BODY)
for p in body.data.polygons:
    p.use_smooth = True

# --- bind the frame: each vertex to the bones of the nearest frame edges -------------------------------------------
# Bone heat splits thin legs between the wrong bones (a shin pulled by the other foot); the frame knows which bone
# each edge is, so weigh by distance to the edges instead: sharply, so two edges blend only where they meet.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_NAME")


def bone_of(a, b):
    """The bone that carries the frame edge from joint a to joint b: a's, or for an end point (toe, hand) its joint's."""
    if a == "Hips" and b != "Spine02":
        return "Hips"
    if a == "Spine" and b.endswith("Shoulder"):
        return "Spine"
    return a


segs = [(points[index[a]], points[index[b]], bone_of(a, b)) for a, b in edges]
groups = {}
for v in body.data.vertices:
    p = body.matrix_world @ v.co
    near = []
    for a, b, bone in segs:
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
        near.append(((p - (a + ab * t)).length, bone))
    near.sort()
    d0 = max(near[0][0], 1e-4)
    w = {}
    for d, bone in near[:3]:
        w[bone] = w.get(bone, 0.0) + (d0 / max(d, 1e-4)) ** 8
    total = sum(w.values())
    for bone, x in w.items():
        if x / total > 0.02:
            groups.setdefault(bone, body.vertex_groups.get(bone) or body.vertex_groups.new(name=bone)).add([v.index], x / total, "REPLACE")

parts = []
rng = random.Random(sheet["hair"]["seed"])

# --- the head: a long ball over the neck, a chin, a goatee -------------------------------------------------------
H = sheet["head"]
top, base = at("head_end"), at("Head")
centre = base + (top - base) * 0.55
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=12, radius=H["radius"])
bmesh.ops.scale(bm, vec=Vector(H["stretch"]), verts=bm.verts)
# a jaw: the front of the lower half pushed forward and down
for v in bm.verts:
    f = v.co.dot(forward) / H["radius"]
    if v.co.z < 0 and f > 0:
        v.co += forward * f * H["chin"] * (-v.co.z / H["radius"]) + Vector((0, 0, -0.3 * H["chin"] * f))
bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
parts.append(weighted(obj("head", bm, BODY), "Head"))


def cone(name, root, direction, length, r0, r1, mat, segs=6):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r0, radius2=r1, depth=length)
    rot = direction.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(root + direction.normalized() * length / 2) @ rot, verts=bm.verts)
    return obj(name, bm, mat)


chin = centre + forward * H["radius"] * 0.75 + Vector((0, 0, -H["radius"] * H["stretch"][2] * 0.85))
parts.append(weighted(cone("goatee", chin + forward * 0.01, Vector((0, 0, -1)) + forward * 0.4, H["goatee"], 0.022, 0.004, BODY), "Head"))

# --- the mop: one shell over the crown and back that hangs in ragged locks, a few fat clumps, a fringe ------------
# Separate spikes read as a hedgehog from the side; a shell keeps one soft outline and the locks break its hem.
hr = sheet["hair"]
sx, sz = H["radius"] * H["stretch"][0], H["radius"] * H["stretch"][2]
right = forward.cross(up)
M = hr["shell"]
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
phase = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
lift = Vector((0, 0, sz * (1 - M["tall"])))  # a squashed shell sits on the crown, not round the jaw
for v in bm.verts:
    d = v.co.copy()
    f, s, z = d.dot(forward), d.dot(right), d.z
    a = math.atan2(s, f)
    # 0 between locks, 1 at a lock's tip; squared so the tips come to points
    lock = (0.5 + 0.5 * math.sin(a * M["locks"] + phase[0] + 0.8 * math.sin(a * 3 + phase[1]))) ** 2
    lumps = 1 + M["lumps"] * math.sin(a * 5 + z * 4 + phase[2]) * math.sin(a * 3 - z * 6)
    p = Vector((d.x * sx, d.y * sx, d.z * sz * M["tall"])) * M["puff"] * lumps + lift
    if z < 0.25:  # below the brow the mop falls: pushed out a little and dragged down, further at each lock
        fall = (0.25 - z) / 1.25
        back = max(0.0, 1 - max(0.0, f) * 1.4)  # less over the cheeks, most at the back
        p += (d * 0.3 * sx + Vector((0, 0, -1)) * M["hang"] * (0.3 + 0.7 * lock) * back) * fall
    else:  # above it, tufts poke out of the crown and flop back, so the outline is ragged from any side
        C = M.get("crown")
        if C:
            # a band round the crown (none at the very top, where the sphere's meridians bunch into one spike),
            # each tuft a ridge that twists a little as it climbs
            band = math.sin(math.pi * min(1.0, (z - 0.25) / 0.65))
            # narrow (a high power), thinner over the brow so none reads as a horn
            front = 1 - 0.7 * max(0.0, f)
            tuft = max(0.0, math.sin(a * C["tufts"] + phase[1] + z * 3)) ** 8 * band * front
            flop = d * 0.55 - forward * 0.45 + Vector((0, 0, -0.45))
            p += flop * C["out"] * tuft
    v.co = centre + p
face = [f for f in bm.faces if (lambda c: c.dot(forward) > sx * 0.25 and c.z < sz * 0.3)(f.calc_center_median() - centre)
        or (f.calc_center_median() - centre).z < -sz * 1.1]
bmesh.ops.delete(bm, geom=face, context="FACES")
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True, smooth=1.0)
parts.append(weighted(obj("mop", bm, BODY), "Head"))
for k in range(hr["clumps"]):
    a = rng.uniform(0, 2 * math.pi)
    e = rng.uniform(0.15, 1.0)  # up the head: 0 the ears, 1 the crown
    d = (forward * math.cos(a) + right * math.sin(a)) * math.cos(e * 1.2) + up * math.sin(e * 1.2)
    if d.dot(forward) > 0.35 and e < 0.75:
        continue  # no hair over the face
    root = centre + Vector((d.x * sx, d.y * sx, d.z * sz)) * 0.85
    # a mop hangs: the low clumps fall almost straight, the crown's flop out over them
    out = (d * (0.5 if e < 0.7 else 0.9) + Vector((0, 0, -1.0 if e < 0.7 else -0.35)) + Vector((rng.uniform(-.25, .25), rng.uniform(-.25, .25), 0))).normalized()
    parts.append(weighted(cone(f"hair{k}", root, out, rng.uniform(*hr["length"]), hr["radius"], 0.006, BODY, segs=5), "Head"))
for k in range(hr["fringe"]):
    t = (k / max(1, hr["fringe"] - 1) - 0.5) * 1.6
    d = (forward * math.cos(t) + right * math.sin(t)) * 0.75 + up * 0.65
    root = centre + Vector((d.x * sx, d.y * sx, d.z * sz)) * 0.9
    out = (forward * 0.7 + Vector((0, 0, -1)) + right * t * 0.3).normalized()
    parts.append(weighted(cone(f"fringe{k}", root, out, rng.uniform(0.06, 0.1), 0.03, 0.005, BODY, segs=5), "Head"))

# --- eyes: two pale embers under the fringe ------------------------------------------------------------------------
E = sheet["eyes"]
for s in (-1, 1):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=E["radius"])
    p = centre + forward * sx * 0.98 + right * s * E["apart"] + Vector((0, 0, sz * 0.12))
    bmesh.ops.translate(bm, vec=p, verts=bm.verts)
    parts.append(weighted(obj(f"eye{s}", bm, GLOW), "Head"))

# --- flares and sneakers -------------------------------------------------------------------------------------------
F, S = sheet["flare"], sheet["shoe"]
for s in ("Left", "Right"):
    ankle, knee = at(s + "Foot"), at(s + "Leg")
    down = (ankle - knee).normalized()
    parts.append(weighted(cone(s + "flare", ankle - down * F["length"] * 0.75, down, F["length"], F["top"], F["hem"], BODY, segs=10), s + "Leg"))
    toe = at(s + "ToeBase") - ankle; toe.z = 0; toe.normalize()
    rot = Matrix((toe.cross(up).normalized() * -1, toe, up)).transposed().to_4x4()
    heel = Vector((ankle.x, ankle.y, 0.0)) + toe * (S["length"] * 0.28)
    sole_h, spring = S["sole"], S["spring"]
    # a chunky sneaker: a domed upper with a round toe box over a slab of sole a shade lighter, both tipped up at the
    # toe (the spring a worn sneaker has), so the foot reads as a shoe from the side, not a box
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.5)
    for v in bm.verts:
        x, y, z = v.co
        t = y + 0.5  # 0 the heel, 1 the toe
        v.co = Vector((x * S["width"] * (1 - 0.18 * t), y * S["length"] * 0.98,
                       sole_h * 0.7 + max(0.0, z + 0.2) / 0.7 * S["height"] * (1 - 0.4 * t * t) + spring * t ** 3))
    upper = obj(s + "shoe", bm, BODY)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).y) > 0.5], cuts=4)
    for v in bm.verts:
        t = v.co.y + 0.5
        v.co = Vector((v.co.x * S["width"] * 1.08 * (1 - 0.18 * t), v.co.y * S["length"] * 1.02, (v.co.z + 0.5) * sole_h + spring * t ** 3))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.007, segments=2, affect="EDGES")
    sole = obj(s + "sole", bm, SOLE)
    for shoe in (upper, sole):
        shoe.data.transform(Matrix.Translation(heel) @ rot)
        # the heel follows the foot, the toe its ball
        gf, gt = shoe.vertex_groups.new(name=s + "Foot"), shoe.vertex_groups.new(name=s + "ToeBase")
        ball = at(s + "ToeBase")
        for v in shoe.data.vertices:
            w = max(0.0, min(1.0, ((v.co - ball).dot(toe) + 0.04) / 0.08))
            gf.add([v.index], 1 - w, "REPLACE"); gt.add([v.index], w, "REPLACE")
        parts.append(shoe)

# --- hands: a mitten (the four fingers as one paddle) and a thumb, on the Hand bone; the Book in the left one ----
# Each hand's frame: `along` down the hand, `out` its back (away from the body), `fwd` the thumb's side. The left
# hand pinches the Book's top edge: the paddle flat on its outer cover, the web over the edge, the thumb on the inner
# cover, so the Book hangs from the grip. The right hangs loose, its fingertips curled in towards the palm.
K, B = sheet["hand"], sheet["book"]


def hand_frame(s):
    hand = at(s + "Hand")
    along = (hand - at(s + "ForeArm")).normalized()
    out = along.cross(forward).normalized()
    if out.dot(hand - at("Spine")) < 0:
        out = -out
    fwd = out.cross(along).normalized()
    if fwd.dot(forward) < 0:
        fwd = -fwd
    return hand, along, out, fwd


def pod(name, a, b, r):
    """A rounded pod from a to b, `r` thick: a thumb."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=1)
    d = b - a
    rot = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    for v in bm.verts:
        v.co = Vector((v.co.x * r * (1 - 0.2 * v.co.z), v.co.y * r * (1 - 0.2 * v.co.z), v.co.z * d.length / 2))
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=bm.verts)
    return obj(name, bm, BODY)


def paddle(name, wrist, along, out, fwd, o, curl):
    """The fingers as one paddle down `along` from the wrist, centred `o` metres out, the tip curled `curl` palmwards."""
    L, W, T = K["length"], K["width"], K["thick"]
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=10, radius=0.5)
    for v in bm.verts:
        x, y, z = v.co  # x across the knuckles, y down the fingers, z through the hand
        t = 0.5 - y     # 0 at the wrist, 1 at the fingertips
        wide = W * (0.8 + 0.2 * math.sin(math.pi * t))  # broader over the knuckles than at the wrist and the tips
        v.co = wrist + fwd * x * wide + along * (t * L - 0.005 - curl * 0.5 * t * t) + out * (z * T + o - curl * t * t)
    return obj(name, bm, BODY)


for s in ("Left", "Right"):
    wrist, along, out, fwd = hand_frame(s)
    held = s == "Left"
    T, tr = K["thick"], K["thumb"]
    if held:
        o = B["thick"] * 0.5 + T * 0.45  # just outside the Book's outer cover
        thumb_root = wrist + fwd * K["width"] * 0.25 - out * (B["thick"] * 0.5 + tr * 0.7)
        thumb_dir = along + fwd * 0.2
    else:
        o = 0.0
        thumb_root = wrist + fwd * K["width"] * 0.4 - out * T * 0.3 + along * 0.005
        thumb_dir = along * 0.8 + fwd * 0.35 - out * 0.35
    parts.append(weighted(paddle(s + "mitten", wrist, along, out, fwd, o, 0.0 if held else K["curl"]), s + "Hand"))
    parts.append(weighted(pod(s + "thumb", thumb_root, thumb_root + thumb_dir.normalized() * K["thumb_length"], tr), s + "Hand"))
    if not held:
        continue
    # the Book, its top edge in the grip's web, centred on the wrist between paddle and thumb
    mid = wrist + along * (B["height"] * 0.5 + K["lip"]) + fwd * (B["width"] * 0.18)
    basis = Matrix((out, along, fwd)).transposed().to_4x4()
    for name, dims, mat, nudge in (("cover", (B["thick"], B["height"], B["width"]), COVER, 0.0), ("pages", (B["thick"] * 0.8, B["height"] * 0.92, B["width"] * 0.94), GLOW, 0.006)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=Vector(dims), verts=bm.verts)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(mid + fwd * nudge) @ basis, verts=bm.verts)
        parts.append(weighted(obj(name, bm, mat), "LeftHand"))

# --- one mesh, bound -------------------------------------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
for p in body.data.polygons:
    p.use_smooth = True
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
lo = min((body.matrix_world @ v.co).z for v in body.data.vertices)
hi = max((body.matrix_world @ v.co).z for v in body.data.vertices)
print(f"bearer: {tris} triangles, {hi - lo:.2f} m tall (feet at {lo:.3f}), clips {', '.join(sorted(a.name for a in bpy.data.actions))}")

out_path = arg("--out")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_yup=True,
                          export_skins=True, export_animations=True, export_animation_mode="ACTIONS",
                          export_force_sampling=True, export_optimize_animation_size=True,
                          export_def_bones=False, export_materials="EXPORT", export_normals=True)
print(f"-> {os.path.relpath(out_path)} ({os.path.getsize(out_path) // 1024} KB)")

# --- the contact sheet: a row of poses by a 1.8 m post, then the head close up from four sides -----------------
shot_path = arg("--render")
if shot_path:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 420, 720
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.color = (0.62, 0.66, 0.72)
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40))
    scene.collection.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
    obj("ground", bm, material("ground", (0.4, 0.42, 0.38)))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=0.015, radius2=0.015, depth=1.8, segments=6)
    bmesh.ops.translate(bm, vec=Vector((0.62, 0.3, 0.9)), verts=bm.verts)
    obj("post", bm, material("post", (0.8, 0.3, 0.2)))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.35
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0, -8, 1.05)
    cam.rotation_euler = (math.radians(90), 0, 0)
    face = math.atan2(forward.y, forward.x)  # turn the figure so it faces the camera (-y) at yaw 0
    shots = [("idle", 0.0, 0), ("idle", 0.0, 90), ("walk", 0.25, 55), ("walk", 0.75, 90), ("run", 0.3, 90), ("look", 0.45, 25), ("cast", 0.55, 70)]
    if not arm.animation_data:
        arm.animation_data_create()
    # then close ups: the head (front, back) where the hair's outline is judged, each hand, a sneaker
    head = [("idle", 0.0, 0, "head"), ("idle", 0.0, 180, "head"), ("idle", 0.0, -90, "LeftHand"), ("idle", 0.0, 90, "LeftHand"), ("idle", 0.0, 90, "RightHand"), ("idle", 0.0, 0, "RightHand"), ("idle", 0.0, -90, "LeftFoot")]
    frames = []
    for k, (clip, phase, yaw, *close) in enumerate(shots + head):
        cam.data.ortho_scale = (0.9 if close[0] == "head" else 0.6 if close[0].endswith("Foot") else 0.42) if close else 2.35
        act = bpy.data.actions[clip]
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and act.slots:
            arm.animation_data.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        scene.frame_set(int(f0 + (f1 - f0) * phase))
        arm.rotation_mode = "XYZ"
        arm.rotation_euler = (arm.rotation_euler.x, arm.rotation_euler.y, -math.pi / 2 - face + math.radians(yaw))
        # pin the figure over the origin whatever the clip's root drifts to
        bpy.context.view_layer.update()
        hips = arm.matrix_world @ arm.pose.bones["Hips"].head
        arm.location.x -= hips.x; arm.location.y -= hips.y
        if close:
            bpy.context.view_layer.update()
            bone = lambda n: arm.matrix_world @ arm.pose.bones[n].head
            if close[0] == "head":
                h = (bone("Head") + bone("head_end")) / 2 - Vector((0, 0, 0.12))
            elif close[0].endswith("Hand"):
                h = bone(close[0]) - Vector((0, 0, 0.09))
            else:
                h = bone(close[0][:-4] + "ToeBase") + Vector((0, 0, 0.1))
            cam.location = (h.x, -8, h.z)
        else:
            cam.location = (0, -8, 1.05)
        scene.render.filepath = os.path.join(os.path.dirname(shot_path), f"bearer-{k}.png")
        bpy.ops.render.render(write_still=True)
        frames.append(scene.render.filepath)
        arm.location.x = arm.location.y = 0
    import numpy as np
    imgs = [bpy.data.images.load(f) for f in frames]
    w, h = imgs[0].size
    px = [np.array(i.pixels[:]).reshape(h, w, 4) for i in imgs]
    row = np.concatenate(px, axis=1)
    out = bpy.data.images.new("sheet", width=w * len(px), height=h)
    out.pixels = row.ravel()
    out.filepath_raw = shot_path
    out.file_format = "PNG"
    out.save()
    for f in frames:
        os.remove(f)
    print(f"render -> {os.path.relpath(shot_path)}")
