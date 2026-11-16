# head close-ups (front, profile, three-quarter) of each GLB, framed by closeups.py's head box:
# blender -b --factory-startup -P faces.py -- <closeups.py> <in.glb> <out.png> [...]
import sys
argv = sys.argv[sys.argv.index("--") + 1:]
src = open(argv[0]).read().rsplit("\nmain()", 1)[0]
exec(compile(src, argv[0], "exec"))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene, cam = setup(600)
for glb, out in zip(argv[1::2], argv[2::2]):
    for o in list(scene.objects):
        if o.type != "CAMERA" and o.type != "LIGHT":
            bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    p = verts(meshes)
    hlo, hhi = head_box(p)
    hmid, hsize = (hlo + hhi) / 2, float(max(hhi - hlo)) * 1.4
    hmid[2] -= 0.12 * hsize
    paths = []
    for v, d in (("front", (1, 0, 0.1)), ("profile", (0, -1, 0.05)), ("tq", (0.85, -0.6, 0.2))):
        path = f"{out[:-4]}.{v}.png"
        shoot(scene, cam, hmid, hsize, d, path)
        paths.append(path)
    strip(paths, out, 600)
    print("FACES", out)
