# blender -b --factory-startup -P shot.py -- in.glb out.png [focus 0..1 height share for the head view]
# Four ortho views of a GLB in one strip: full side, full front-3/4, head side, head front-3/4. Game frame is y up, +x forward;
# the glTF importer turns that into Blender z up, -y forward (+x game -> +x blender, game z -> blender -y).
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
focus = float(argv[2]) if len(argv) > 2 else 0.85
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = max(hi - lo)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 600, 600
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.33, 0.35, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
sc.world = w
for rot, e in (((50, 0, 40), 3.2), ((60, 0, 200), 1.2)):
    l = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    l.data.energy = e
    l.rotation_euler = [math.radians(a) for a in rot]
    sc.collection.objects.link(l)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
sc.collection.objects.link(cam)
sc.camera = cam
centre = (lo + hi) / 2
h = hi.z - lo.z
head_c = Vector((centre.x, centre.y, lo.z + h * focus))
head_s = max(h * 0.32, (hi.x - lo.x) * 0.5)
views = [(centre, size * 1.1, 90, 0), (centre, size * 1.1, 35, 15), (head_c, head_s, 90, 0), (head_c, head_s, 30, 8)]
frames = []
for i, (c, s, yaw, pitch) in enumerate(views):
    # yaw 90: looking at the beast's left side (game +z = blender -y), 0: from the front (+x)
    a, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.cos(a) * math.cos(p), -math.sin(a) * math.cos(p), math.sin(p)))
    cam.location = c + d * size * 4
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = s
    cam.data.clip_end = size * 10
    sc.render.filepath = f"{out}.{i}.png"
    bpy.ops.render.render(write_still=True)
