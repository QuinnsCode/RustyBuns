# Contact sheet of one GLB: side, front and three-quarter views in one PNG, flat light, grey ground.
# blender -b --factory-startup --python-exit-code 1 -P scripts/glb-sheet.py -- in.glb out.png
import bpy, sys, math
from mathutils import Vector

src, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh in " + src)
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
mid, size = (lo + hi) / 2, max((hi - lo).length, 0.001)

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 480, 480
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.85, 0.85, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3; sun.rotation_euler = (0.9, 0.2, 0.6)
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); cam.data.type = "ORTHO"; cam.data.ortho_scale = size * 1.1
sc.collection.objects.link(cam); sc.camera = cam

shots = []
for i, az in enumerate((90, 0, 45)):   # side, front, three-quarter
    a = math.radians(az)
    cam.location = mid + Vector((math.sin(a), -math.cos(a), 0.25)) * size * 2
    cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{out}.{i}.png"
    bpy.ops.render.render(write_still=True)
    shots.append(sc.render.filepath)

# Stitch the three renders into one strip.
imgs = [bpy.data.images.load(p) for p in shots]
w, h = imgs[0].size
strip = bpy.data.images.new("strip", w * 3, h)
px = [0.0] * (w * 3 * h * 4)
for k, im in enumerate(imgs):
    row = list(im.pixels)
    for y in range(h):
        s = y * w * 4
        px[(y * w * 3 + k * w) * 4:(y * w * 3 + k * w + w) * 4] = row[s:s + w * 4]
strip.pixels = px
strip.filepath_raw = out; strip.file_format = "PNG"; strip.save()
import os
for p in shots: os.remove(p)
print("sheet ->", out)
