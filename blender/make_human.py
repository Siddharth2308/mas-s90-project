"""Build Pie's human body with MPFB (MakeHuman for Blender), save a .blend and render previews.

Usage: blender --background --python blender/make_human.py -- [skin]
Needs the MPFB extension and the asset packs (see install_packs.py). All assets are CC0.
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from bl_ext.blender_org.mpfb.services import FaceService, HumanService, ObjectService, TargetService

HERE = Path(__file__).resolve().parent
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# --- who they are ---
PHENOTYPE = {
    'gender': 0.5,      # 0 = feminine, 1 = masculine
    'age': 0.5,         # 0.5 = 25 years
    'muscle': 0.5,
    'weight': 0.5,
    'proportions': 0.5,
    'height': 0.5,
    'cupsize': 0.5,
    'firmness': 0.5,
    'race': {'asian': 1 / 3, 'caucasian': 1 / 3, 'african': 1 / 3},
}
SKIN = argv[0] if argv else 'young_caucasian_male'
# MakeHuman only ships light and dark skin textures; tint the light one to a warm mid-tone.
TINTS = {'body': (0.80, 0.60, 0.46), 'short02': (0.22, 0.17, 0.14)}
LOOK = {
    'eyes': 'high-poly.mhclo',
    'eyebrows': 'eyebrow001.mhclo',
    'eyelashes': 'eyelashes01.mhclo',
    'teeth': 'teeth_base.mhclo',
    'tongue': 'tongue01.mhclo',
    'hair': 'short02.mhclo',
    'clothes': ['male_casualsuit06.mhclo', 'shoes01.mhclo'],  # plain white tee + jeans
}
CYBORG_GLOW = (0.33, 0.9, 1.0)  # matches the app's 0x55e6ff
CYBORG_STRENGTH = 3.0

# Emotions the app blends (character.js), mixed from ARKit face units.
EMOTIONS = {
    'Angry': {'browDownLeft': 1, 'browDownRight': 1, 'noseSneerLeft': 0.9, 'noseSneerRight': 0.9,
              'mouthPressLeft': 0.8, 'mouthPressRight': 0.8, 'eyeSquintLeft': 0.7, 'eyeSquintRight': 0.7,
              'mouthFrownLeft': 0.5, 'mouthFrownRight': 0.5, 'mouthUpperUpLeft': 0.3, 'mouthUpperUpRight': 0.3},
    'Surprised': {'browInnerUp': 1, 'browOuterUpLeft': 1, 'browOuterUpRight': 1,
                  'eyeWideLeft': 1, 'eyeWideRight': 1, 'jawOpen': 0.35},
    'Sad': {'browInnerUp': 1, 'browDownLeft': 0.3, 'browDownRight': 0.3, 'mouthFrownLeft': 1, 'mouthFrownRight': 1,
            'mouthShrugLower': 0.7, 'mouthStretchLeft': 0.2, 'mouthStretchRight': 0.2,
            'eyeLookDownLeft': 0.3, 'eyeLookDownRight': 0.3, 'eyeBlinkLeft': 0.2, 'eyeBlinkRight': 0.2},
    'Smug': {'mouthSmileLeft': 1, 'mouthDimpleLeft': 0.5, 'mouthPressRight': 0.4, 'browOuterUpLeft': 0.7,
             'browDownRight': 0.6, 'eyeSquintLeft': 0.5, 'eyeSquintRight': 0.5,
             'eyeBlinkLeft': 0.15, 'eyeBlinkRight': 0.15},
    'Happy': {'mouthSmileLeft': 0.9, 'mouthSmileRight': 0.9, 'cheekSquintLeft': 0.5, 'cheekSquintRight': 0.5},
    'Bored': {'eyeBlinkLeft': 0.45, 'eyeBlinkRight': 0.45, 'mouthRollLower': 0.3, 'mouthLeft': 0.2},
    'Pain': {'browInnerUp': 0.7, 'browDownLeft': 0.5, 'browDownRight': 0.5, 'eyeSquintLeft': 1, 'eyeSquintRight': 1,
             'eyeBlinkLeft': 0.45, 'eyeBlinkRight': 0.45, 'mouthStretchLeft': 0.8, 'mouthStretchRight': 0.8,
             'mouthUpperUpLeft': 0.5, 'mouthUpperUpRight': 0.5, 'noseSneerLeft': 0.5, 'noseSneerRight': 0.5, 'jawOpen': 0.15},
    'Wince': {'eyeBlinkLeft': 0.85, 'eyeBlinkRight': 0.85, 'eyeSquintLeft': 1, 'eyeSquintRight': 1,
              'cheekSquintLeft': 0.7, 'cheekSquintRight': 0.7, 'noseSneerLeft': 0.6, 'noseSneerRight': 0.6,
              'mouthStretchLeft': 0.6, 'mouthStretchRight': 0.6, 'mouthPressLeft': 0.4, 'mouthPressRight': 0.4},
    'Disgust': {'noseSneerLeft': 1, 'noseSneerRight': 1, 'mouthUpperUpLeft': 0.8, 'mouthUpperUpRight': 0.8,
                'browDownLeft': 0.5, 'browDownRight': 0.5, 'mouthFrownLeft': 0.4, 'mouthFrownRight': 0.4,
                'mouthShrugUpper': 0.4, 'eyeSquintLeft': 0.4, 'eyeSquintRight': 0.4},
    'Contempt': {'mouthSmileLeft': 0.9, 'mouthDimpleLeft': 1, 'mouthPressLeft': 0.5, 'noseSneerLeft': 0.35,
                 'eyeSquintLeft': 0.45, 'eyeSquintRight': 0.45, 'browDownRight': 0.5, 'browOuterUpLeft': 0.35,
                 'eyeLookDownLeft': 0.25, 'eyeLookDownRight': 0.25},
    'Cold': {'eyeSquintLeft': 0.6, 'eyeSquintRight': 0.6, 'mouthPressLeft': 0.9, 'mouthPressRight': 0.9,
             'browDownLeft': 0.5, 'browDownRight': 0.5, 'mouthRollLower': 0.35, 'mouthRollUpper': 0.2,
             'cheekSquintLeft': 0.2, 'cheekSquintRight': 0.2},
    'Fear': {'browInnerUp': 1, 'browOuterUpLeft': 0.4, 'browOuterUpRight': 0.4, 'eyeWideLeft': 1, 'eyeWideRight': 1,
             'mouthStretchLeft': 0.7, 'mouthStretchRight': 0.7, 'jawOpen': 0.15},
    'Blink': {'eyeBlinkLeft': 1, 'eyeBlinkRight': 1},
    'MouthOpen': {'jawOpen': 1},
}


def mix_shape_key(obj, name, recipe):
    """Add shape key `name` = Basis + weighted sum of existing keys' offsets."""
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else {}
    parts = [(keys[k], w) for k, w in recipe.items() if k in keys]
    if not parts:
        return
    n = len(obj.data.vertices)
    basis = np.empty(n * 3, np.float32)
    keys['Basis'].data.foreach_get('co', basis)
    co = basis.copy()
    tmp = np.empty_like(basis)
    for key, w in parts:
        key.data.foreach_get('co', tmp)
        co += (tmp - basis) * w
    new = obj.shape_key_add(name=name, from_mix=False)
    new.data.foreach_set('co', co)
    new.value = 0


