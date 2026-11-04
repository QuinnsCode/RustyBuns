# The catalog's contact sheet: every model as the room builder sees it, front toward the camera.
#   blender -b --factory-startup -P rooms/fronts.py -- <job.json>   (job: {"models": [[id, label, turn, path]], "out": png})
# The camera stands at -y looking +y, so a model whose front faces -y (after its `turn`) shows its front.
# One whose back or side shows needs its `turn` fixed in catalog.ts. With "turns": [0, 90, 180, 270] each model
# gets a cell per turn instead, to pick the right one. It also prints each model's measured size, as turned.
import bpy, json, math, os, sys
from mathutils import Vector
sys.path.append(os.path.dirname(__file__))
from blend import import_asset, eevee

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COLS, CELL = 10, 1.6
turns = job.get("turns")
cells = [(m, t) for m in job["models"] for t in (turns or [m[2]])]
if turns: COLS = len(turns) * max(1, 8 // len(turns))
rows = math.ceil(len(cells) / COLS)
measured = {}
for i, ((aid, label, _, path), turn) in enumerate(cells):
    root, half, height = import_asset(path, aid)
    side = abs(turn) % 180 == 90
    measured[aid] = [round(2 * half[1 if side else 0], 2), round(2 * half[0 if side else 1], 2), round(height, 2)]
    size = max(half[0] * 2, half[1] * 2, height)
    s = 1.0 / size
    x, z = (i % COLS) * CELL, -(i // COLS) * CELL * 1.15
    root.scale = (s, s, s)
    root.location = (x, 0, z)
    root.rotation_euler = (0, 0, math.radians(turn))
    txt = bpy.data.curves.new(f"t{i}", "FONT")
    txt.body = f"{label}" + (f" ({turn})" if turn else "")
    txt.size = 0.11
    txt.align_x = "CENTER"
    t = bpy.data.objects.new(f"t{i}", txt)
    t.location = (x, -0.6, z - 0.2)
    t.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(t)
    # a red floor tab on the front (-y) side, so a turned-away model is obvious
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -0.55, z - 0.02))
    tab = bpy.context.object
    tab.scale = (0.5, 0.04, 0.02)
    m = bpy.data.materials.new("tab")
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.05, 0.02, 1)
    tab.data.materials.append(m)
w_, h_ = COLS * CELL, rows * CELL * 1.15
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = max(w_, h_) + 0.4
tilt = math.radians(12)
centre = Vector(((COLS - 1) * CELL / 2, 0, -(rows - 1) * CELL * 1.15 / 2 + 0.4))
cam.location = centre + Vector((0, -20 * math.cos(tilt), 20 * math.sin(tilt)))
cam.rotation_euler = (math.radians(90) - tilt, 0, 0)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3
sun.rotation_euler = (math.radians(55), 0, math.radians(-25)); scene.collection.objects.link(sun)
scene.world = bpy.data.worlds.new("w"); scene.world.color = (0.5, 0.5, 0.5)
scene.render.engine = eevee()
scene.render.resolution_x = 2400
scene.render.resolution_y = int(2400 * h_ / w_) if h_ < w_ else 2400
scene.render.filepath = job["out"]
bpy.ops.render.render(write_still=True)
for aid, size in measured.items():
    print(f"[fronts-size] {aid} {json.dumps(size)}")
print(f"[fronts] {len(cells)} cells -> {job['out']}")
