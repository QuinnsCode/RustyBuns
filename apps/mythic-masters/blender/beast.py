# A beast from its sheet: `blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render]`.
# The sheet is a stick figure (nodes with a radius, links between them) that Blender's skin modifier
# wraps in flesh, plus parts (spikes, horns, eyes, wing membranes) laid on it. Out: public/models/<id>.glb
# at the sheet's triangle budget, and with --render a contact sheet (profile, front, three-quarter) in
# blender/out/<id>.png to judge it by eye. Sheets are in the game's frame: y up, facing +x, left = +z, metres.
#
# Every field below is optional; a sheet without it builds exactly as before.
#   sheet   ends: 1          a cap node past every chain end, so a muzzle, fist or tail tip reaches its radius
#           bridge: true     a halfway node on each link between two fat nodes at a branch (a torn trunk)
#           offset, scale    [x, y, z] metres and a number (or [x, y, z]) for the whole beast, parts and all
#           wings: n         how many wings the rig keeps (scripts/beasts.ts checks it like `feet`)
#           blend: 0.03      blobs and body rebuilt as one seamless skin from voxels this size
#           paint            [{nodes: [...], material}]: those nodes' flesh in another material
#           stripes          {along: [...], n, width: 0.5, material, below: -0.3}: bands across a chain's back;
#                            `side: "under"` bands its underside instead (faces turned down past `below`), each
#                            face kept when it sits within `reach` (0.05) of the skin a ray from the chain meets,
#                            so a body of blended blobs bands too; `phase` (0) shifts every band by that share of
#                            its spacing (bands between ribs)
#           black: true      the body may be truly black: no luminance floor (LUM[0]), no lift toward the belly's hue
#   blob    material, rot    its own material; [x, y, z] degrees of tilt (a shell, a brow)
#   horn    curve, bend      degrees it bends along its length, toward the `bend` direction (default up)
#           tip_base, flat   radius at its far end (> base: a club), section squashed to `flat` of its width
#           web, scallop,    horns in a row with the same `web` name (a fin's ribs) get a skin between each and the next,
#           web_thick        its free edge pulled in `scallop` (0.3) toward the root, `web_thick` (0.012) thick, in
#                            `web_mat` (the first rib's material), the settings read off the group's first rib
#   spikes  rows, spread     `rows` per point fanned `spread` degrees around the chain; `sweep` toward its
#           sweep, tilt      end, `tilt` out to the side (side rows on a shell, a crest off the centreline)
#   tuft    along, n, len, base, and rows, spread, sweep (1.5), curve (30), flat (0.3), sink (0.8),
#           material (the palette's `tuft`, else the body's): flat, curling fur along a chain, swept toward its last node. A tuft or
#           spike roots `sink` of the way out to the skin, a blob's where one covers the chain
#   lock    as a tuft, plus twist (40), groove (0.15), swing (18), curve (60), flat (0.45): a clump of hair broad and flat
#           at the root that twists as it curls to a soft round tip, grooved into strands, each a little
#           longer or shorter and swung aside from the next (a lion's mane)
#   membrane camber, puff    the middle lifted `camber` metres (up, or outward for a fin) and thickened to
#                            `puff`, tapering to `thick` at the rim: a cupped wing, a flipper
#           feathers         {from, to, n, len, base, curve, flat, tip, material}: a row of flat feathers out
#                            past the rim between two outline points, each a vane rounding off to a blunt
#                            tip `tip` (0.4) of its width; scallop_depth < 0 points outward; `rake` degrees
#                            swings each one in the membrane's plane toward `to` (negative: toward `from`),
#                            so primaries sweep back along the edge instead of standing out like a comb
#   scales  along, n, len,   overlapping flat plates along a chain, fanned like a tuft (`rows`, `spread`); each
#           base, overlap    is `len` long and `base` wide and lies `overlap` (0.5) flatter toward the chain's end
#   teeth   along, n, len,   small cones fanned along a muzzle chain's lip, hanging from the upper lip and,
#           base, gap,       with `lower`, rising from the lower; `gap` (0.6) is how far the lips sit from the
#           lower, side      chain's centre in its radius, `side` (0.7) how far out to the side the rows run
#   eye     at, off, r, rot  a ball; `r` as [x, y, z] squashes it to those radii and `rot` [x, y, z] degrees turns it
#                            (mirrored for the pair): a slanted almond eye
#   ear     at, off, dir,    a flat, cupped leaf from a node: `len` long, `width` wide, `tilt` degrees out to the
#           len, width,      side, `cup` degrees curled forward (mirror it for the pair); `thick` (0.12) makes it a
#           tilt, cup,       fleshy flap that deep in its width, rounded, with a lobe at the end, and `fold` (0)
#           thick, fold,     hollows it across, the edges swinging that share of the width forward; `point` (0)
#           point            narrows its last that share of the length straight in to a point (a wolf's ear)
#   ridge   at, off, dir,    a short curved ridge (a brow above an eye, a lip along a muzzle): `len` long, `base`
#           len, base,       thick, `curve` degrees toward `bend`; lies flat on the skin; its `material` defaults
#           curve, bend      to the body's
#   skull   at, off, dir,    a head that isn't a ball, lofted from the back of the skull to the nose: `len` long,
#           len, width,      `width` and `height` at the brow; `snout` (0.45) the muzzle's size at the tip in that,
#           height, snout,   `stop` (0.4) how far along the taper starts (a stop, then a muzzle); `flat` (0 round,
#           stop, flat,      1 a box) squares the section and flattens the crown; `droop` degrees the nose tilts down;
#           droop, jaw       `jaw` (0) how much deeper the muzzle hangs under the stop (a hound's lip, a horse's chin)
#           gape, teeth,     `gape` (0) degrees a lower jaw hangs open from a hinge under the stop, the gap lined in
#           tooth, mouth_mat `mouth_mat` (the palette's `mouth`, else `dark`); `teeth` per side along each lip,
#                            `tooth` [len, base] in metres, in `tooth_mat` (the palette's `fang`, `tooth`, else `claw`)
#   limb    along, radii,    a leg or arm lofted over a chain of nodes, tapering to the ankle: `radii` (metres, one per
#           calf, depth      node) is the half-width at each, `depth` (1) how deep fore to aft in that, `calf` (0) a
#                            bulge of that share of the radius a third of the way down. Thin the sheet's own leg nodes
#           shoulder, elbow  under it, or the skin tube shows through. List the `l_` nodes; `mirror` adds the twin.
#                            `shoulder` (0) swells the top by that share of the radius, `elbow` (0) each middle node
#                            (a knee or elbow), jutting back (-x) more than out
#   foot    at, form, len,   a paw, hoof, talon or web on a foot node (also a hand: any node), `mirror`ed like the rest.
#           width, toes,     `form` paw: a pad with `toes` bumps and `claw` cones (0 none); hoof: a wedge, `toes` 2 for a cleft
#           claw, spread,    hoof (`claw_mat` colours the claws); talon: `toes` (3) curved toes `spread` degrees apart and a hind claw; web: a flat fan between
#           sole             `toes` ribs. `len` forward (+x), `width` across, `sole` the part's floor in metres below the node
#   wing    hub, tips, body, a membrane that sags between finger bones: from `hub` (a wrist) a bone to each of `tips`
#           sag, scallop,    (points or nodes, leading edge first), panels between them closing on the `body` points;
#           bone, bone_mat,  each panel's far edge pulled in by `scallop` (0.25) and hung `sag` metres under its fingers,
#           thick            `bone` (0.02) the finger bones' radius, `thick` (0.015) the membrane's
#   palette a 6th value is glow strength: the GLB keeps the colour as emissive, strength apart
#   hide    pattern, size,   the body's material baked into a map finer than the mesh can colour (`bake_hide`). `size` is
#           colours, map     metres a scale, strand, fold, feather, plate or patch; colours sRGB; `map` px (512). Patterns
#                            and their `colours` (each pattern's example sheet is its row in blender/hides.py EXAMPLES):
#                              scales   [rim, cell]          Voronoi scales, domed, a dark seam (Tatzelwurm)
#                              skin     [crease]             leathery folds across the body, pebbled (Hodag)
#                              fur      [root, tip]          clumped strands along the body
#                              spots    [spot]               spots on plain skin
#                              feathers [tip band, vane]     staggered rows lying back, a shaft, chevron barbs; `width` (0.6)
#                                                            a feather's in its length, `girth` (0.3) metres round the body,
#                                                            `lie` "down" for an upright bird (tips toward the ground)
#                              bark     [fissure, ridge]     ridges split by fissures, `grain` "along" the body or "up" it
#                              shell    [rim, middle]        plates split by deep grooves, `rings` (6) growth rings each
#                              wet      [mottle, wart]       an amphibian's slick mottled skin, warts on `cover` (0.4) of cells
#                              velvet   [nap]                short pile: patches of nap and a fine grain, `size` a patch
#           spots, moss,     over any pattern: `spots` {size, colour, cover}; `moss` {colour, cover (0.5), size} in tufts
#           band             on the surfaces that face up; `band` {colour, width (0.2), soft (0.08)} a dorsal stripe from
#                            the crown down the spine (width: how far down the flanks, a share of the way round)
#           rough, bump,     The belly, paint and occlusion tone still multiply over the map. The pattern's height bakes
#           normal_map       a tangent-space normal map (`normal_map` px, default `map`; `bump` (1) scales its depth) and
#                            its gloss a roughness map at a quarter of `map`: `rough` [shiniest, dullest] (the pattern's own in
#                            ROUGH) sets the range, wet skin [0.4, 0.62]. `bun scripts/beasts.ts --swatch` shows them all
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
AO = 0.5  # the darkest baked occlusion leaves a surface: a fully shut crease keeps this share of its colour
LUM = (0.045, 0.4)  # the body's colour luminance (linear) stays within this
ENDS = (1.1, 0.6)  # how far past a chain end its cap node sits, and how big, in the end's radius
PALETTE = {}  # name -> (r, g, b, roughness, metalness[, glow]), colours in sRGB like a hex code


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    r, g, b, rough, metal, *glow = PALETTE[name]
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (linear(r), linear(g), linear(b), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    # small parts only read as different stuff when they shine differently: eyes wet, horns, claws, teeth and
    # hooves a clear glossy coat over their colour, a metal bright (low roughness gives it an env-map specular)
    if not glow and not metal:
        part = name.lower()
        if any(k in part for k in ("horn", "claw", "fang", "tooth", "teeth", "tusk", "hoof", "talon", "beak")):
            bsdf.inputs["Coat Weight"].default_value = 0.5
            bsdf.inputs["Coat Roughness"].default_value = 0.2
            bsdf.inputs["Roughness"].default_value = min(rough, 0.4)
    if "eye" in name.lower():
        bsdf.inputs["Coat Weight"].default_value = 1.0
        bsdf.inputs["Coat Roughness"].default_value = 0.05
        bsdf.inputs["Roughness"].default_value = min(rough, 0.2)
    if metal:
        bsdf.inputs["Roughness"].default_value = min(rough, 0.35)
    if glow:
        bsdf.inputs["Emission Color"].default_value = (linear(r), linear(g), linear(b), 1)
        bsdf.inputs["Emission Strength"].default_value = glow[0]
    return m


def obj(name, me, mat):
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material(mat))
    return o


def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def mirrored(name):
    return "r_" + name[2:] if name.startswith("l_") else name


def flip(v):
    return (v[0], v[1], -v[2])


# --- the body: a stick figure the skin modifier wraps ---------------------------------------------------

def body(sheet):
    nodes = dict(sheet["nodes"])
    for k, v in list(nodes.items()):
        if k.startswith("l_"):
            nodes[mirrored(k)] = [v[0], v[1], -v[2], v[3]]
    # in sheet order: a set's order follows Python's per-run string hashing, and the skin modifier's hull
    # (so the rigger's feet) follows the edge order
    links = [tuple(l) for l in sheet["links"]]
    links += [(mirrored(a), mirrored(b)) for a, b in links if a.startswith("l_") or b.startswith("l_")]
    if sheet.get("ends"):
        # the skin modifier caps a chain flat at its last node and the smoothing rounds that cap in, so an
        # end (a muzzle, a fist, a tail tip) comes out about its own radius short; a cap node past each end
        # puts the surface back where the sheet says. `ends` scales how far (1: about the node's radius).
        degree = {}
        for a, b in links:
            degree[a], degree[b] = degree.get(a, 0) + 1, degree.get(b, 0) + 1
        for a, b in list(links):
            for end, other in ((a, b), (b, a)):
                if degree[end] == 1 and end != sheet["root"]:
                    p, q = Vector(nodes[end][:3]), Vector(nodes[other][:3])
                    r = nodes[end][3]
                    tip = p + (p - q).normalized() * (r * sheet["ends"] * ENDS[0])
                    nodes[end + "~cap"] = [*tip, r * ENDS[1]]
                    links.append((end, end + "~cap"))
    if sheet.get("bridge"):
        # the skin modifier's hull can tear where a fat node meets several links (a chest with legs and a
        # neck on it), leaving the trunk in two pieces; a node halfway along each link between two fat nodes
        # (the far one at least half as thick) gives the hull room
        degree = {}
        for a, b in links:
            degree[a], degree[b] = degree.get(a, 0) + 1, degree.get(b, 0) + 1
        split = []
        for a, b in links:
            ra, rb = nodes[a][3], nodes[b][3]
            if max(degree[a], degree[b]) >= 3 and min(ra, rb) >= max(ra, rb) / 2:
                m = f"{a}~{b}"
                nodes[m] = [(x + y) / 2 for x, y in zip(nodes[a], nodes[b])]
                split += [(a, m), (m, b)]
            else:
                split.append((a, b))
        links = split
    o = skinned(sheet, nodes, links)
    if sheet.get("blobs"):
        o = blobs(o, sheet["blobs"], nodes)
        if sheet.get("blend"):
            # one skin over the body and its blobs, no seam: rebuilt from voxels `blend` metres across, then
            # smoothed (every blob takes the body's material)
            o.modifiers.new("remesh", "REMESH").voxel_size = sheet["blend"]
            sm = o.modifiers.new("smooth", "SMOOTH")
            sm.factor, sm.iterations = 0.5, 4
            apply_all(o)
            for f in o.data.polygons:
                f.material_index = 0
                f.use_smooth = True
    if sheet.get("paint") or sheet.get("stripes"):
        paint(o, sheet, nodes, links)
    return o, nodes, links