def tint(obj, color):
    """Multiply the base color texture by `color` (the glTF exporter keeps it as baseColorFactor)."""
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        link = bsdf.inputs['Base Color'].links[0]
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1
        a, b = (s for s in mix.inputs if s.type == 'RGBA')  # float/vector sockets share the names A and B
        b.default_value = (*color, 1)
        nt.links.new(link.from_socket, a)
        nt.links.new(next(s for s in mix.outputs if s.type == 'RGBA'), bsdf.inputs['Base Color'])


def glow_material():
    mat = bpy.data.materials.new('CyborgGlow')
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.05, 0.08, 0.1, 1)
    bsdf.inputs['Emission Color'].default_value = (*CYBORG_GLOW, 1)
    bsdf.inputs['Emission Strength'].default_value = CYBORG_STRENGTH
    return mat


def surface_point(target, origin, direction):
    """First hit on `target` (evaluated, rest pose) from `origin` along `direction`, in world space."""
    dg = bpy.context.evaluated_depsgraph_get()
    inv = target.matrix_world.inverted()
    ok, loc, normal, _ = target.evaluated_get(dg).ray_cast(inv @ origin, inv.to_3x3() @ direction, depsgraph=dg)
    if not ok:
        raise RuntimeError(f'no surface hit from {origin}')
    return target.matrix_world @ loc, (target.matrix_world.to_3x3() @ normal).normalized()


