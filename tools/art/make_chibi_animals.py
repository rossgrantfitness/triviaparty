"""Builds the placeholder chibi animals (dog, cat, bunny, frog) in Blender.

Run with Blender's Python (Blender 4.2+ or the `bpy` pip package):

    blender --background --python tools/art/make_chibi_animals.py
    # or: python tools/art/make_chibi_animals.py   (with `pip install bpy`)

Writes, per animal:
    art/source/animals/<animal>.blend         editable Blender file
    art/export/<animal>/<animal>.glb           model the game imports
    art/export/<animal>/<animal>_portrait.png  512 px picture for the phone

Every model is built from simple rounded shapes so it reads clearly from a couch.
Node layout (the host animates these by name):
    <animal>            root, origin between the feet
      body              squashes from the ground up
      head              pivots at the neck; ears, eyes and cheeks are its children
"""

import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Asagi-shu palette (colorcombinations.org/palettes/asagi-shu): asagi, shu, gofun, sumi.
ASAGI = "#6B9BB0"
SHU = "#D8453A"
GOFUN = "#F4EEE0"
SUMI = "#2B2B2B"

BLUSH = "#F0948A"
WHITE = "#FFFFFF"


def hex_rgba(value: str) -> tuple:
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*linear, 1.0)


_materials: dict = {}


def material(name: str, color: str, roughness: float = 0.6) -> bpy.types.Material:
    key = (name, color)
    if key in _materials:
        return _materials[key]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    _materials[key] = mat
    return mat


def _finish(obj, name, mat, parent):
    obj.name = name
    obj.data.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.shade_smooth()
    if parent is not None:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def ball(name, loc, scale, mat, parent=None, rot=(0, 0, 0), segments=None, rings=None):
    # Spend triangles where they show: big shapes smooth, tiny details cheap (budget: 8,000 per animal).
    size = max(scale)
    if segments is None:
        segments, rings = (10, 6) if size < 0.07 else (16, 8) if size < 0.17 else (24, 12)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    obj = bpy.context.active_object
    obj.scale = scale
    obj.rotation_euler = [math.radians(a) for a in rot]
    return _finish(obj, name, mat, parent)


def cone(name, loc, radius, depth, mat, parent=None, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=radius, radius2=radius * 0.18, depth=depth, location=loc)
    obj = bpy.context.active_object
    obj.rotation_euler = [math.radians(a) for a in rot]
    obj.scale = scale
    # Round off the cone a little so it reads as soft, not sharp.
    mod = obj.modifiers.new("soft", "SUBSURF")
    mod.levels = 1
    mod.render_levels = 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return _finish(obj, name, mat, parent)


def torus(name, loc, major, minor, mat, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8, location=loc)
    obj = bpy.context.active_object
    obj.rotation_euler = [math.radians(a) for a in rot]
    return _finish(obj, name, mat, parent)


