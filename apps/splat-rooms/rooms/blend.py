# Blender helpers shared by bake.py (a room) and fronts.py (the catalog's contact sheet).
import bpy
from mathutils import Matrix, Vector

def import_asset(path, name):
    """Imports one glTF, sitting on z = 0 and centred on x, y, under an empty. Returns (empty, half-sizes, height)."""
    scene = bpy.context.scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in new if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    shift = Matrix.Translation(Vector(((lo.x + hi.x) / -2, (lo.y + hi.y) / -2, -lo.z)))
    root = bpy.data.objects.new(f"inst_{name}", None)
    scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.matrix_world = shift @ o.matrix_world
            o.parent = root
            o.matrix_parent_inverse = Matrix.Identity(4)
    return root, ((hi.x - lo.x) / 2, (hi.y - lo.y) / 2), hi.z - lo.z

def eevee():
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