def seam(name, target, path, ray, width, bone, lift=0.0007, segments=24):
    """A thin glowing strip that follows the skin along `path` (world points), pinned to `bone`."""
    pts = []
    for i in range(segments + 1):
        t = i / segments * (len(path) - 1)
        a, b = path[int(t)], path[min(int(t) + 1, len(path) - 1)]
        p = a.lerp(b, t - int(t))
        pts.append(surface_point(target, p, ray))
    verts, faces = [], []
    for i, (p, n) in enumerate(pts):
        along = (pts[min(i + 1, segments)][0] - pts[max(i - 1, 0)][0]).normalized()
        side = n.cross(along).normalized() * width / 2
        verts += [p + n * lift - side, p + n * lift + side]
        if i:
            faces.append((2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i))
    return pinned_mesh(name, verts, faces, bone)


def port(name, target, center, ray, radius, bone, lift=0.0008, sides=20):
    """A small glowing ring on the skin around `center`, pinned to `bone`."""
    c, n = surface_point(target, center, ray)
    u = n.cross(Vector((0, 0, 1))).normalized()
    v = n.cross(u)
    verts, faces = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        d = u * math.cos(a) + v * math.sin(a)
        for r in (radius * 0.55, radius):
            hit, hn = surface_point(target, c + d * r + n * 0.3, -n)
            verts.append(hit + hn * lift)
        j, k = 2 * i, 2 * ((i + 1) % sides)
        faces.append((j, j + 1, k + 1, k))
    return pinned_mesh(name, verts, faces, bone)


def pinned_mesh(name, verts, faces, bone):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.materials.append(GLOW)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    world = obj.matrix_world.copy()
    obj.parent, obj.parent_type, obj.parent_bone = rig, 'BONE', bone
    bpy.context.view_layer.update()
    obj.matrix_world = world  # keep it where it was built
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)

human_info = HumanService._create_default_human_info_dict()
human_info.update(LOOK)
human_info.update({
    'name': 'Pie',
    'phenotype': PHENOTYPE,
    'rig': 'game_engine',
    'skin_mhmat': f'{SKIN}.mhmat',
    'skin_material_type': 'MAKESKIN',   # plain Principled BSDF, survives glTF export
    'eyes_material_type': 'MAKESKIN',
})
settings = HumanService.get_default_deserialization_settings()
settings['subdiv_levels'] = 0
body = HumanService.deserialize_from_dict(human_info, settings)
rig = body.parent
TargetService.bake_targets(body)  # bake gender/age/ethnicity into the mesh so they don't export as morphs

for obj in bpy.data.objects:
    for part, color in TINTS.items():
        if obj.type == 'MESH' and obj.name == f'Pie.{part}':
            tint(obj, color)