def skinned(sheet, nodes, links):
    names = list(nodes)
    me = bpy.data.meshes.new("body")
    me.from_pydata([tuple(nodes[n][:3]) for n in names], [(names.index(a), names.index(b)) for a, b in links], [])
    o = obj("body", me, sheet.get("material", "hide"))
    bpy.context.view_layer.objects.active = o
    skin = o.modifiers.new("skin", "SKIN")
    skin.branch_smoothing = sheet.get("branch_smoothing", 0.5)
    for i, n in enumerate(names):
        r = nodes[n][3]
        o.data.skin_vertices[0].data[i].radius = (r, r)
    o.data.skin_vertices[0].data[names.index(sheet["root"])].use_root = True
    apply_all(o)
    close_holes(o)
    o.modifiers.new("subsurf", "SUBSURF").levels = sheet.get("subsurf", 2)
    # the skin modifier leaves a boxy hull where limbs meet; a light pass on the dense mesh rounds it off
    # without shrinking the limbs (a heavy one eats them: the rigger then loses the feet)
    factor, passes = sheet.get("smooth", [0.3, 3])
    smooth = o.modifiers.new("smooth", "SMOOTH")
    smooth.factor, smooth.iterations = factor, passes
    apply_all(o)
    bpy.ops.object.shade_smooth()
    return o


def close_holes(o):
    """The skin modifier leaves holes where a fat node meets several links (the hull at a hip with a tail
    and two legs on it). Subsurf rounds a hole into a dent, and a voxel remesh (`blend`) floods through it:
    everything past the hole (the tail, the back legs) comes out as outside and vanishes. A face over each
    hole, wound to agree with the face next to it, closes the skin before either runs."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for f in bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)["faces"]:
        for l in f.loops:
            other = [x for x in l.edge.link_faces if x is not f]
            if other:
                if any(m.vert is l.vert for m in other[0].loops if m.edge is l.edge):
                    f.normal_flip()
                break
    bm.to_mesh(o.data)
    bm.free()


def paint(o, sheet, nodes, links):
    """Colour by region. `paint`: each listed node's flesh in a material (a face takes the node it's
    nearest; an `l_` name paints its twin too): legs, a muzzle, a horn or shell grown from body nodes.
    `stripes`: bands across a chain's back in a material, `n` of them, each `width` of its spacing,
    leaving the faces that turn down past `below` (the belly) alone. With `side: "under"` it bands only those
    faces, and a face is on the chain's flesh when it sits within `reach` of where a ray from the chain first
    meets the skin: a blended body's skin sits well past its node radii, and a leg or neck leaving the chain
    lies beyond that first crossing."""
    mats = [m.name for m in o.data.materials]

    def slot(name):
        if name not in mats:
            o.data.materials.append(material(name))
            mats.append(name)
        return mats.index(name)

    owner = {}
    for group in sheet.get("paint", []):
        for k in group["nodes"]:
            owner[k] = owner[mirrored(k)] = slot(group["material"])
    base = lambda k: k.split("~")[0]  # a cap or halfway node belongs to the node it grew from
    segs = [(a, b, Vector(nodes[a][:3]), Vector(nodes[b][:3])) for a, b in links]
    st = sheet.get("stripes")
    if st:
        radii = [nodes[k][3] for k in st["along"]]
        line = [Vector(nodes[k][:3]) for k in st["along"]]
        total = sum((y - x).length for x, y in zip(line, line[1:]))
        stripe = slot(st["material"])
        under, chain = st.get("side") == "under", set(st["along"])
        # cut the flesh square across the chain at every band's edges, so a band ends on a clean line
        # rather than on whichever faces the subdivision happened to leave there; underneath, only the flesh near
        # the band (a plane through the whole beast slices the wings and legs too, and a baked hide's unwrap of a
        # blended skin cut that way collapses to nothing)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        phase = st.get("phase", 0.0)
        for i in range(st["n"]):
            for edge in (i + phase, i + phase + st.get("width", 0.5)):
                at, run = edge * total / st["n"], 0.0
                if not 0 <= at <= total:
                    continue
                for x, y in zip(line, line[1:]):
                    if run + (y - x).length >= at or y is line[-1]:
                        u = (at - run) / max((y - x).length, 1e-9)
                        at_co = x.lerp(y, min(u, 1.0))
                        if under:
                            fs = [f for f in bm.faces if (f.calc_center_median() - at_co).length < 0.4]
                            geom = list({v for f in fs for v in f.verts}) + list({e for f in fs for e in f.edges}) + fs
                        else:
                            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=at_co, plane_no=(y - x).normalized())
                        break
                    run += (y - x).length
        bm.to_mesh(o.data)
        bm.free()
        # the skin as it is now, to find where a ray from the chain first comes out of the flesh
        skin = BVHTree.FromPolygons([v.co.copy() for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons]) if under else None
    for f in o.data.polygons:
        if f.material_index != 0:
            continue
        c = f.center
        near, best = 1e9, None
        for a, b, pa, pb in segs:
            ab = pb - pa
            t = max(0.0, min(1.0, (c - pa).dot(ab) / max(ab.length_squared, 1e-9)))
            d = (c - pa.lerp(pb, t)).length - (nodes[a][3] + (nodes[b][3] - nodes[a][3]) * t)
            if d < near:
                near, best = d, (a, b, t)
        a, b, t = best
        k = base(a if t < 0.5 else b)
        if k in owner:
            f.material_index = owner[k]
        if st and (f.normal.y < st.get("below", -0.3) if under else f.normal.y > st.get("below", -0.3)):
            # how far along the chain this face is (the nearest point on its polyline), and whether it's on
            # the chain's flesh at all rather than a leg or neck leaving it
            s, run, near, foot, bent = 0.0, 0.0, 1e9, None, False
            for j, (x, y, rx, ry) in enumerate(zip(line, line[1:], radii, radii[1:])):
                xy = y - x
                raw = (c - x).dot(xy) / max(xy.length_squared, 1e-9)
                u = max(0.0, min(1.0, raw))
                p = x.lerp(y, u)
                d = (c - p).length - (rx + (ry - rx) * u)
                if d < near:
                    near, s, foot = d, run + xy.length * u, p
                    bent = (raw < 0 and j > 0) or (raw > 1 and j < len(line) - 2)
                run += xy.length
            if under:
                # measured from the skin itself: the face sits within `reach` of the first skin the ray from
                # the chain's nearest point toward it meets (a leg's face lies past the belly's skin)
                out = c - foot
                hit = skin.ray_cast(foot, out.normalized(), out.length + 1.0)[0] if out.length > 1e-6 else None
                near = out.length - (hit - foot).length if hit is not None else 1e9
                # out past a bend's outside every face takes the joint's one spot on the chain (a solid block, not
                # bands), and a thigh blended into the belly is a leg's flesh, not the chain's: neither is banded
                if bent or not (base(a) in chain and base(b) in chain):
                    near = 1e9
            band = (s / total * st["n"] - st.get("phase", 0.0)) % 1 < st.get("width", 0.5)
            if near < st.get("reach", 0.05) and 0 < s < total and band:
                f.material_index = stripe
    if st and under:
        # an underside band is a few triangles wide once decimated, and the decimator would round its edges away:
        # the vertices along each band's border go in a `keep` group, which `low_poly` tells it to leave
        inside, outside = set(), set()
        for f in o.data.polygons:
            (inside if f.material_index == stripe else outside).update(f.vertices)
        o.vertex_groups.new(name="keep").add(sorted(inside & outside), 1.0, "REPLACE")


def blobs(o, spec, nodes):
    """Round flesh over the skin: an ellipsoid at a node (radii x, y, z) for a body too short and fat for
    the skin modifier, which boxes the hull where four limbs meet. The rigger fills the volume, so the
    overlap needs no union."""
    out = [o]
    for i, b in enumerate(spec):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1)
        bmesh.ops.scale(bm, vec=Vector(b["r"]), verts=bm.verts)
        if "rot" in b:  # degrees about x, y, z: a tilted shell, a slanted brow
            bmesh.ops.rotate(bm, cent=Vector(), verts=bm.verts, matrix=Euler([math.radians(a) for a in b["rot"]]).to_matrix())
        bmesh.ops.translate(bm, vec=Vector(nodes[b["at"]][:3]) + Vector(b.get("off", (0, 0, 0))), verts=bm.verts)
        me = bpy.data.meshes.new(f"blob{i}")
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(material(b["material"]) if "material" in b else o.data.materials[0])
        b = bpy.data.objects.new(f"blob{i}", me)
        bpy.context.collection.objects.link(b)
        out.append(b)
    bpy.ops.object.select_all(action="DESELECT")
    for x in out:
        x.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.join()
    return o


def vertex_ao(o, rays=24, reach=0.16):
    """Ambient occlusion per vertex, baked from rays: `rays` fixed cosine-weighted directions about each
    vertex's normal (a Fibonacci spiral, so every build is the same), each stopped by the beast's own mesh
    within `reach` of its longest side. Armpits, the join of a leg and a belly, under a jaw and the root of a
    horn come out dark; the open back stays white. Smoothed over the edges once so it doesn't speckle.
    Cycles' bake to a colour attribute does the same job but needs a scene, a light setup and seconds per beast."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    size = max(Vector(o.dimensions))
    dist = size * reach
    golden = math.pi * (3 - math.sqrt(5))
    local = []
    for i in range(rays):
        z = math.sqrt((i + 0.5) / rays)  # cosine-weighted: more rays near the normal
        r = math.sqrt(1 - z * z)
        local.append(Vector((r * math.cos(i * golden), r * math.sin(i * golden), z)))
    ao = []
    for v in bm.verts:
        n = v.normal.normalized() if v.normal.length > 1e-6 else Vector((0, 0, 1))
        frame = n.to_track_quat("Z", "Y")
        origin = v.co + n * (size * 0.002)
        hit = 0.0
        for d in local:
            _, _, _, t = tree.ray_cast(origin, frame @ d, dist)
            if t is not None:
                hit += 1 - t / dist
        ao.append(1 - hit / rays)
    for _ in range(4):
        ao = [(a + sum(ao[e.other_vert(v).index] for e in v.link_edges)) / (1 + len(v.link_edges)) for a, v in zip(ao, bm.verts)]
    bm.free()
    return ao


def shade(o, back, soft=(), belly=None, turn=-0.2, floor=LUM[0], lift=1.0):
    """One colour attribute, `tone`, multiplied into every material's base colour by the game: the baked
    occlusion everywhere, and on the body's material (`back`) the body's own colour, painted per vertex so
    colour borders blend instead of stepping along triangle edges: each `soft` material (a `paint` or
    `stripes` region) is folded into the body's material, its colour weighted by the share of a vertex's faces
    it covers and smoothed over the edges, so a leg's stocking or a stripe fades into the flesh over a
    triangle or two. `belly` is the underside in a second colour, blended by how far each point's normal turns
    down past `turn` (-1 straight down, 0 sideways): an animal's back darker than its front. Painted after the
    decimator (a colour attribute steers what it keeps, and Hodag's short legs pay). Every material's Base
    Color reads the attribute so the contact sheet matches. `lift` (at most) brightens the body's tone for a baked
    hide (`bake_hide`), as far as its brightest channel can go; returns the lift it used, which the map divides by.
    `floor` is the darkest the body's luminance may go (a sheet's `black: true` passes 0: a black dog stays black)."""
    mats = [x.name for x in o.data.materials]
    soft = [n for n in soft if n in mats and n != back and len(PALETTE[n]) < 6]
    slot = mats.index(back)
    weight = {n: [0.0] * len(o.data.vertices) for n in soft}
    count = [0] * len(o.data.vertices)
    body = set()
    for p in o.data.polygons:
        name = mats[p.material_index]
        if name == back or name in soft:
            body.update(p.vertices)
            for i in p.vertices:
                count[i] += 1
                if name in weight:
                    weight[name][i] += 1
        if name in soft:
            p.material_index = slot
    for n in soft:
        w = [x / max(c, 1) for x, c in zip(weight[n], count)]
        nbrs = [[] for _ in w]
        for e in o.data.edges:
            a, b = e.vertices
            nbrs[a].append(b)
            nbrs[b].append(a)
        for _ in range(2):
            w = [max(x, (x + sum(w[j] for j in nb)) / (1 + len(nb))) if nb else x for x, nb in zip(w, nbrs)]
        weight[n] = w
    for m in o.data.materials:
        bsdf = m.node_tree.nodes["Principled BSDF"]
        if not any(n.bl_idname == "ShaderNodeVertexColor" for n in m.node_tree.nodes):
            if m.name == back:
                bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
            attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
            attr.layer_name = "tone"
            mix = m.node_tree.nodes.new("ShaderNodeMix")
            mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
            mix.inputs["Factor"].default_value = 1
            mix.inputs["A"].default_value = bsdf.inputs["Base Color"].default_value
            m.node_tree.links.new(attr.outputs["Color"], mix.inputs["B"])
            m.node_tree.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    ao = vertex_ao(o)
    col = o.data.color_attributes.new("tone", "FLOAT_COLOR", "POINT")
    rgb = lambda n: [linear(c) for c in PALETTE[n][:3]]
    base, under = rgb(back), rgb(belly) if belly else None
    tones, flesh = [None] * len(o.data.vertices), []
    for v in o.data.vertices:
        k_ao = AO + (1 - AO) * ao[v.index]
        if v.index not in body:
            col.data[v.index].color = (k_ao, k_ao, k_ao, 1)
            continue
        c = list(base)
        # the mesh is in Blender's frame by now (z up)
        k = max(0.0, min(1.0, (turn + 0.15 - v.normal.z) / 0.3))
        k = k * k * (3 - 2 * k)
        if belly:
            c = [x + (y - x) * k for x, y in zip(c, under)]
        for n in soft:
            c = [x + (y - x) * min(1.0, weight[n][v.index]) for x, y in zip(c, rgb(n))]
        # countershading and a richer hue: the colour a little more saturated where light reaches it, and every
        # underside a step darker (an animal's belly sits in its own shadow) even without a `belly` colour
        g = sum(c) / 3
        c = [max(0.0, g + (x - g) * 1.2) for x in c]
        shade_down = 1 - 0.3 * (1 - v.normal.z) / 2 if v.normal.z < 0.2 else 1.0
        c = [x * (shade_down if not belly else 1.0) for x in c]
        # a near-white hide would clip under the sun and bloom to a blob, a near-black one has no value left to
        # shade: keep the body's luminance (linear) where light and occlusion can still show
        lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
        if lum > LUM[1]:
            c = [x * LUM[1] / lum for x in c]
        elif lum < floor:
            # lift a near-black hide toward the sheet's lighter colour (the belly's hue), not a flat grey
            hue = rgb(belly) if belly else [1, 1, 1]
            hl = (0.3 * hue[0] + 0.59 * hue[1] + 0.11 * hue[2]) or 1
            c = [x + (floor - lum) * h / hl for x, h in zip(c, hue)]
        tones[v.index] = [x * k_ao for x in c]
        flesh.append(v.index)
    lift = max(1.0, min(lift, 1 / max([max(tones[i]) for i in flesh] or [1])))
    for i in flesh:
        col.data[i].color = (*[x * lift for x in tones[i]], 1)
    o.data.color_attributes.active_color = col
    # the folded materials are used by no face now
    bpy.context.view_layer.objects.active = o
    for i in reversed(range(len(o.data.materials))):
        if o.data.materials[i].name in soft:
            o.active_material_index = i
            bpy.ops.object.material_slot_remove()
    return lift