def tube(name, points, radius, mat, parent=None):
    """A soft tube through the given points (tails)."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, p in zip(spline.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.active_object
    return _finish(obj, name, mat, parent)


def empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def set_origin(obj, point):
    bpy.context.scene.cursor.location = point
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = (0, 0, 0)


def on_head(head_center, head_radii, x, dz, out=0.0):
    """Point on the front (−Y) of the head ellipsoid at sideways x and height offset dz."""
    rx, ry, rz = head_radii
    inside = max(0.0, 1 - (x / rx) ** 2 - (dz / rz) ** 2)
    y = -ry * math.sqrt(inside) - out
    return Vector((head_center[0] + x, head_center[1] + y, head_center[2] + dz))


def face(head, center, radii, *, eye_x=0.15, eye_dz=-0.01, eye_scale=(0.058, 0.03, 0.078), blush_x=0.24, nose=SUMI, nose_scale=(0.028, 0.02, 0.02), muzzle=None):
    """Big shiny eyes, rosy cheeks, small nose: the kawaii face shared by all animals."""
    eye_mat = material("eye", SUMI, 0.15)
    shine = material("eye_shine", WHITE, 0.2)
    for side in (-1, 1):
        p = on_head(center, radii, side * eye_x, eye_dz, out=-0.012)
        ball(f"eye_{'l' if side < 0 else 'r'}", p, eye_scale, eye_mat, head)
        ball(f"eye_shine_{'l' if side < 0 else 'r'}", p + Vector((side * -0.016, -0.026, 0.03)), (0.02, 0.012, 0.022), shine, head)
        ball(f"eye_shine_small_{'l' if side < 0 else 'r'}", p + Vector((side * 0.018, -0.026, -0.03)), (0.01, 0.008, 0.01), shine, head)
        q = on_head(center, radii, side * blush_x, eye_dz - 0.085, out=-0.01)
        ball(f"blush_{'l' if side < 0 else 'r'}", q, (0.055, 0.012, 0.03), material("blush", BLUSH, 0.8), head)
    if muzzle:
        m = on_head(center, radii, 0, eye_dz - 0.1, out=-0.05)
        ball("muzzle", m, (0.11, 0.075, 0.075), material("muzzle", muzzle, 0.7), head)
        n = m + Vector((0, -0.07, 0.03))
    else:
        n = on_head(center, radii, 0, eye_dz - 0.07, out=-0.005)
    ball("nose", n, nose_scale, material("nose", nose, 0.3), head)


def standard_body(root, color, belly, *, arms=True, feet_color=None):
    body = ball("body", (0, 0, 0.27), (0.24, 0.21, 0.25), material("fur", color), root)
    set_origin(body, (0, 0, 0))
    ball("belly", (0, -0.12, 0.25), (0.16, 0.11, 0.17), material("belly", belly), body)
    feet = material("feet", feet_color or color)
    for side in (-1, 1):
        ball(f"foot_{'l' if side < 0 else 'r'}", (side * 0.11, -0.05, 0.05), (0.075, 0.1, 0.055), feet, body)
        if arms:
            ball(f"arm_{'l' if side < 0 else 'r'}", (side * 0.21, -0.06, 0.29), (0.06, 0.06, 0.09), material("fur", color), body, rot=(0, side * -25, 0))
    return body


def standard_head(root, color, *, center=(0, 0, 0.72), radii=(0.4, 0.34, 0.33)):
    head = ball("head", center, radii, material("fur", color), root, segments=32, rings=16)
    set_origin(head, (0, 0, 0.45))
    return head


# ---- The animals ----

def make_dog(root):
    orange, cream = "#D98A4E", GOFUN
    standard_body(root, orange, cream)
    body = bpy.data.objects["body"]
    c, r = (0, 0, 0.72), (0.4, 0.34, 0.33)
    head = standard_head(root, orange, center=c, radii=r)
    # Shiba face mask: cream cheeks and muzzle.
    for side in (-1, 1):
        ball(f"cheek_{'l' if side < 0 else 'r'}", on_head(c, r, side * 0.17, -0.13, out=-0.035), (0.12, 0.06, 0.085), material("muzzle", cream), head)
    for side in (-1, 1):
        cone(f"ear_{'l' if side < 0 else 'r'}", (side * 0.25, 0.02, 1.01), 0.13, 0.25, material("fur", orange), head, rot=(0, side * 22, 0))
        cone(f"ear_inner_{'l' if side < 0 else 'r'}", (side * 0.245, -0.03, 1.0), 0.08, 0.17, material("ear_inner", cream), head, rot=(-6, side * 22, 0))
    face(head, c, r, muzzle=cream)
    # Curly shiba tail and a shu-red collar.
    torus("tail", (0, 0.24, 0.4), 0.07, 0.035, material("fur", orange), body, rot=(70, 0, 0))
    torus("collar", (0, 0, 0.45), 0.185, 0.03, material("collar", SHU, 0.4), body)


def make_cat(root):
    white, orange, dark = GOFUN, "#E39A55", SUMI
    standard_body(root, white, "#FFFFFF")
    body = bpy.data.objects["body"]
    c, r = (0, 0, 0.72), (0.4, 0.34, 0.32)
    head = standard_head(root, white, center=c, radii=r)
    # Calico patches.
    ball("patch_orange", (-0.2, 0.0, 0.92), (0.2, 0.25, 0.14), material("patch_orange", orange), head, rot=(0, 25, 0))
    ball("patch_dark", (0.26, 0.05, 0.86), (0.13, 0.2, 0.12), material("patch_dark", dark), head, rot=(0, -35, 0))
    for side in (-1, 1):
        ear_color = orange if side < 0 else dark
        cone(f"ear_{'l' if side < 0 else 'r'}", (side * 0.23, 0.02, 0.99), 0.1, 0.19, material(f"ear_{ear_color}", ear_color), head, rot=(0, side * 18, 0))
        cone(f"ear_inner_{'l' if side < 0 else 'r'}", (side * 0.225, -0.022, 0.98), 0.058, 0.12, material("ear_inner", BLUSH), head, rot=(-6, side * 18, 0))
    face(head, c, r, nose="#E07A7A", nose_scale=(0.024, 0.016, 0.016))
    # Whiskers.
    for side in (-1, 1):
        for i, dz in enumerate((-0.07, -0.1)):
            p = on_head(c, r, side * 0.3, dz, out=0.0)
            ball(f"whisker_{side}_{i}", p + Vector((side * 0.04, -0.01, 0)), (0.07, 0.006, 0.006), material("whisker", SUMI), head, rot=(0, side * (8 if i else -8), side * 10))
    # Maneki-neko style shu collar with a golden bell, and a long tail.
    torus("collar", (0, 0, 0.45), 0.185, 0.03, material("collar", SHU, 0.4), body)
    ball("bell", (0, -0.2, 0.44), (0.04, 0.04, 0.04), material("bell", "#E8B84A", 0.25), body)
    tube("tail", [(0.05, 0.18, 0.12), (0.18, 0.3, 0.3), (0.12, 0.32, 0.55)], 0.035, material("patch_orange", orange), body)


def make_bunny(root):
    white, pink = "#FAF6EE", "#F2A7A0"
    standard_body(root, white, "#FFFFFF")
    body = bpy.data.objects["body"]
    c, r = (0, 0, 0.72), (0.38, 0.34, 0.33)
    head = standard_head(root, white, center=c, radii=r)
    for side in (-1, 1):
        ball(f"ear_{'l' if side < 0 else 'r'}", (side * 0.13, 0.03, 1.2), (0.075, 0.045, 0.26), material("fur", white), head, rot=(0, side * 12, 0))
        ball(f"ear_inner_{'l' if side < 0 else 'r'}", (side * 0.13, -0.008, 1.19), (0.042, 0.012, 0.19), material("ear_inner", pink), head, rot=(0, side * 12, 0))
    face(head, c, r, nose=pink, nose_scale=(0.026, 0.018, 0.018))
    ball("tail", (0, 0.22, 0.17), (0.08, 0.08, 0.08), material("fur", white), body)
    # Small shu ribbon on one ear.
    ball("ribbon_l", (0.2, -0.03, 1.02), (0.05, 0.025, 0.035), material("ribbon", SHU, 0.4), head, rot=(0, 30, 0))
    ball("ribbon_r", (0.28, -0.03, 1.06), (0.05, 0.025, 0.035), material("ribbon", SHU, 0.4), head, rot=(0, -30, 0))


def make_frog(root):
    green, belly = "#7DB58C", "#F1EBCF"
    standard_body(root, green, belly)
    body = bpy.data.objects["body"]
    c, r = (0, 0, 0.68), (0.44, 0.34, 0.28)
    head = standard_head(root, green, center=c, radii=r)
    # Frog eyes sit on top of the head.
    eye_white = material("eye_white", WHITE, 0.3)
    eye_mat = material("eye", SUMI, 0.15)
    shine = material("eye_shine", WHITE, 0.2)
    for side in (-1, 1):
        s = "l" if side < 0 else "r"
        ball(f"eye_bump_{s}", (side * 0.19, -0.04, 0.92), (0.13, 0.12, 0.12), material("fur", green), head)
        ball(f"eye_white_{s}", (side * 0.19, -0.1, 0.94), (0.1, 0.07, 0.1), eye_white, head)
        ball(f"eye_{s}", (side * 0.19, -0.165, 0.935), (0.055, 0.02, 0.07), eye_mat, head)
        ball(f"eye_shine_{s}", (side * 0.19 - side * 0.015, -0.182, 0.965), (0.018, 0.008, 0.02), shine, head)
        q = on_head(c, r, side * 0.27, -0.06, out=-0.01)
        ball(f"blush_{s}", q, (0.06, 0.012, 0.03), material("blush", BLUSH, 0.8), head)
    # Wide smile.
    mouth = on_head(c, r, 0, -0.1, out=-0.01)
    torus("mouth", mouth + Vector((0, 0, 0.06)), 0.1, 0.012, material("mouth", SUMI, 0.4), head, rot=(90, 0, 0))
    mouth_obj = bpy.data.objects["mouth"]
    # Keep only the lower half of the ring as a smile.
    bpy.context.view_layer.objects.active = mouth_obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    local_mid = mouth_obj.matrix_world.inverted() @ (mouth + Vector((0, 0, 0.06)))
    for v in mouth_obj.data.vertices:
        v.select = v.co.z > local_mid.z - 0.035
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Little lily-pad hat in shu? No: a tiny shu bandana keeps the palette.
    torus("bandana", (0, 0, 0.47), 0.2, 0.03, material("collar", SHU, 0.4), body)


ANIMALS = {"dog": make_dog, "cat": make_cat, "bunny": make_bunny, "frog": make_frog}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()


def setup_render(path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    scene.world = world

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 2.5
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1.8
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.9, -2.6, 1.25)
    cam.rotation_euler = (math.radians(80), 0, math.radians(19))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return [sun, cam]


def build(animal: str, render: bool = True) -> None:
    reset_scene()
    root = empty(animal)
    ANIMALS[animal](root)

    source_dir = os.path.join(ROOT, "art", "source", "animals")
    export_dir = os.path.join(ROOT, "art", "export", animal)
    os.makedirs(source_dir, exist_ok=True)
    os.makedirs(export_dir, exist_ok=True)

    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(export_dir, f"{animal}.glb"),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )

    extras = setup_render(os.path.join(export_dir, f"{animal}_portrait.png"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(source_dir, f"{animal}.blend"))
    if render:
        bpy.ops.render.render(write_still=True)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"[{animal}] exported, about {tris} triangles")
    del extras


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    names = [a for a in args if a in ANIMALS] or list(ANIMALS)
    for name in names:
        build(name, render="--no-render" not in args)
