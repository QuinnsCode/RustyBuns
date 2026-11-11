import bpy, math, sys
from mathutils import Vector, Matrix
src, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x, scene.render.resolution_y = 1600, 800
scene.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); w.color = (0.62, 0.66, 0.72); scene.world = w
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
size = max(hi - lo)
for k, yaw in enumerate((-35, -75)):
    for o in objs:
        c = o.copy(); scene.collection.objects.link(c)
        c.matrix_world = Matrix.Translation(((k - 0.5) * size * 1.1, 0, 0)) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ o.matrix_world
for o in objs: o.hide_render = True
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4
sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40)); scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = size * 2.3
cam.location = (0, -size * 4, hi.z * 0.55 + size * 0.9); cam.rotation_euler = (math.radians(77), 0, 0)
scene.render.filepath = out; bpy.ops.render.render(write_still=True)