# --- subtle cyborg tells, left side of the head + left forearm ---
GLOW = glow_material()
eyes = next(o for o in bpy.data.objects if o.name == 'Pie.high-poly')
eb = [eyes.matrix_world @ Vector(c) for c in eyes.bound_box]
eye_z = sum(p.z for p in eb) / 8
eye_x = max(p.x for p in eb)       # outer corner of the left eye (character's left = +x)
eye_y = max(p.y for p in eb)       # back of the eyeball
LEFT = Vector((-1, 0, 0))          # rays travel inward from the character's left side
for i, dz in enumerate((0.012, 0.004)):
    seam(f'Cyborg.temple{i}', body,
         [Vector((0.3, eye_y - 0.004 + i * 0.004, eye_z + dz)), Vector((0.3, eye_y + 0.018, eye_z + dz - 0.006)),
          Vector((0.3, eye_y + 0.034 - i * 0.006, eye_z + dz - 0.018))],
         LEFT, 0.0014, 'head')
port('Cyborg.port', body, Vector((0.3, eye_y + 0.09, eye_z - 0.035)), LEFT, 0.0055, 'head')
arm = rig.data.bones['lowerarm_l']
a0, a1 = rig.matrix_world @ arm.head_local, rig.matrix_world @ arm.tail_local
seam('Cyborg.forearm', body, [a0.lerp(a1, 0.35) + Vector((0, -0.3, 0)), a0.lerp(a1, 0.7) + Vector((0, -0.3, 0))],
     Vector((0, 1, 0)), 0.0012, 'lowerarm_l')

# Face shapes: 22 visemes for lip sync + 52 ARKit face units, copied onto eyebrows/lashes/teeth too.
FaceService.load_targets(body, load_microsoft_visemes=True, load_arkit_faceunits=True)
FaceService.interpolate_targets(body)
for obj in [body] + [c for c in ObjectService.get_list_of_children(rig) if c.type == 'MESH']:
    for name, recipe in EMOTIONS.items():
        mix_shape_key(obj, name, recipe)

out = HERE / 'human.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(out))
print('saved', out)

# --- previews ---
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 700, 1000
world = bpy.data.worlds.new('Preview')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.02, 0.02, 1)
scene.world = world


def light(name, loc, energy, size=1.5):
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    l.data.energy, l.data.size = energy, size
    l.location = loc
    l.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(l)


light('Key', (1.5, -2.5, 2.4), 130)
light('Fill', (-2, -2, 1.5), 40)
light('Rim', (0, 2.5, 2.5), 120)

cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
scene.collection.objects.link(cam)
scene.camera = cam
head = rig.pose.bones['head']
head_pos = rig.matrix_world @ head.head
renders = HERE / 'renders'
renders.mkdir(exist_ok=True)


def shot(name, target, dist, lens, angle=0):
    a = math.radians(angle)
    cam.data.lens = lens
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(renders / f'human_{name}.png')
    bpy.ops.render.render(write_still=True)


height = max((body.matrix_world @ Vector(c)).z for c in body.bound_box)
shot('full', Vector((0, 0, height / 2)), 5, 50)
shot('face', head_pos + Vector((0, 0, 0.08)), 1.1, 85)
shot('face34', head_pos + Vector((0, 0, 0.08)), 1.1, 85, angle=35)
shot('cyborg_temple', head_pos + Vector((0.05, 0.02, 0.06)), 0.6, 85, angle=75)
shot('cyborg_forearm', a0.lerp(a1, 0.5), 0.6, 85, angle=10)

# Expression sheet: one face render per emotion.
face_meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]
scene.render.resolution_x, scene.render.resolution_y = 500, 560
for emo in ['Basis'] + list(EMOTIONS):
    for o in face_meshes:
        for k in o.data.shape_keys.key_blocks[1:]:
            k.value = 1.0 if k.name == emo else 0.0
    shot(f'emo_{emo}', head_pos + Vector((0, 0, 0.06)), 1.0, 100)
print('rendered previews to', renders)
