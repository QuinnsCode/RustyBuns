# Headless Blender: each .glb named on the command line becomes a .usdz beside the given out dir.
#   blender -b --factory-startup --python-exit-code 1 -P scripts/usdz/convert.py -- <out-dir> a.glb b.glb ...
# USDZ is what iOS reads natively (RealityKit, SceneKit, Quick Look). Materials go out as UsdPreviewSurface,
# the one shader those read, which ignores vertex colours: a model painted that way gets them baked into a
# texture first. The file is turned Y-up, as glTF was before Blender made it Z-up.
import bpy, os, sys

BAKE_SIZE = 1024


def painted(obj):
    """A mesh whose materials take their colour from a colour attribute and no image."""
    if obj.type != "MESH" or not obj.data.color_attributes:
        return False
    trees = [m.node_tree for m in obj.data.materials if m and m.node_tree]
    nodes = [n.type for t in trees for n in t.nodes]
    return "VERTEX_COLOR" in nodes and "TEX_IMAGE" not in nodes


def bake_vertex_colours(obj):
    """Unwrap, bake the diffuse colour (vertex colours times any mix) into one image, and feed Base Color from it."""
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    obj.data.uv_layers.new(name="bake")
    obj.data.uv_layers.active = obj.data.uv_layers["bake"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new(f"{obj.name}_colour", BAKE_SIZE, BAKE_SIZE)
    targets = []
    for mat in {m for m in obj.data.materials if m and m.node_tree}:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        mat.node_tree.nodes.active = tex
        targets.append((mat, tex))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"})
    img.pack()
    for mat, tex in targets:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

args = sys.argv[sys.argv.index("--") + 1:]
out, files = args[0], args[1:]
os.makedirs(out, exist_ok=True)

for path in files:
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    baked = [o for o in list(bpy.data.objects) if painted(o)]
    for o in baked:
        bake_vertex_colours(o)
    dest = os.path.join(out, os.path.splitext(os.path.basename(path))[0] + ".usdz")
    bpy.ops.wm.usd_export(
        filepath=dest,
        export_materials=True,
        generate_preview_surface=True,
        export_mesh_colors=True,
        export_animation=bool(bpy.data.actions),
        export_armatures=True,
        export_shapekeys=True,
        convert_orientation=True,
        export_global_up_selection="Y",
        export_global_forward_selection="NEGATIVE_Z",
    )
    print(f"USDZ {dest} {os.path.getsize(dest)} meshes={sum(o.type == 'MESH' for o in bpy.data.objects)} actions={len(bpy.data.actions)} baked={len(baked)}")