# --- parts laid on the body ----------------------------------------------------------------------------

def cone(name, at, direction, length, base, mat, segments=6):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=base, radius2=0.0, depth=length, segments=segments)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = obj(name, me, mat)
    d = Vector(direction).normalized()
    o.matrix_world = Matrix.Translation(Vector(at) + d * (length / 2)) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    return o


def ball(name, at, r, mat, rot=None):
    """A sphere of radius `r`, or with `r` as [x, y, z] an egg squashed to those radii (an almond eye), turned
    by `rot` (x, y, z degrees)."""
    bm = bmesh.new()
    squash = isinstance(r, (list, tuple))
    bmesh.ops.create_uvsphere(bm, u_segments=12 if squash else 10, v_segments=7, radius=1 if squash else r)
    if squash:
        bmesh.ops.scale(bm, vec=Vector(r), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=Vector(), verts=bm.verts, matrix=Euler([math.radians(a) for a in rot]).to_matrix())
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = obj(name, me, mat)
    o.location = at
    return o


def bend_frame(d, bend):
    """The direction `d` and a unit vector square to it, toward `bend` (default up, or forward when d is
    nearly vertical): the plane a curved part bends in."""
    d = Vector(d).normalized()
    for b in ([Vector(bend)] if bend else []) + [Vector((0, 1, 0)), Vector((1, 0, 0))]:
        b = b - d * b.dot(d)
        if b.length > 1e-3:
            return d, b.normalized()
    return d, Vector((0, 0, 1))


def arc(at, d, b, length, angle, t):
    """The point `t` (0-1) along an arc of `length` leaving `at` along d and turning `angle` radians
    toward b, and the tangent and bend-side normal there."""
    th = angle * t
    if abs(angle) < 1e-6:
        return Vector(at) + d * (length * t), d, b
    r = length / angle
    p = Vector(at) + d * (r * math.sin(th)) + b * (r * (1 - math.cos(th)))
    return p, d * math.cos(th) + b * math.sin(th), -d * math.sin(th) + b * math.cos(th)


def tube(name, at, direction, length, base, tip, mat, curve=0, bend=None, flat=1.0, segments=6, rings=6, profile=None, fold=0.0,
         twist=0.0, groove=0.0, smooth=False):
    """A cone that curves and tapers: from radius `base` at `at` to `tip` at the far end (0 a point, more
    than base a club), bending `curve` degrees toward `bend` along the way, its section squashed to `flat`
    of its width in the bend direction (a tuft or a feather lies flat on what it bends toward). `profile`
    is instead a list of (how far along, radius in `base`) pairs, a ring at each: a feather's vane. `fold`
    cups the section across: its edges swing that share of the radius toward `bend` (a fleshy ear's hollow).
    `twist` turns the section that many degrees from root to tip, `groove` dents it that share in four places
    round (strands in a lock of hair), and `smooth` shades it smooth instead of faceted."""
    d, b = bend_frame(direction, bend)
    angle = math.radians(curve)
    verts, faces = [], []
    if profile:
        rings, tip = len(profile) - 1, profile[-1][1] * base
    for k in range(rings + 1):
        t, r = (profile[k][0], profile[k][1] * base) if profile else (k / rings, base + (tip - base) * k / rings)
        p, tan, nrm = arc(at, d, b, length, angle, t)
        if k == rings and tip <= 0:
            verts.append(tuple(p))
            break
        side = tan.cross(nrm)
        if twist:
            tw = math.radians(twist) * t
            side, nrm = side * math.cos(tw) + nrm * math.sin(tw), nrm * math.cos(tw) - side * math.sin(tw)
        for j in range(segments):
            a = 2 * math.pi * j / segments
            rr = r * (1 - groove * (0.5 + 0.5 * math.cos(4 * a))) if groove else r
            verts.append(tuple(p + side * (rr * math.cos(a)) + nrm * (rr * (flat * math.sin(a) + fold * math.cos(a) ** 2))))
    for k in range(rings):
        s0 = k * segments
        if k == rings - 1 and tip <= 0:
            apex = len(verts) - 1
            faces += [(s0 + j, s0 + (j + 1) % segments, apex) for j in range(segments)]
        else:
            s1 = s0 + segments
            faces += [(s0 + j, s0 + (j + 1) % segments, s1 + (j + 1) % segments, s1 + j) for j in range(segments)]
    faces.append(tuple(reversed(range(segments))))
    if tip > 0:
        faces.append(tuple(range(rings * segments, (rings + 1) * segments)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for f in me.polygons:
            f.use_smooth = True
    return obj(name, me, mat)


# a lock of hair along its length: (how far along, radius in its base): broad at the root, a little fuller
# a third of the way out, then rounding off to a soft tip instead of a cone's point
LOCK = [(0, 1.0), (0.15, 1.05), (0.35, 0.85), (0.55, 0.6), (0.72, 0.4), (0.86, 0.24), (0.95, 0.12), (1.0, 0.0)]


def ring_loft(name, rings, mat, closed_ends=True):
    """A mesh through rings of points, each ring the same count, caps fanned to the ring centres."""
    m = len(rings[0])
    verts = [tuple(p) for ring in rings for p in ring]
    faces = []
    for k in range(len(rings) - 1):
        s0, s1 = k * m, (k + 1) * m
        faces += [(s0 + j, s0 + (j + 1) % m, s1 + (j + 1) % m, s1 + j) for j in range(m)]
    if closed_ends:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            c = sum((Vector(q) for q in ring), Vector()) / m
            verts.append(tuple(c))
            first = 0 if rev else (len(rings) - 1) * m
            ci = len(verts) - 1
            faces += [((first + (j + 1) % m, first + j, ci) if rev else (first + j, first + (j + 1) % m, ci)) for j in range(m)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = True
    return obj(name, me, mat)


def section(c, side, up, w, h, flat, a, drop=0.0):
    """One ring point: an ellipse w wide and h high about c, squared up by `flat` (0 round, 1 a box) and with
    its crown pressed flat by `flat` as well. `drop` pulls the underside down by that share of h (a jaw)."""
    ca, sa = math.cos(a), math.sin(a)
    e = 2 + 4 * flat  # superellipse exponent: 2 round, 6 nearly square
    x = math.copysign(abs(ca) ** (2 / e), ca) * w
    y = math.copysign(abs(sa) ** (2 / e), sa) * h
    if sa > 0:
        y *= 1 - 0.35 * flat
    elif drop:
        y *= 1 + drop
    return c + side * x + up * y


def loft_frame(t):
    hint = Vector((1, 0, 0)) if abs(t.y) > 0.8 else Vector((0, 1, 0))
    side = t.cross(hint).normalized()
    up = side.cross(t).normalized()
    return side, up


def skull(name, at, d, p, mat):
    """A head lofted along d from the back of the skull: round at the back, widest at the brow, a stop,
    then a muzzle tapering to `snout` of the brow's size, an optional jaw hanging under it, the nose drooping."""
    d = Vector(d).normalized()
    side, up = loft_frame(d)
    length, w0, h0 = p["len"], p["width"], p["height"]
    snout, stop, flat, droop, jaw = p.get("snout", 0.45), p.get("stop", 0.4), p.get("flat", 0), p.get("droop", 0), p.get("jaw", 0)
    prof = [(0.0, 0.45, 0.55), (0.12, 0.85, 0.88), (0.28, 1.0, 1.0), (stop, 0.9, 0.9), (0.75, (1 + snout) / 2 * 0.8 + 0.1, (1 + snout) / 2 * 0.8), (0.94, snout, snout * 0.95), (1.0, snout * 0.55, snout * 0.5)]
    rings, seg, tilt = [], 12, math.radians(droop)
    for t, fw, fh in prof:
        c = at + d * (length * (t - 0.4)) - up * (length * math.sin(tilt) * max(0.0, t - stop) * 0.9)
        drop = jaw * max(0.0, min(1.0, (t - stop) / (1 - stop))) * (1 - max(0.0, (t - 0.9) * 8)) if jaw else 0.0
        rings.append([section(c, side, up, w0 * fw, h0 * fh, flat, 2 * math.pi * j / seg, drop) for j in range(seg)])
    head = ring_loft(name, rings, mat)
    if not p.get("gape"):
        return head
    return [head] + gaping_jaw(name, at, d, side, up, p, mat)


def gaping_jaw(name, at, d, side, up, p, mat):
    """An open mouth under a skull: a lower jaw hinged under the stop and swung `gape` degrees down, a dark
    lining filling the wedge between it and the skull's underside, and rows of teeth on both lips."""
    length, w0, h0, snout, stop = p["len"], p["width"], p["height"], p.get("snout", 0.45), p.get("stop", 0.4)
    g = math.radians(p["gape"])
    hinge = at + d * (length * (stop - 0.55)) - up * (h0 * 0.55)
    reach = length * (1.0 - stop + 0.1)  # hinge to the chin
    rot = Matrix.Rotation(-g, 3, side)
    jd, ju = rot @ d, rot @ up
    out, seg = [], 12
    # the lower jaw: wide at the hinge, tapering to a rounded chin, flatter than the skull
    prof = [(0.0, 0.8, 0.5), (0.3, 0.85, 0.45), (0.7, 0.55 + 0.3 * snout, 0.4), (0.92, 0.45 * snout + 0.2, 0.32), (1.0, 0.25, 0.18)]
    rings = [[section(hinge + jd * (reach * t) - ju * (h0 * fh * 0.4), side, ju, w0 * fw * 0.5, h0 * fh * 0.5, 0.4, 2 * math.pi * j / seg)
              for j in range(seg)] for t, fw, fh in prof]
    out.append(ring_loft(f"{name}_jaw", rings, p.get("jaw_mat", mat)))
    # the lining: rings across the gap, from the skull's palate down to the jaw's tongue line
    lining = p.get("mouth_mat", "mouth" if "mouth" in PALETTE else ("dark" if "dark" in PALETTE else None))
    if lining:
        rings = []
        for t, fw in ((0.0, 0.6), (0.45, 0.62), (0.8, 0.45), (0.95, 0.3)):
            top, low = hinge + d * (reach * t) + up * (h0 * 0.12), hinge + jd * (reach * t)
            mid, half = (top + low) / 2, max((top - low).length / 2, h0 * 0.08)
            rings.append([section(mid, side, (top - low).normalized(), w0 * fw * 0.5, half, 0.3, 2 * math.pi * j / seg) for j in range(seg)])
        out.append(ring_loft(f"{name}_mouth", rings, lining))
    n = p.get("teeth", 0)
    if n:
        tl, tb = p.get("tooth", (h0 * 0.25, h0 * 0.07))
        tooth = p.get("tooth_mat", next((k for k in ("fang", "tooth", "claw") if k in PALETTE), mat))
        for side_k in (1, -1):
            for j in range(n):
                t = 0.25 + 0.65 * j / max(1, n - 1)
                wf = 0.42 * (1 - 0.45 * t)  # the rows close in toward the chin
                upper = hinge + d * (reach * t) + up * (h0 * 0.1) + side * (w0 * wf * side_k)
                lower = hinge + jd * (reach * t) + ju * (h0 * 0.02) + side * (w0 * wf * 0.9 * side_k)
                big = 1.6 if j == n - 1 else 1.0  # the front pair are fangs
                out.append(cone(f"{name}_tu{side_k}{j}", upper, -up, tl * big, tb * big, tooth, segments=5))
                out.append(cone(f"{name}_tl{side_k}{j}", lower, ju, tl * 0.8, tb, tooth, segments=5))
    return out


def limb(name, pts, radii, depth, calf, mat, shoulder=0.0, elbow=0.0):
    """A tapered leg or arm over a chain of points: an elliptical section at each, radius from `radii`, and a
    calf swelling a third of the way down. Subdivided between the points so the taper and calf are smooth.
    The radius eases between nodes (no straight cone), the thigh is narrower across than deep and rounds out
    toward the ankle, and the top closes in a dome inside the body, so a thigh reads as muscle, not a slab."""
    path, rs = [], []
    n = 5
    # the top starts a quarter of its first span inside the body, so no rim shows where it joins
    pts = [pts[0] + (pts[0] - pts[1]) * 0.25] + list(pts)
    radii = [radii[0]] + list(radii)
    for i in range(len(pts) - 1):
        for k in range(n):
            u = k / n
            e = u * u * (3 - 2 * u)  # smoothstep: the taper settles at each node instead of kinking
            path.append(pts[i].lerp(pts[i + 1], u))
            rs.append(radii[i] + (radii[i + 1] - radii[i]) * (0.5 * u + 0.5 * e))
    path.append(pts[-1])
    rs.append(radii[-1])
    total = len(path) - 1
    joints = [(i + 1) * n / total for i in range(1, len(pts) - 2)]  # each middle node of the sheet's chain
    rings, seg = [], 16
    for i, c in enumerate(path):
        t = (path[min(i + 1, total)] - path[max(i - 1, 0)]).normalized()
        side, up = loft_frame(t)
        f = i / total
        bump = 1 + calf * math.exp(-((f - 0.35) / 0.18) ** 2)
        across = 0.78 + 0.22 * min(1.0, f / 0.6)  # narrow across at the thigh, round by the ankle
        dome = 1.0 if i >= 2 else (0.55 if i == 0 else 0.85)  # the buried top rings close like a cap
        bump += shoulder * math.exp(-((f - 0.14) / 0.1) ** 2)
        knob = sum(elbow * math.exp(-((f - fj) / 0.07) ** 2) for fj in joints)
        ring = [section(c, side, up, rs[i] * bump * across * dome, rs[i] * bump * depth * dome, 0.0, 2 * math.pi * j / seg) for j in range(seg)]
        if knob:
            # a knee or elbow: the joint's bone shows behind (-x) more than to the sides
            ring = [q + (q - c) * knob * (0.5 + 0.5 * max(0.0, -(q - c).normalized().x)) for q in ring]
        rings.append(ring)
    return ring_loft(name, rings, mat)


def foot_part(name, at, r, p, side, mat):
    """A paw, hoof, talon or web at a node. All lie on the floor `sole` metres under the node's centre
    (default its radius) and run forward, +x."""
    base = Vector(at)
    floor = base.y - p.get("sole", r)
    ln, wd = p["len"], p["width"]
    form = p.get("form", "paw")
    claw_mat = p.get("claw_mat", "claw" if "claw" in PALETTE else mat)  # `claw_mat`, else the palette's `claw`, else the foot's own
    out = []
    if form in ("paw", "hoof"):
        cleft = form == "hoof" and p.get("toes", 1) >= 2
        lobes = [-1, 1] if cleft else [0]
        for lobe in lobes:
            z = lobe * wd * 0.27 * side
            w = wd * (0.27 if cleft else 0.5)
            rings, seg = [], 10
            top = r * (1.4 if form == "hoof" else 0.9)
            prof = ([(0.0, 0.9, 0.0, 1.0), (0.25, 1.0, 0.0, 1.0), (0.85, 0.7, 0.0, 0.42), (1.0, 0.25, 0.0, 0.3)] if form == "hoof"
                    else [(0.0, 0.8, 0.1, 0.9), (0.3, 1.0, 0.0, 1.0), (0.8, 0.95, 0.0, 0.55), (1.0, 0.45, 0.0, 0.3)])
            for t, fw, _, fh in prof:
                c = Vector((base.x - ln * 0.35 + ln * t, floor + top * 0.5 * fh, base.z + z))
                s, u = Vector((0, 0, 1)), Vector((0, 1, 0))
                rings.append([section(c, s, u, w * fw, top * 0.5 * fh, 0.35 if form == "hoof" else 0.0, 2 * math.pi * j / seg) for j in range(seg)])
            out.append(ring_loft(f"{name}_{lobe}", rings, mat))
        if form == "paw":
            for j in range(p.get("toes", 3)):
                u = 0 if p.get("toes", 3) == 1 else 2 * j / (p.get("toes", 3) - 1) - 1
                tip = Vector((base.x + ln * (0.62 - 0.12 * abs(u)), floor + r * 0.3, base.z + u * wd * 0.36 * side))
                out.append(ball(f"{name}_t{j}", tip, r * 0.42, mat))
                if p.get("claw"):
                    out.append(cone(f"{name}_c{j}", tip + Vector((r * 0.2, 0, 0)), (1, -0.35, 0), p["claw"], r * 0.18, claw_mat))
    elif form == "talon":
        n, spread = p.get("toes", 3), p.get("spread", 40)
        for j in range(n):
            a = math.radians(spread * (j - (n - 1) / 2))
            d = Vector((math.cos(a), 0, math.sin(a) * side))
            start = Vector((base.x, floor + r * 0.4, base.z))
            out.append(tube(f"{name}_t{j}", start, d, ln, r * 0.55, r * 0.3, mat, curve=-12, bend=(0, 1, 0), segments=5, rings=3))
            tip = start + d * ln
            out.append(cone(f"{name}_c{j}", tip, d + Vector((0, -0.7, 0)), p.get("claw", ln * 0.35), r * 0.28, claw_mat))
        out.append(cone(f"{name}_h", Vector((base.x, floor + r * 0.4, base.z)), (-1, -0.15, 0), p.get("claw", ln * 0.35), r * 0.3, claw_mat))
    elif form == "web":
        n = max(3, p.get("toes", 4))
        pts = [(base.x - ln * 0.1, floor + r * 0.25, base.z + wd * 0.08 * side), (base.x - ln * 0.1, floor + r * 0.25, base.z - wd * 0.08 * side)]
        for j in range(n):
            u = 1 - 2 * j / (n - 1)
            pts.append((base.x + ln * (1 - 0.18 * abs(u)) - (0 if j % 2 == 0 else ln * 0.12), floor + r * 0.2, base.z + u * wd * 0.5 * side))
        out.append(sheet_face(name, [pts[0]] + pts[2:] + [pts[1]], r * 0.5, mat))
        for j in range(n):
            u = 1 - 2 * j / (n - 1)
            end = Vector((base.x + ln * (1 - 0.18 * abs(u)), floor + r * 0.3, base.z + u * wd * 0.5 * side))
            out.append(tube(f"{name}_r{j}", Vector((base.x, floor + r * 0.4, base.z)), end - Vector((base.x, floor + r * 0.4, base.z)), (end - Vector((base.x, floor + r * 0.4, base.z))).length, r * 0.3, r * 0.15, mat, segments=4, rings=2))
    else:
        raise ValueError(f"unknown foot form {form}")
    return out


def wing(name, hub, tips, body, p, mat):
    """A bat or pterosaur wing: bones from the hub to each tip, and a membrane in panels between them whose far
    edge is pulled in toward the hub (`scallop`) and hangs `sag` below the bones, deepest mid-panel, the
    way skin hangs between fingers."""
    hub = Vector(hub)
    ends = [Vector(q) for q in tips] + [Vector(q) for q in body]
    sag, scal = p.get("sag", 0.06), p.get("scallop", 0.25)
    rows, cols = 4, 5
    verts, faces = [], []
    for i in range(len(ends) - 1):
        a, b = ends[i], ends[i + 1]
        base = len(verts)
        for r in range(rows + 1):
            u = r / rows
            for c in range(cols + 1):
                v = c / cols
                edge = hub + ((a - hub).lerp(b - hub, v))
                hang = math.sin(math.pi * v)
                far = hub + (edge - hub) * (u * (1 - scal * hang * u))
                far.y -= sag * hang * (u ** 1.5)
                far.y -= sag * 0.15 * u
                verts.append(tuple(far))
        stride = cols + 1
        faces += [(base + r * stride + c, base + r * stride + c + 1, base + (r + 1) * stride + c + 1, base + (r + 1) * stride + c)
                  for r in range(rows) for c in range(cols)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = obj(name, me, mat)
    o.modifiers.new("solidify", "SOLIDIFY").thickness = p.get("thick", 0.015)
    apply_all(o)
    for f in o.data.polygons:
        f.use_smooth = True
    out = [o]
    for j, q in enumerate(tips):
        out.append(tube(f"{name}_b{j}", hub, Vector(q) - hub, (Vector(q) - hub).length, p.get("bone", 0.02), p.get("bone", 0.02) * 0.4,
                        p.get("bone_mat", mat), segments=5, rings=3))
    return out


def webbing(name, ribs, p, mat):
    """A fin's skin between consecutive ribs: each rib a list of points from root to tip along its arc, the
    panel between two following both and its free edge pulled in `scallop` toward the first rib's root."""
    hub, scal = ribs[0][0], p.get("scallop", 0.3)
    cols = 5
    verts, faces = [], []
    for a, b in zip(ribs, ribs[1:]):
        base = len(verts)
        rows = len(a) - 1
        for r in range(rows + 1):
            u = r / rows
            for c in range(cols + 1):
                v = c / cols
                q = a[r].lerp(b[r], v)
                verts.append(tuple(hub + (q - hub) * (1 - scal * math.sin(math.pi * v) * u * u)))
        stride = cols + 1
        faces += [(base + r * stride + c, base + r * stride + c + 1, base + (r + 1) * stride + c + 1, base + (r + 1) * stride + c)
                  for r in range(rows) for c in range(cols)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = obj(name, me, mat)
    o.modifiers.new("solidify", "SOLIDIFY").thickness = p.get("web_thick", 0.012)
    apply_all(o)
    for f in o.data.polygons:
        f.use_smooth = True
    return o


def scallop(points, start, depth):
    """A wing's trailing edge cut into scallops: between each pair of points from `start` on (around to
    the first), a point pulled in toward the middle by `depth` of the way, the way a bat's wing hangs
    between its fingers."""
    mid = sum((Vector(p) for p in points), Vector()) / len(points)
    out = []
    for i, p in enumerate(points):
        out.append(p)
        if i >= start:
            a, b = Vector(p), Vector(points[(i + 1) % len(points)])
            m = (a + b) / 2
            out.append(tuple(m.lerp(mid, depth)))
    return out


def sheet_face(name, points, thick, mat):
    """A membrane: one face through the points, given a little thickness."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in points], [], [list(range(len(points)))])
    o = obj(name, me, mat)
    o.modifiers.new("solidify", "SOLIDIFY").thickness = thick
    apply_all(o)
    return o


def membrane_normal(points, side):
    """The membrane's facing: up when it lies flat-ish, outward (+z on the left) when it stands up like a
    fin. The same on both sides of a mirrored pair, so a camber bulges the same way on each."""
    n = Vector()
    for i, p in enumerate(points):  # Newell's normal of the outline
        a, b = Vector(p), Vector(points[(i + 1) % len(points)])
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    n.normalize()
    if (n.y if abs(n.y) >= 0.2 else n.z * side) < 0:
        n = -n
    return n


def shell(name, points, rim, p, side, mat):
    """A membrane with volume: the outline filled in rings toward its middle, the middle lifted `camber`
    metres along its facing (a cupped wing, a curved flipper), and with `puff` the middle thickened to that
    many metres, tapering to `thick` at the rim. `feathers` lays a row of flat, slightly curved feathers out
    past the rim between two of the outline's points."""
    c = sum((Vector(q) for q in points), Vector()) / len(points)
    n = membrane_normal(points, side)
    camber = p.get("camber", 0)
    lift = lambda u: n * (camber * (1 - u * u))
    # a feather is a vane, not a spike: narrow at the quill, widest two thirds out, rounding off to a
    # blunt tip `tip` of its width (0: the old point)
    vane = [(0, 0.55), (0.35, 0.9), (0.65, 1.0), (0.88, 0.78), (1, p.get("feathers", {}).get("tip", 0.4))]
    us = (1.0, 2 / 3, 1 / 3)
    verts, faces, weight = [], [], []
    m = len(points)
    for u in us:
        for q in points:
            verts.append(tuple(c + (Vector(q) - c) * u + lift(u)))
            weight.append(1 - u * u)
    verts.append(tuple(c + lift(0)))
    weight.append(1)
    for k in range(len(us) - 1):
        faces += [(k * m + i, k * m + (i + 1) % m, (k + 1) * m + (i + 1) % m, (k + 1) * m + i) for i in range(m)]
    mid, last = len(verts) - 1, (len(us) - 1) * m
    faces += [(last + i, last + (i + 1) % m, mid) for i in range(m)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = obj(name, me, mat)
    thick, puff = p.get("thick", 0.02), p.get("puff", 0)
    solid = o.modifiers.new("solidify", "SOLIDIFY")
    solid.offset = 0
    if puff > thick:
        g = o.vertex_groups.new(name="puff")
        for i, w in enumerate(weight):
            g.add([i], w, "REPLACE")
        solid.vertex_group, solid.thickness, solid.thickness_vertex_group = "puff", puff, thick / puff
    else:
        solid.thickness = thick
    apply_all(o)
    for f in o.data.polygons:
        f.use_smooth = True
    out = [o]
    fs = p.get("feathers")
    if fs:
        # the rim from point `from` to point `to` (going round), feathers spaced evenly along it, each
        # pointing out of the membrane in its own plane and rooted a third of its length inside the rim
        ring = [rim[(fs["from"] + i) % len(rim)] for i in range((fs["to"] - fs["from"]) % len(rim) + 1)]
        pts = {str(i): (*q, 0) for i, q in enumerate(ring)}
        rake = math.radians(fs.get("rake", 0))
        for j, (at, _, e) in enumerate(along(pts, list(pts), fs["n"])):
            q = n.cross(e)
            if q.dot(at - c) < 0:
                q = -q
            if rake:
                # swung in the membrane's plane toward the row's end (`to`; a negative rake toward `from`), so the
                # feathers sweep back along the edge like a wing's primaries instead of standing out like a comb
                q = (q * math.cos(rake) + e * math.sin(rake)).normalized()
            ln = fs["len"] * (1 - 0.12 * (j % 3))  # a little ragged, the same every build
            root = at - q * (ln / 3)
            u = max(0.0, min(1.0, (root - c).length / max((at - c).length, 1e-6)))
            out.append(tube(f"{name}_f{j}", root + lift(u), q, ln, fs["base"], 0, fs.get("material", mat),
                            curve=fs.get("curve", 10), bend=-n * (1 if camber >= 0 else -1), flat=fs.get("flat", 0.25), segments=5, profile=vane))
    return out


def along(nodes, chain, n):
    """n points evenly spaced along the chain's polyline, each (position, radius, forward tangent)."""
    pts = [Vector(nodes[c][:3]) for c in chain]
    rs = [nodes[c][3] for c in chain]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    out = []
    for k in range(n):
        d = total * (k + 0.5) / n
        i = 0
        while i < len(seg) - 1 and d > seg[i]:
            d -= seg[i]
            i += 1
        t = d / seg[i] if seg[i] else 0
        out.append((pts[i].lerp(pts[i + 1], t), rs[i] + (rs[i + 1] - rs[i]) * t, (pts[i + 1] - pts[i]).normalized()))
    return out


def surface(nodes, blobs, at, r, up):
    """How far the flesh reaches from `at` along `up`: the chain's radius there, or further where a blob
    (an ellipsoid at a node, maybe tilted) lies over the chain, so a tuft or spike roots in the skin it
    shows through rather than deep inside a belly."""
    out = r
    for b in blobs:
        c = Vector(nodes[b["at"]][:3]) + Vector(b.get("off", (0, 0, 0)))
        m = Euler([math.radians(a) for a in b.get("rot", (0, 0, 0))]).to_matrix()
        p, d = m.transposed() @ (at - c), m.transposed() @ up
        p, d = Vector(x / y for x, y in zip(p, b["r"])), Vector(x / y for x, y in zip(d, b["r"]))
        # the far crossing of the unit sphere by the ray p + s d
        half, k = p.dot(d) / d.length_squared, (p.length_squared - 1) / d.length_squared
        if half * half - k >= 0:
            out = max(out, -half + math.sqrt(half * half - k))
    return out


def fan(nodes, blobs, p, side, sink, sweep):
    """Where each of a row of spikes or tufts along a chain grows: `n` along it, `rows` of them fanned
    `spread` degrees either side of the chain's top (a mane, a ruff, a moss mat, side rows on a shell),
    each swept `sweep` toward the chain's last node and tilted `tilt` out to the side. The top is the side
    facing up, or the back (-x) where the chain stands upright. Each roots `sink` of the way out to the
    flesh's surface (a blob's where one covers the chain). Yields (j, k, root, up, direction)."""
    chain = [mirrored(c) if side < 0 else c for c in p["along"]]
    rows, spread = p.get("rows", 1), math.radians(p.get("spread", 0))
    for j, (at, r, fwd) in enumerate(along(nodes, chain, p["n"])):
        top = Vector((0, 1, 0)) - fwd * fwd.y
        if top.length < 0.3:
            top = Vector((-1, 0, 0)) - fwd * -fwd.x
        top.normalize()
        for k in range(rows):
            a = spread * (2 * k / (rows - 1) - 1) if rows > 1 else 0
            up = Matrix.Rotation(a, 3, fwd) @ top
            d = up + fwd * p.get("sweep", sweep) + Vector((0, 0, p.get("tilt", 0) * side))
            yield j, k, at + up * (surface(nodes, blobs, at, r, up) * p.get("sink", sink)), up, d


def pointed(profile, share):
    """A leaf's (how far along, radius) profile narrowed to a point over its last `share` of the length: kept as
    it is up to there, then straight in to nothing at the tip (a wolf's, cat's or fox's ear, not a rabbit's)."""
    if share <= 0:
        return profile
    t0 = 1 - min(share, 0.95)
    keep = [(t, r) for t, r in profile if t < t0]
    k = next(i for i, (t, _) in enumerate(profile) if t >= t0)
    (ta, ra), (tb, rb) = profile[k - 1], profile[k]
    r0 = ra + (rb - ra) * (t0 - ta) / (tb - ta)
    return keep + [(t0 + (1 - t0) * u / 3, r0 * (1 - u / 3)) for u in range(3)] + [(1, 0)]


def resolve(nodes, p):
    return Vector(nodes[p][:3]) if isinstance(p, str) else Vector(p)


def parts(sheet, nodes):
    out, blobs = [], sheet.get("blobs", [])
    webs = {}  # (web name, side) -> (first rib's part, [each rib's points root to tip])
    for i, p in enumerate(sheet.get("parts", [])):
        for side in ([1, -1] if p.get("mirror") else [1]):
            s = lambda v: (v[0], v[1], v[2] * side)
            # a node name on the mirrored side is its r_ twin (already flipped); plain coordinates flip
            node = lambda k: tuple(nodes[mirrored(k) if side < 0 else k][:3]) if isinstance(k, str) else s(k)
            name = f"{p['kind']}{i}{'r' if side < 0 else ''}"
            if p["kind"] == "spikes" and not any(k in p for k in ("rows", "spread", "tilt")):
                for j, (at, r, fwd) in enumerate(along(nodes, p["along"], p["n"])):
                    top = at + Vector((0, surface(nodes, blobs, at, r, Vector((0, 1, 0))) * p.get("sink", 0.85), 0))
                    d = Vector((p.get("lean", -0.3), 1, 0))
                    out.append(cone(f"{name}_{j}", top, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "spikes":
                # side rows of shell spikes, a crest leaning off the centreline
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.85, 0.3):
                    out.append(cone(f"{name}_{j}_{k}", root, d, p["len"], p["base"], p["material"]))
            elif p["kind"] == "horn":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                d = Vector(s(p["dir"])).normalized()
                curve = math.radians(p.get("curve", 0))
                if any(k in p for k in ("curve", "tip_base", "flat")):
                    # an ox horn, a hooked beak, a club: bent `curve` degrees toward `bend`, `tip_base` thick at the end
                    bend = s(p["bend"]) if "bend" in p else None
                    out.append(tube(name, at, d, p["len"], p["base"], p.get("tip_base", 0), p["material"],
                                    curve=p.get("curve", 0), bend=bend, flat=p.get("flat", 1), segments=8, rings=8))
                    d, b = bend_frame(d, bend)
                else:
                    out.append(cone(name, at, d, p["len"], p["base"], p["material"]))
                    b = None
                if "web" in p:
                    rib = [arc(at, d, b, p["len"], curve, k / 6)[0] if b is not None else at + d * (p["len"] * k / 6) for k in range(7)]
                    webs.setdefault((p["web"], side), (p, []))[1].append(rib)
                # tines branch off the beam: [how far up it (0-1), direction, length], an antler not a spike
                for j, (t, td, tl) in enumerate(p.get("tines", [])):
                    root = arc(at, d, b, p["len"], curve, t)[0] if b is not None else at + d * (p["len"] * t)
                    out.append(cone(f"{name}_t{j}", root, s(td), tl, p["base"] * (1 - t) * 0.9, p["material"]))
            elif p["kind"] == "eye":
                at = Vector(node(p["at"])) + Vector(s(p["off"]))
                # a mirrored eye's turn is mirrored too: about x and y the other way, about z the same
                rot = (p["rot"][0] * side, p["rot"][1] * side, p["rot"][2]) if "rot" in p else None
                out.append(ball(name, at, p["r"], p["material"], rot))
            elif p["kind"] == "membrane":
                rim = pts = [node(q) for q in p["points"]]
                if "scallop" in p:
                    pts = scallop(pts, p["scallop"], p.get("scallop_depth", 0.25))
                if any(k in p for k in ("camber", "puff", "feathers")):
                    out += shell(name, pts, rim, p, side, p["material"])
                else:
                    out.append(sheet_face(name, pts, p.get("thick", 0.02), p["material"]))
            elif p["kind"] == "tuft":
                # fur: soft cones along a chain, flattened, swept back and curling onto the body; with
                # `spread` a fan of `rows` around the chain (a mane, a ruff) instead of one ridge
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.8, 1.5):
                    ln = p["len"] * (1 - 0.15 * ((j + k) % 3) / 2)  # ragged, the same every build
                    out.append(tube(f"{name}_{j}_{k}", root, d, ln, p["base"], 0,
                                    p.get("material", "tuft" if "tuft" in PALETTE else sheet.get("material", "hide")), curve=p.get("curve", 30),
                                    bend=-up, flat=p.get("flat", 0.3), segments=5, rings=3))
            elif p["kind"] == "lock":
                # hair in clumps: each lock broad and flat at the root, twisting as it curls back onto the body
                # to a soft round tip, grooved into strands; its length, curl and swing vary a little lock to
                # lock (the same every build), so a mane reads as hair and not as a pinecone's rows of plates
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.8, 1.5):
                    h = ((j * 7 + k * 13) % 11) / 10  # 0-1, a fixed scatter
                    g = ((j * 5 + k * 3) % 7) / 6
                    sw = math.radians(p.get("swing", 18) * (2 * g - 1))
                    d = Matrix.Rotation(sw, 3, up) @ d
                    out.append(tube(f"{name}_{j}_{k}", root, d, p["len"] * (0.8 + 0.4 * h), p["base"], 0,
                                    p.get("material", "tuft" if "tuft" in PALETTE else sheet.get("material", "hide")),
                                    curve=p.get("curve", 60) * (0.8 + 0.4 * g), bend=-up, flat=p.get("flat", 0.45),
                                    segments=8, profile=LOCK, twist=p.get("twist", 40) * (1 if (j + k) % 2 else -1),
                                    groove=p.get("groove", 0.15), smooth=True))
            elif p["kind"] == "scales":
                # plates: wide, flat and short, lying toward the chain's end, each over the one behind
                ov = p.get("overlap", 0.5)
                for j, k, root, up, d in fan(nodes, blobs, p, side, 0.9, 1 + 2 * ov):
                    out.append(tube(f"{name}_{j}_{k}", root, d, p["len"], p["base"], p["base"] * 0.5, p["material"],
                                    curve=20, bend=-up, flat=0.15, segments=6, rings=2))
            elif p["kind"] == "teeth":
                chain = [mirrored(c) if side < 0 else c for c in p["along"]]
                for j, (at, r, fwd) in enumerate(along(nodes, chain, p["n"])):
                    z = r * p.get("side", 0.7) * side
                    for lower in ([False, True] if p.get("lower") else [False]):
                        y = r * p.get("gap", 0.6) * (-1 if lower else 1)
                        out.append(cone(f"{name}_{j}{'l' if lower else 'u'}", at + Vector((0, y, z)),
                                        (0, 1 if lower else -1, 0), p["len"], p["base"], p["material"], segments=5))
            elif p["kind"] == "ear":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                d = Vector(s(p["dir"])).normalized() + Vector((0, 0, math.tan(math.radians(p.get("tilt", 0))) * side))
                if "thick" in p or "fold" in p:
                    # a fleshy flap: a rounded section `thick` of its width deep, cupped across by `fold`, a lobe at the end
                    out.append(tube(name, at, d.normalized(), p["len"], p["width"], 0, p["material"], curve=p.get("cup", 20),
                                    bend=Vector((1, 0, 0)), flat=p.get("thick", 0.12), segments=12, fold=p.get("fold", 0),
                                    profile=pointed([(0, 0.5), (0.2, 0.85), (0.5, 1.0), (0.78, 0.92), (0.93, 0.6), (1, 0.2)], p.get("point", 0))))
                else:
                    out.append(tube(name, at, d.normalized(), p["len"], p["width"], 0, p["material"], curve=p.get("cup", 20),
                                    bend=Vector((1, 0, 0)), flat=0.12, segments=6,
                                    profile=pointed([(0, 0.55), (0.4, 1.0), (0.75, 0.8), (1, 0.1)], p.get("point", 0))))
            elif p["kind"] == "ridge":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                bend = s(p["bend"]) if "bend" in p else None
                out.append(tube(name, at, Vector(s(p["dir"])).normalized(), p["len"], p["base"], 0, p.get("material", sheet.get("material", "hide")),
                                curve=p.get("curve", 0), bend=bend, flat=0.6, segments=5,
                                profile=[(0, 0.4), (0.3, 1.0), (0.7, 1.0), (1, 0.35)]))
            elif p["kind"] == "skull":
                at = Vector(node(p["at"])) + Vector(s(p.get("off", (0, 0, 0))))
                built = skull(name, at, s(p.get("dir", (1, 0, 0))), p, p.get("material", sheet.get("material", "hide")))
                out += built if isinstance(built, list) else [built]
            elif p["kind"] == "limb":
                chain = [mirrored(c) if side < 0 else c for c in p["along"]]
                out.append(limb(name, [Vector(nodes[c][:3]) for c in chain], p["radii"], p.get("depth", 1), p.get("calf", 0),
                                p.get("material", sheet.get("material", "hide")), p.get("shoulder", 0), p.get("elbow", 0)))
            elif p["kind"] == "foot":
                k = mirrored(p["at"]) if side < 0 else p["at"]
                out += foot_part(name, nodes[k][:3], nodes[k][3], p, side, p.get("material", sheet.get("material", "hide")))
            elif p["kind"] == "wing":
                out += wing(name, node(p["hub"]), [node(q) for q in p["tips"]], [node(q) for q in p["body"]], p, p["material"])
            else:
                raise ValueError(f"unknown part kind {p['kind']}")
    for (web, side), (first, ribs) in webs.items():
        if len(ribs) > 1:
            out.append(webbing(f"web_{web}{'r' if side < 0 else ''}", ribs, first, first.get("web_mat", first["material"])))
    return out


# --- out: one object, a GLB at the budget, a contact sheet ----------------------------------------------

def join(objs, name, sheet):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    if "scale" in sheet or "offset" in sheet:
        # the whole beast, parts and all: scaled about the ground under the origin, then moved
        k = sheet.get("scale", 1)
        o.data.transform(Matrix.Translation(sheet.get("offset", (0, 0, 0))) @ Matrix.Diagonal((*(k if isinstance(k, list) else [k] * 3), 1)))
    # the game's frame (y up, facing +x) into Blender's (z up); the glTF writer turns it back
    o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return o


def chains(sheet, nodes, links):
    """The sheet's stick figure in the mesh's frame (`join`'s scale, offset and turn), cut into chains: the runs of
    links between the nodes where three or more meet, or an end (a leg, the tail, the neck, the trunk). One
    (a, b, ra, rb, chain, ref) per link; `ref` is the side each chain's UV seam runs down: its underside, or for a
    chain that mostly stands up (a leg, a biped's trunk) its inner side, or its back on the midline."""
    k = sheet.get("scale", 1)
    k = k if isinstance(k, list) else [k] * 3
    off = Vector(sheet.get("offset", (0, 0, 0)))
    turn = Matrix.Rotation(math.pi / 2, 4, "X")
    at = {n: turn @ (Vector([v * s for v, s in zip(p[:3], k)]) + off) for n, p in nodes.items()}
    r = {n: p[3] * sum(k) / 3 for n, p in nodes.items()}
    degree = {}
    for a, b in links:
        degree[a], degree[b] = degree.get(a, 0) + 1, degree.get(b, 0) + 1
    # union the links through every node only two links meet at
    up = list(range(len(links)))

    def root(i):
        while up[i] != i:
            up[i] = up[up[i]]
            i = up[i]
        return i
    by_node = {}
    for i, (a, b) in enumerate(links):
        for n in (a, b):
            by_node.setdefault(n, []).append(i)
    for n, ls in by_node.items():
        if degree[n] == 2:
            up[root(ls[0])] = root(ls[1])
    ids, refs = {}, {}
    for i in range(len(links)):
        ids.setdefault(root(i), len(ids))
    for c in set(ids.values()):
        mine = [links[i] for i in range(len(links)) if ids[root(i)] == c]
        rise = sum(abs((at[b] - at[a]).z) for a, b in mine) / max(1e-6, sum((at[b] - at[a]).length for a, b in mine))
        y = sum(at[a].y + at[b].y for a, b in mine) / (2 * len(mine))
        if rise < 0.7:
            refs[c] = Vector((0, 0, -1))
        elif abs(y) > 0.02:
            refs[c] = Vector((0, -math.copysign(1, y), 0))
        else:
            refs[c] = Vector((-1, 0, 0))
    return [(at[a], at[b], r[a], r[b], ids[root(i)], refs[ids[root(i)]]) for i, (a, b) in enumerate(links)]


def chain_seams(o, slot, segs):
    """Seams on the body's faces (material `slot`) for one UV island a chain: each face goes to the chain it lies
    nearest the surface of, the labels are smoothed so a border doesn't zigzag, and the seams run along the borders
    and down each chain's `ref` side, where a ring round the chain's axis wraps. Every seam splits its vertices in
    the GLB, so a chain's cut is one line, not Smart UV Project's many islands (#4264)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    label, angle = {}, {}
    for f in bm.faces:
        if f.material_index != slot:
            continue
        c = f.calc_center_median()
        best = None
        for a, b, ra, rb, chain, ref in segs:
            ab = b - a
            t = max(0.0, min(1.0, (c - a).dot(ab) / max(ab.length_squared, 1e-12)))
            q = a + ab * t
            d = (c - q).length - (ra + (rb - ra) * t)
            if best is None or d < best[0]:
                best = (d, chain, q, ab, ref)
        _, chain, q, ab, ref = best
        axis = ab.normalized() if ab.length > 1e-9 else Vector((1, 0, 0))
        u = c - q
        u -= axis * u.dot(axis)
        down = ref - axis * ref.dot(axis)
        if down.length < 1e-6:
            down = axis.orthogonal()
        down.normalize()
        side = axis.cross(down)
        label[f.index] = chain
        # 0 straight up from `ref`, +-pi on it: the cut is where the sign flips with both near pi
        angle[f.index] = math.atan2(u.dot(side), -u.dot(down))
    for _ in range(3):  # a face outvoted by its neighbours joins them
        nxt = dict(label)
        for f in bm.faces:
            if f.index not in label:
                continue
            votes = {}
            for e in f.edges:
                for g in e.link_faces:
                    if g is not f and g.index in label:
                        votes[label[g.index]] = votes.get(label[g.index], 0) + 1
            if votes:
                top = max(votes, key=lambda k: (votes[k], k == label[f.index]))
                if top != label[f.index] and votes[top] > votes.get(label[f.index], 0) + 1:
                    nxt[f.index] = top
        label = nxt
    for e in bm.edges:
        fs = [f.index for f in e.link_faces if f.index in label]
        e.seam = False
        if len(fs) != 2:
            continue
        f, g = fs
        e.seam = label[f] != label[g] or (
            abs(angle[f]) > math.pi / 2 and abs(angle[g]) > math.pi / 2 and (angle[f] > 0) != (angle[g] > 0))
    bm.to_mesh(o.data)
    bm.free()


def unflat(o, slot):
    """The faces (material `slot`) of each UV island the unwrap couldn't lay flat: a closed shell no seam or edge opens
    (a knob, a ball off every chain's axis), or one it squashed into slivers (a thin wing membrane cut along its rim),
    whose UV edges run far longer than its UV area allows."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    lay = bm.loops.layers.uv["hide"]
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.material_index != slot or f0.index in seen:
            continue
        stack, island, opened = [f0], [], False
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                others = [g for g in e.link_faces if g is not f and g.material_index == slot]
                if e.seam or not others:
                    opened = True
                    continue
                for g in others:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)
        flat = edge = edge3 = 0.0
        for f in island:
            w = [l[lay].uv for l in f.loops]
            flat += abs(sum(w[i].x * w[i - 1].y - w[i - 1].x * w[i].y for i in range(len(w)))) / 2
            for l in f.loops:
                edge += (l.link_loop_next[lay].uv - l[lay].uv).length
                edge3 += l.edge.calc_length()
        area = sum(f.calc_area() for f in island)
        squashed = edge > 1.5 * edge3 * math.sqrt(flat / max(area, 1e-12))
        if not opened or squashed:
            out += [f.index for f in island]
    bm.free()
    return set(out)


def uv_islands(o, slot):
    """The faces (material `slot`) grouped by UV island: faces that share an edge with the same UVs on both sides."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    lay = bm.loops.layers.uv["hide"]
    seen, out = set(), []
    for f0 in bm.faces:
        if f0.material_index != slot or f0.index in seen:
            continue
        stack, island = [f0], []
        seen.add(f0.index)
        while stack:
            f = stack.pop()
            island.append(f.index)
            for l in f.loops:
                for m in l.edge.link_loops:
                    g = m.face
                    if g is f or g.index in seen or g.material_index != slot:
                        continue
                    if (l[lay].uv - m.link_loop_next[lay].uv).length < 1e-6 and (l.link_loop_next[lay].uv - m[lay].uv).length < 1e-6:
                        seen.add(g.index)
                        stack.append(g)
        out.append(island)
    bm.free()
    return out


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def canonical(o, step=float(os.environ.get("SNAP_STEP", "1e-3"))):
    """The decimator's result depends on how it is handed the mesh, and that changes run to run in ways nobody
    sees: a vertex a float's last bit apart (3e-8 m), faces, vertices and edges in another order, each face
    starting at another corner. So before and after it the mesh is rebuilt in one order: vertices snapped to
    1 mm and numbered by position, each face starting at its lowest vertex, faces by (material, corners), the
    edges made fresh from them. One sheet then always writes the same GLB. The step (1 mm; `SNAP_STEP`, metres) is
    chaotic too: it picks which valid decimation a beast gets, so scripts/beasts.ts tries a fixed list of steps in
    order and keeps the first whose rig matches the sheet."""
    me = o.data
    pos = [tuple(round(c / step) * step for c in v.co) for v in me.vertices]
    rank = {old: new for new, old in enumerate(sorted(range(len(pos)), key=lambda i: pos[i]))}
    faces = []
    for p in me.polygons:
        ids = [rank[i] for i in p.vertices]
        k = ids.index(min(ids))
        faces.append((p.material_index, ids[k:] + ids[:k], p.use_smooth))
    faces.sort(key=lambda f: f[:2])
    me.clear_geometry()
    me.from_pydata(sorted(pos), [], [f[1] for f in faces])
    me.polygons.foreach_set("material_index", [f[0] for f in faces])
    me.polygons.foreach_set("use_smooth", [f[2] for f in faces])
    me.update()


# --- a hide: scales, spots, fur or skin baked into a map -----------------------------------------------------
# A vertex is the smallest thing the tone can colour, so a pattern finer than the mesh lives in an image: the body's
# faces get their own UVs and procedural nodes (in the body's own space, metres) are baked into a map the body's
# material multiplies over the tone. The map is a share of the tone's colour, held at 1/lift, and the tone is lifted
# to match (as far as its brightest channel allows, at most HIDE_LIFT), so a mark lighter than the hide (a scale's
# rim) still fits in an 8-bit image.
HIDE_LIFT = 3.0
# each pattern's roughness at its shiniest and dullest part (the game reads under 0.6 as glazed: its rim light is strong)
ROUGH = {"scales": (0.62, 0.9), "skin": (0.7, 0.88), "fur": (0.92, 0.97), "spots": (0.8, 0.8), "feathers": (0.6, 0.85),
         "bark": (0.88, 0.97), "shell": (0.55, 0.85), "wet": (0.4, 0.62), "velvet": (0.95, 0.98)}


def hide_nodes(nt, h, base, lift):
    """The hide from nodes in `nt`: its colour as a multiple of the body's (`base`, sRGB) over `lift`, its height (0..1,
    for the normal map) and its roughness (0..1); returns the three sockets."""
    N, L = nt.nodes, nt.links
    size = h.get("size", 0.05)

    def ratio(c):  # a mark's colour as a multiple of the body's, per channel, in linear light, dimmed to fit the lift
        r = [linear(x) / max(linear(b), 1e-3) for x, b in zip(c, base)]
        return [x * min(1.0, lift / max(r)) for x in r]

    def node(kind, **props):
        n = N.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def value(v):
        n = node("ShaderNodeValue")
        n.outputs[0].default_value = v
        return n.outputs[0]

    def fl(x):
        return x if not isinstance(x, (int, float)) else value(x)

    def math_(op, a, b=0.0):
        n = node("ShaderNodeMath", operation=op)
        for s, x in zip(n.inputs, (a, b)):
            if isinstance(x, (int, float)):
                s.default_value = x
            else:
                L.new(x, s)
        return n.outputs[0]

    def ramp(x, lo, hi):  # smoothstep(lo, hi, x)
        n = node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        L.new(x, n.inputs["Value"])
        n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = lo, hi
        return n.outputs["Result"]

    def mix(f, a, b):  # colours: a where f is 0, b where 1; a and b are sockets or [r, g, b] multiples
        n = node("ShaderNodeMix", data_type="RGBA", blend_type="MIX", clamp_result=False)
        L.new(fl(f), n.inputs["Factor"])
        for s, c in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(c, list):
                s.default_value = (*c, 1)
            else:
                L.new(c, s)
        return n.outputs[2]

    def mix_f(f, a, b):  # floats (numbers or sockets): a where f is 0, b where 1
        return math_("ADD", a, math_("MULTIPLY", f, math_("SUBTRACT", b, a) if not isinstance(a, float) or not isinstance(b, float) else b - a))

    def scaled(col, k):  # a colour socket times a float socket
        n = node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY", clamp_result=False)
        n.inputs["Factor"].default_value = 1
        L.new(col, n.inputs[6])
        rgb = node("ShaderNodeCombineColor")
        for i in range(3):
            L.new(fl(k), rgb.inputs[i])
        L.new(rgb.outputs[0], n.inputs[7])
        return n.outputs[2]

    def noise(vec, scale, detail=2.0):
        n = node("ShaderNodeTexNoise")
        L.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value, n.inputs["Detail"].default_value = scale, detail
        return n

    def voronoi(vec, scale, feature="F1", jitter=1.0):
        n = node("ShaderNodeTexVoronoi", feature=feature)
        L.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value, n.inputs["Randomness"].default_value = scale, jitter
        return n

    def xyz(vec):  # a vector's three components
        n = node("ShaderNodeSeparateXYZ")
        L.new(vec, n.inputs[0])
        return n.outputs

    def vmath(op, a, b):  # two vector sockets (or b a tuple)
        n = node("ShaderNodeVectorMath", operation=op)
        L.new(a, n.inputs[0])
        if isinstance(b, tuple):
            n.inputs[1].default_value = b
        else:
            L.new(b, n.inputs[1])
        return n

    def red(col):
        n = node("ShaderNodeSeparateColor")
        L.new(col, n.inputs[0])
        return n.outputs[0]

    def warped(vec, amount, scale):  # the point nudged by a slow noise, so cells and spots aren't a lattice
        n = noise(vec, scale)
        off = node("ShaderNodeVectorMath", operation="SUBTRACT")
        L.new(n.outputs["Color"], off.inputs[0])
        off.inputs[1].default_value = (0.5, 0.5, 0.5)
        k = node("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        L.new(off.outputs[0], k.inputs[0])
        k.inputs[1].default_value = (amount, amount, amount)
        L.new(vec, k.inputs[2])
        return k.outputs[0]

    co = node("ShaderNodeTexCoord").outputs["Object"]
    cols = [ratio(c) for c in h.get("colours", [])]
    pattern = h["pattern"]
    one = [1.0, 1.0, 1.0]
    ht, gl = 0.5, 0.0  # height 0..1 for the normal map, gloss 0..1 (1 the shiniest part) for the roughness map
    if pattern == "scales":
        # cells (`colours[1]`, else the hide), each a little domed and its own shade, a rim (`colours[0]`) and a dark seam
        rim, mid = (cols + [[1.3, 1.3, 1.1], [1.0, 1.0, 1.0]][len(cols):])[:2]
        stretch = node("ShaderNodeVectorMath", operation="MULTIPLY")
        L.new(co, stretch.inputs[0])
        stretch.inputs[1].default_value = (0.8, 1.0, 1.0)  # a little longer along the body (+x) than around it
        p = warped(stretch.outputs[0], size * 0.25, 4.0 / size)
        # cells jittered 0.6 of the way: scales of a size, rounder than a cracked-mud mosaic
        cell = voronoi(p, 1.0 / size, jitter=0.6)
        edge = voronoi(p, 1.0 / size, "DISTANCE_TO_EDGE", jitter=0.6).outputs["Distance"]
        tint = math_("ADD", math_("MULTIPLY", red(cell.outputs["Color"]), 0.3), 0.85)  # each scale 0.85..1.15
        dome = math_("SUBTRACT", 1.08, math_("MULTIPLY", cell.outputs["Distance"], 0.35))
        c = scaled(mix(ramp(edge, 0.025, 0.09), rim, mid), math_("MULTIPLY", tint, dome))
        seam = math_("SUBTRACT", 1.0, ramp(edge, 0.0, 0.018))
        c = mix(seam, c, [0.55, 0.55, 0.5])
        # each scale a dome sunk into its seam; the plate takes a soft sheen, the seam is dull
        ht = math_("MULTIPLY", ramp(edge, 0.0, 0.07), math_("SUBTRACT", 1.0, math_("MULTIPLY", cell.outputs["Distance"], 0.5)))
        gl = ramp(edge, 0.0, 0.05)
    elif pattern == "spots":
        c = one
    elif pattern == "fur":
        # strands along the body (+x), clumped, dark at the roots (`colours[0]`) and light at the tips (`colours[1]`)
        dark, tip = (cols + [[0.6, 0.6, 0.6], [1.3, 1.3, 1.25]][len(cols):])[:2]
        s = node("ShaderNodeVectorMath", operation="MULTIPLY")
        L.new(co, s.inputs[0])
        s.inputs[1].default_value = (0.2, 1.0, 1.0)
        strands = noise(s.outputs[0], 1.0 / size, 4.0).outputs["Fac"]
        clump = noise(co, 0.25 / size, 1.0).outputs["Fac"]
        f = ramp(math_("ADD", math_("MULTIPLY", strands, 0.7), math_("MULTIPLY", clump, 0.3)), 0.3, 0.7)
        c = mix(f, dark, tip)
        ht = f  # strands stand proud of the roots
    elif pattern == "skin":
        # leathery: folds across the body (`colours[0]` in their creases), a fine pebbling between them
        crease = cols[0] if cols else [0.55, 0.55, 0.5]
        s = node("ShaderNodeVectorMath", operation="MULTIPLY")
        L.new(co, s.inputs[0])
        s.inputs[1].default_value = (2.5, 0.7, 0.7)  # a fold runs around the body, so it changes fastest along it (+x)
        n = noise(s.outputs[0], 1.0 / size, 1.0).outputs["Fac"]
        ridge = math_("ABSOLUTE", math_("SUBTRACT", math_("MULTIPLY", n, 2.0), 1.0))
        pebble = voronoi(co, 4.0 / size)
        bump = math_("ADD", 0.94, math_("MULTIPLY", red(pebble.outputs["Color"]), 0.12))
        fold = ramp(ridge, 0.0, 0.3)
        c = scaled(mix(fold, crease, one), bump)
        ht = math_("ADD", math_("MULTIPLY", fold, 0.8), math_("MULTIPLY", red(pebble.outputs["Color"]), 0.2))
        gl = fold  # a little greasy on the folds' crowns, dry down in the creases
    elif pattern == "feathers":
        # rows of feathers lying back toward the tail (-x), staggered like shingles: each a vane (`colours[1]`, else the
        # hide) whose rounded free tip carries a band (`colours[0]`) and shades the root of the one behind it, with a
        # pale shaft down its middle and barbs in a chevron off it; `size` is a feather's length, `width` (0.6) in that
        tipc, vane = (cols + [[0.7, 0.7, 0.7], [1.0, 1.0, 1.0]][len(cols):])[:2]
        p = warped(co, size * 0.08, 1.0 / size)
        x, y, z = xyz(p)
        # `lie` "back" (the default): rows along a long body, tips toward the tail; "down": an upright bird's, tips
        # toward the ground, the arc taken about the vertical
        along, a, b = (z, x, y) if h.get("lie") == "down" else (x, z, y)
        u = math_("DIVIDE", along, size)
        row, fx = math_("FLOOR", u), math_("FRACT", u)  # fx 0 at a feather's free tip .. 1 at its root (headward)
        # around the body: the arc about its long axis, so rows wrap a neck or a flank alike
        arc = math_("MULTIPLY", math_("ARCTAN2", a, b), h.get("girth", 0.3))
        w = math_("ADD", math_("DIVIDE", arc, size * h.get("width", 0.6)), math_("MULTIPLY", row, 0.5))
        fw = math_("SUBTRACT", math_("FRACT", w), 0.5)  # -0.5..0.5 across a feather
        free = math_("SUBTRACT", fx, math_("MULTIPLY", math_("MULTIPLY", fw, fw), 1.6))  # < 0: under the tip of the one ahead
        side = math_("ABSOLUTE", fw)
        barbs = math_("ADD", 0.5, math_("MULTIPLY", math_("SINE", math_("MULTIPLY", math_("ADD", math_("MULTIPLY", side, 2.5), fx), 6.283 * 6)), 0.5))
        shaft = math_("SUBTRACT", 1.0, ramp(side, 0.0, 0.035))
        out = ramp(free, 0.0, 0.03)  # 1 on this feather, 0 where the row ahead's tip lies over it
        c = mix(ramp(free, 0.12, 0.3), tipc, vane)
        c = scaled(c, math_("ADD", math_("MULTIPLY", barbs, 0.12), math_("ADD", 0.9, math_("MULTIPLY", shaft, 0.2))))
        c = mix(out, [0.45, 0.45, 0.45], c)
        ht = math_("MULTIPLY", out, math_("SUBTRACT", 1.0, math_("MULTIPLY", fx, 0.7)))  # tip proud, root tucked
        gl = math_("MULTIPLY", out, math_("ADD", 0.5, math_("MULTIPLY", barbs, 0.5)))
    elif pattern == "bark":
        # long ridges split by deep narrow fissures (`colours[0]`) running along the body (`grain` "along", the
        # default) or up it ("up": a tree-like beast standing), with the ridges' faces (`colours[1]`) cracked across
        fis, face = (cols + [[0.4, 0.38, 0.34], [1.0, 1.0, 1.0]][len(cols):])[:2]
        g = (0.15, 1.0, 1.0) if h.get("grain", "along") == "along" else (1.0, 1.0, 0.15)
        p = warped(vmath("MULTIPLY", co, g).outputs[0], size * 0.3, 1.0 / size)
        n = noise(p, 1.0 / size, 3.0).outputs["Fac"]
        ridge = math_("ABSOLUTE", math_("SUBTRACT", math_("MULTIPLY", n, 2.0), 1.0))
        split = ramp(ridge, 0.0, 0.14)
        cracks = voronoi(vmath("MULTIPLY", co, tuple(1.0 / x for x in g)).outputs[0], 0.25 / size, "DISTANCE_TO_EDGE").outputs["Distance"]
        face_ = math_("MULTIPLY", split, ramp(cracks, 0.0, 0.04))
        grit = noise(co, 6.0 / size, 2.0).outputs["Fac"]
        c = scaled(mix(face_, fis, face), math_("ADD", 0.82, math_("MULTIPLY", grit, 0.36)))
        ht = math_("MULTIPLY", face_, math_("ADD", 0.75, math_("MULTIPLY", grit, 0.25)))
    elif pattern == "shell":
        # plates (a turtle's scutes, an armadillo's bands) split by deep grooves (`colours[0]` at the rims), each
        # paler toward its middle (`colours[1]`) and lined with growth rings
        rim, mid = (cols + [[0.7, 0.68, 0.6], [1.15, 1.12, 1.0]][len(cols):])[:2]
        p = warped(co, size * 0.12, 1.0 / size)
        edge = voronoi(p, 1.0 / size, "DISTANCE_TO_EDGE", jitter=0.45).outputs["Distance"]
        groove = ramp(edge, 0.0, 0.04)
        rings = math_("ADD", 0.5, math_("MULTIPLY", math_("SINE", math_("MULTIPLY", edge, 6.283 * h.get("rings", 6) * 2)), 0.5))
        c = mix(ramp(edge, 0.04, 0.35), rim, mid)
        c = scaled(c, math_("ADD", 0.9, math_("MULTIPLY", rings, 0.12)))
        c = mix(math_("SUBTRACT", 1.0, groove), c, [0.4, 0.38, 0.34])
        ht = math_("SUBTRACT", math_("MULTIPLY", groove, math_("ADD", 0.6, math_("MULTIPLY", ramp(edge, 0.0, 0.3), 0.4))), math_("MULTIPLY", rings, 0.06))
        gl = math_("MULTIPLY", groove, math_("ADD", 0.6, math_("MULTIPLY", rings, 0.4)))
    elif pattern == "wet":
        # an amphibian's skin: blotchy mottling (`colours[0]`), scattered round warts (`colours[1]`, `cover` of
        # the cells, 0.4), and a slick shine that dulls a little on each wart
        mot, wart = (cols + [[0.65, 0.7, 0.55], [1.2, 1.15, 0.95]][len(cols):])[:2]
        m = ramp(noise(co, 0.3 / size, 3.0).outputs["Fac"], 0.48, 0.6)
        cell = voronoi(warped(co, size * 0.4, 1.0 / size), 1.0 / size)
        keep = math_("LESS_THAN", red(cell.outputs["Color"]), h.get("cover", 0.4))
        dome = math_("MULTIPLY", keep, math_("SUBTRACT", 1.0, ramp(cell.outputs["Distance"], 0.05, 0.3)))
        c = mix(dome, mix(m, one, mot), wart)
        slick = noise(co, 2.0 / size, 1.0).outputs["Fac"]
        ht = math_("ADD", math_("MULTIPLY", dome, 0.85), math_("MULTIPLY", m, 0.15))
        gl = math_("SUBTRACT", math_("ADD", 0.75, math_("MULTIPLY", slick, 0.25)), math_("MULTIPLY", dome, 0.35))
    elif pattern == "velvet":
        # short dense pile, a deer's antler velvet or a seal pup: no strands to see, only the nap's patches
        # catching the light differently (`colours[0]`, else a little darker) and a fine grain; `size` is the patch
        nap = cols[0] if cols else [0.86, 0.86, 0.86]
        patch = ramp(noise(co, 1.0 / size, 2.0).outputs["Fac"], 0.4, 0.65)
        grain = noise(co, 20.0 / size, 0.0).outputs["Fac"]
        c = scaled(mix(patch, one, nap), math_("ADD", 0.985, math_("MULTIPLY", grain, 0.03)))
        ht = math_("ADD", math_("MULTIPLY", grain, 0.15), math_("MULTIPLY", patch, 0.3))
    else:
        raise SystemExit(f"hide pattern {pattern!r}: {', '.join(ROUGH)}")
    # spots over any of them: `spots` {size, colour, cover}; a `pattern: "spots"` hide is spots on plain skin
    spots = h.get("spots") or ({"size": size, "colour": h["colours"][0]} if pattern == "spots" else None)
    if spots:
        ss = spots.get("size", size * 4)
        p = warped(co, ss * 0.35, 1.5 / ss)
        cell = voronoi(p, 1.0 / ss)
        keep = math_("LESS_THAN", red(cell.outputs["Color"]), spots.get("cover", 0.6))
        rnd = node("ShaderNodeSeparateColor")
        L.new(cell.outputs["Color"], rnd.inputs[0])
        rad = math_("ADD", 0.16, math_("MULTIPLY", rnd.outputs[1], 0.16))  # each spot 0.16..0.32 of a cell
        spot = math_("MULTIPLY", keep, math_("SUBTRACT", 1.0, ramp(math_("SUBTRACT", cell.outputs["Distance"], rad), -0.04, 0.04)))
        c = mix(spot, c, ratio(spots["colour"]))
    # moss over any of them: `moss` {colour, cover (0.5), size}: tufty patches settled on the surfaces that face up
    moss = h.get("moss")
    if moss:
        ms = moss.get("size", size * 3)
        up = ramp(xyz(node("ShaderNodeTexCoord").outputs["Normal"])[2], -0.3, 0.7)
        lump = noise(warped(co, ms * 0.3, 1.0 / ms), 1.0 / ms, 3.0).outputs["Fac"]
        cover = moss.get("cover", 0.5)
        on = ramp(math_("ADD", math_("MULTIPLY", lump, 0.7), math_("MULTIPLY", up, 0.6)), 1.25 - cover, 1.35 - cover)
        fuzz = noise(co, 12.0 / ms, 2.0).outputs["Fac"]
        c = mix(math_("MULTIPLY", on, math_("SUBTRACT", 1.0, math_("MULTIPLY", fuzz, 0.35))), c, ratio(moss["colour"]))
        ht = mix_f(on, fl(ht), math_("ADD", 0.55, math_("MULTIPLY", fuzz, 0.45)))
        gl = math_("MULTIPLY", fl(gl), math_("SUBTRACT", 1.0, on))
    # a dorsal band over any of them: `band` {colour, width (0.2), soft (0.08)}: the surfaces that face up, from the
    # crown of the head down the spine to the tail, in `colour`; `width` is how far down the flanks it reaches (a
    # share of the way round, 0.5 the whole top half), its edge feathered `soft` and a little ragged, like a wolf's saddle
    band = h.get("band")
    if band:
        nz = xyz(node("ShaderNodeTexCoord").outputs["Normal"])[2]
        rag = math_("MULTIPLY", math_("SUBTRACT", noise(co, 0.5 / size, 2.0).outputs["Fac"], 0.5), 0.25)
        edge = 1.0 - 2.0 * band.get("width", 0.2)
        soft = band.get("soft", 0.08)
        on = ramp(math_("ADD", nz, rag), edge - soft, edge + soft)
        c = mix(on, c, ratio(band["colour"]))
    # `rough` [shiniest, dullest]: the roughness the gloss runs between (the pattern's own in ROUGH; wet skin [0.4, 0.62], the slickest the rim light allows)
    shiny, dull = h.get("rough", ROUGH[pattern])
    rg = mix_f(fl(gl), dull, shiny)
    return scaled(c, 1.0 / lift), fl(ht), rg


def bake_hide(o, h, back, lift, segs=None):
    """The body's faces (material `back`) unwrapped, one island a chain of `segs` (`chains`; without them, a sphere
    in the swatch, Smart UV Project), and `hide` baked into a colour map its material multiplies over the tone, a
    tangent-space normal map and a roughness map."""
    px, t0 = h.get("map", 512), time.time()
    mats = [m.name for m in o.data.materials]
    slot = mats.index(back)
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    uv = o.data.uv_layers.new(name="hide")
    uv.active = uv.active_render = True  # the map is read and baked through these, whatever UVs the mesh came with
    # every face starts on one point: a new layer gives each face its own square, which splits all its vertices (the
    # other materials' faces stay there) and, on a face the unwrap skips, takes the whole map in the pack
    for d in uv.data:
        d.uv = (0.0, 0.0)

    def pick(faces):
        """Just `faces` selected for the next UV operator, in edit mode. Setting only the faces' flags isn't enough: the
        vertices an operator left selected select every face round them again, and a pack packs those too (the other
        materials' faces, each a zero-size island with its own margin: the Gevaudan's hide filled 11% of its map)."""
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bm = bmesh.from_edit_mesh(o.data)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            f.select_set(False)
        for f in bm.faces:
            if f.index in faces:
                f.select_set(True)
        bm.select_flush_mode()
        bmesh.update_edit_mesh(o.data)

    body = {p.index for p in o.data.polygons if p.material_index == slot}
    if segs:
        chain_seams(o, slot, segs)
        pick(body)
        bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, margin=4 / px)
        bpy.ops.object.mode_set(mode="OBJECT")
        left = o.data.uv_layers["hide"].data
        shut = unflat(o, slot) | {p.index for p in o.data.polygons if p.index in body and all(
            left[li].uv.length == 0 for li in p.loop_indices)}  # and any face the unwrap left where it started
        if shut:
            pick(shut)
            bpy.ops.uv.smart_project(angle_limit=math.radians(80), island_margin=4 / px, scale_to_bounds=False)
        # a shell of a few faces (a fur tuft, a knob) can't show a pattern but would take its own island and margin in
        # the pack (the Gevaudan's tufts made 300 of them): each takes one texel of the hide instead
        crumbs = {i for isl in uv_islands(o, slot) if len(isl) <= 8 for i in isl}
        pick(body - crumbs)
        bpy.ops.uv.average_islands_scale()  # one texel size everywhere, so a scale is as big on a toe as on the back
        bpy.ops.uv.pack_islands(rotate=True, margin=4 / px)
        bpy.ops.object.mode_set(mode="OBJECT")
        if crumbs:
            data = o.data.uv_layers["hide"].data
            biggest = max((p for p in o.data.polygons if p.index in body and p.index not in crumbs), key=lambda p: p.area)
            dot = sum((data[li].uv for li in biggest.loop_indices), Vector((0, 0))) / biggest.loop_total
            for p in o.data.polygons:
                if p.index in crumbs:
                    for li in p.loop_indices:
                        data[li].uv = dot
    else:
        pick(body)
        bpy.ops.uv.smart_project(angle_limit=math.radians(80), island_margin=4 / px, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(o.data)
    lay = bm.loops.layers.uv["hide"]
    area = sum(f.calc_area() for f in bm.faces if f.index in body)
    flat = 0.0
    for f in bm.faces:
        if f.index in body:
            w = [l[lay].uv for l in f.loops]
            flat += abs(sum(w[i].x * w[i - 1].y - w[i - 1].x * w[i].y for i in range(len(w)))) / 2
    bm.free()
    print(f"hide: {o.name.split('.')[0]}'s UVs cover {flat:.0%} of the map, {1000 * math.sqrt(area / max(flat, 1e-9)) / px:.2f} mm a texel")
    # bake from a copy holding only the body's faces, in a material that emits the pattern
    flesh = o.copy()
    flesh.data = o.data.copy()
    bpy.context.collection.objects.link(flesh)
    bm = bmesh.new()
    bm.from_mesh(flesh.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != slot], context="FACES")
    bm.to_mesh(flesh.data)
    bm.free()
    scene = bpy.context.scene
    engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device, scene.cycles.samples = "CPU", 1
    bpy.ops.object.select_all(action="DESELECT")
    flesh.select_set(True)
    bpy.context.view_layer.objects.active = flesh
    bake = bpy.data.materials.new("hide-bake")
    bake.use_nodes = True
    nt = bake.node_tree
    out, bsdf = nt.nodes["Material Output"], nt.nodes["Principled BSDF"]
    colour, height, rough = hide_nodes(nt, h, PALETTE[back][:3], lift)
    # the height as a bump on the flesh's own normals, baked to tangent space against the `hide` UVs
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = h.get("size", 0.05) * 0.15 * h.get("bump", 1.0)
    nt.links.new(height, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    glow = nt.nodes.new("ShaderNodeEmission")
    flesh.data.materials.clear()
    flesh.data.materials.append(bake)

    def bake_to(name, size, kind, socket=None):
        img = bpy.data.images.new(f"{o.name}-{name}", size, size, alpha=False)
        if kind == "NORMAL" or name == "rough":
            img.colorspace_settings.name = "Non-Color"
        target = nt.nodes.new("ShaderNodeTexImage")
        target.image = img
        nt.nodes.active = target
        if socket:
            nt.links.new(socket, glow.inputs["Color"])
            nt.links.new(glow.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
        bpy.ops.object.bake(type=kind, normal_space="TANGENT", margin=max(2, size // 128), use_clear=True)
        img.pack()
        nt.nodes.remove(target)
        return img

    # the colour at `map` px, the normal beside it (a scale's dome is as fine as its rim), roughness at a quarter: it changes slowly
    img = bake_to("hide", px, "EMIT", colour)
    rmap = bake_to("rough", max(64, px // 4), "EMIT", rough)
    nmap = bake_to("normal", h.get("normal_map", px), "NORMAL")
    scene.render.engine = engine
    print(f"hide: {h['pattern']} baked into {px} px colour and normal maps and a {rmap.size[0]} px roughness map in {time.time() - t0:.1f} s")
    bpy.data.objects.remove(flesh)
    bpy.data.materials.remove(bake)
    # the body's material: the map times the tone (`shade` wired Base Color to a multiply of the tone already), the
    # roughness from the map's green channel (glTF's metallicRoughness reads green) and the normal in tangent space
    m = o.data.materials[slot]
    N, L = m.node_tree.nodes, m.node_tree.links
    principled = N["Principled BSDF"]
    tex = N.new("ShaderNodeTexImage")
    tex.image = img
    mul = next(n for n in N if n.bl_idname == "ShaderNodeMix" and n.blend_type == "MULTIPLY")
    L.new(tex.outputs["Color"], mul.inputs[6])
    rt, sep = N.new("ShaderNodeTexImage"), N.new("ShaderNodeSeparateColor")
    rt.image = rmap
    L.new(rt.outputs["Color"], sep.inputs[0])
    L.new(sep.outputs["Green"], principled.inputs["Roughness"])
    nt_, nm = N.new("ShaderNodeTexImage"), N.new("ShaderNodeNormalMap")
    nt_.image, nm.space, nm.uv_map = nmap, "TANGENT", "hide"
    L.new(nt_.outputs["Color"], nm.inputs["Color"])
    L.new(nm.outputs["Normal"], principled.inputs["Normal"])
    # the map's mean colour over the texels the body covers, in the GLB's extras: a skin drawn without the map (the
    # world's merged walkers, beasts.ts `mergedSkin`) multiplies its tone by this instead, or the lifted tone glares
    # (an 8-bit map's pixels read back as stored, sRGB, and the game's tone is linear)
    import numpy as np
    pix = np.empty(px * px * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    rgb = pix.reshape(-1, 4)[:, :3]
    rgb = rgb[rgb.sum(axis=1) > 1e-3]
    rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m["hide_mean"] = [round(float(x), 4) for x in (rgb.mean(axis=0) if len(rgb) else np.ones(3))]
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    return img


def low_poly(o, budget):
    """A copy of `o` decimated to `budget` triangles and shaded smooth: the mesh the GLB holds."""
    bpy.ops.object.select_all(action="DESELECT")
    lod = o.copy()
    lod.data = o.data.copy()
    bpy.context.collection.objects.link(lod)
    # the decimator's result depends on the order it is handed the mesh in, which changes run to run: put the
    # mesh in canonical order before and after, so one sheet always builds the same GLB
    canonical(lod)
    if budget and tris(o) > budget:
        dec = lod.modifiers.new("decimate", "DECIMATE")
        dec.ratio = budget / tris(o)
        if "keep" in lod.vertex_groups:  # an underside band's borders (`paint`): collapse everywhere but there
            dec.vertex_group, dec.invert_vertex_group = "keep", True
        apply_all(lod)
        canonical(lod)
    # the low-poly skin shades smooth: normals weighted by face area, as if taken from a smooth proxy
    lod.modifiers.new("normals", "WEIGHTED_NORMAL").weight = 50
    apply_all(lod)
    return lod


def write_glb(o, path, budget, tone=None, hide=None, keep=False, segs=None, hard=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lod = low_poly(o, budget)
    if hard:
        # an underside band (`hard`, its material) only a triangle or two wide: its border split, so `shade` paints it
        # full strength to the edge instead of halving it on every vertex it shares with the flesh beside it
        split_border(lod, hard)
    lift = shade(lod, *tone, lift=HIDE_LIFT if hide else 1.0)
    if hide:
        bake_hide(lod, hide, tone[0], lift, segs)
    bpy.ops.object.select_all(action="DESELECT")
    lod.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_normals=True, export_materials="EXPORT",
                              export_vertex_color="ACTIVE", export_image_format="JPEG", export_jpeg_quality=85,
                              export_extras=bool(hide))
    print(f"{tris(lod)} triangles -> {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB)")
    if keep:
        return lod
    bpy.data.objects.remove(lod)


def split_border(o, name):
    mats = [m.name for m in o.data.materials]
    if name not in mats:
        return
    k = mats.index(name)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and (e.link_faces[0].material_index == k) != (e.link_faces[1].material_index == k)]
    bmesh.ops.split_edges(bm, edges=edges)
    bm.to_mesh(o.data)
    bm.free()


def render(o, path, silhouette=False):
    """Three of it in a row (profile, facing you, three-quarter) by a 1 m post, in one PNG."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH" if silhouette else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1500, 600
    scene.render.film_transparent = False
    # no filmic roll-off: a glowing part keeps its colour as the game draws it (three.js, no tone mapping)
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    world.color = (0.62, 0.66, 0.72)
    scene.world = world
    if silhouette:  # flat black on white: only the outline reads
        sh = scene.display.shading
        sh.light, sh.color_type, sh.single_color, sh.show_cavity, sh.show_object_outline = "FLAT", "SINGLE", (0, 0, 0), False, False
        world.color = (1, 1, 1)
        scene.view_settings.view_transform = "Standard"
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40))
    scene.collection.objects.link(sun)
    lo, hi = [Vector(c) for c in (o.bound_box[0], o.bound_box[6])]
    size, height = max(hi - lo), hi.z
    w = max(size, height) * 1.25
    for k, yaw in enumerate((0, -90, -135)):
        c = o.copy()
        scene.collection.objects.link(c)
        c.location = ((k - 1) * w, 0, 0)
        c.rotation_euler = (0, 0, math.radians(yaw))
    o.hide_render = True
    post = bpy.data.objects.new("post", bpy.data.meshes.new("post"))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, radius1=0.015, radius2=0.015, depth=1, segments=6)
    bm.to_mesh(post.data)
    bm.free()
    post.location = (-1.5 * w - 0.2, 0, 0.5)
    scene.collection.objects.link(post)
    if not silhouette:
        ground = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=w * 4)
        bm.to_mesh(ground.data)
        bm.free()
        scene.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    d = 4.4 * w
    cam.location = (0, -d, height * 0.5 + d * 0.22)
    cam.rotation_euler = (Vector((0, 0, height * 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"render -> {os.path.relpath(path)}")


def close(o, path):
    """The GLB's own mesh up close: the flank and head from the front three-quarter, filling the frame (a hide is
    judged here; the contact sheet shows the shape)."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    scene.view_settings.view_transform = "Standard"
    if not scene.world:
        scene.world = bpy.data.worlds.new("world")
    scene.world.color = (0.62, 0.66, 0.72)
    for x in scene.objects:
        if x.type == "MESH":
            x.hide_render = x is not o
    if not any(x.type == "LIGHT" for x in scene.objects):
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 4
        sun.rotation_euler = (math.radians(50), math.radians(-15), math.radians(-40))
        scene.collection.objects.link(sun)
    lo, hi = [o.matrix_world @ Vector(c) for c in (o.bound_box[0], o.bound_box[6])]
    mid = (lo + hi) / 2
    cam = bpy.data.objects.new("close", bpy.data.cameras.new("close"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    d = max(hi - lo) * 1.7
    cam.location = mid + Vector((0.55, -1.0, 0.35)).normalized() * d
    cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"render -> {os.path.relpath(path)}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: blender -b --factory-startup -P blender/beast.py -- beasts/<id>.json [--render] [--silhouette]")
    with open(argv[0]) as f:
        sheet = json.load(f)
    PALETTE.update(sheet["palette"])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bod, nodes, links = body(sheet)
    beast = join([bod, *parts(sheet, nodes)], sheet["id"], sheet)
    lo, hi = [Vector(c) for c in (beast.bound_box[0], beast.bound_box[6])]
    print(f"{sheet['id']}: {tris(beast)} triangles, {hi.x - lo.x:.2f} long, {hi.y - lo.y:.2f} wide, {hi.z:.2f} tall")
    soft = [g["material"] for g in sheet.get("paint", [])] + ([sheet["stripes"]["material"]] if sheet.get("stripes") else [])
    tone = (sheet.get("material", "hide"), soft, sheet.get("belly"), sheet.get("belly_turn", -0.2), 0.0 if sheet.get("black") else LUM[0])
    hide, lod = sheet.get("hide"), None
    lod = write_glb(beast, os.path.join(APP, "public", "models", sheet["id"] + ".glb"), sheet.get("budget", 3000), tone, hide,
                    keep=bool(hide) or "--close" in argv, segs=chains(sheet, nodes, links) if hide else None,
                    hard=sheet["stripes"]["material"] if sheet.get("stripes", {}).get("side") == "under" else None)
    if lod and not hide:
        lod.hide_render = True  # kept only for the close-up; the contact sheet draws the full mesh
    if "--render" in argv:
        # a baked hide is drawn on the GLB's own mesh (the map is unwrapped onto it), every other beast on the full one
        if not hide:
            shade(beast, *tone)
        beast.hide_render = bool(hide)
        render(lod if hide else beast, os.path.join(HERE, "out", sheet["id"] + ".png"))
    if "--close" in argv:
        close(lod, os.path.join(HERE, "out", sheet["id"] + ".close.png"))
    if "--silhouette" in argv:
        render(beast, os.path.join(HERE, "out", sheet["id"] + ".silhouette.png"), silhouette=True)


if __name__ == "__main__":  # blender/hides.py imports the builder without building a beast
    main()
