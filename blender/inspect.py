"""Import a .glb, check it against what the app needs, save a .blend and render previews.

Usage: blender --background --python blender/inspect.py -- [model.glb] [out.blend]
Defaults: embodiment/public/models/robot.glb -> blender/robot.blend
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
src = Path(argv[0]) if argv else ROOT / 'embodiment/public/models/robot.glb'
out = Path(argv[1]) if len(argv) > 1 else HERE / f'{src.stem}.blend'

# What character.js / mouth.js look for (see README in this folder).
BONES = ['Head', 'Neck', 'Torso', 'Abdomen', 'UpperArm.L', 'UpperArm.R',
         'LowerArm.L', 'LowerArm.R', 'UpperLeg.L', 'UpperLeg.R']
MORPHS = ['Angry', 'Surprised', 'Sad']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))

ok = lambda b: 'OK ' if b else '-- '
report = [f'\n=== {src.name} ===']

arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
bones = {b.name for a in arms for b in a.data.bones}
report.append(f'{ok(arms)}armature: {", ".join(a.name for a in arms) or "none"}')
for b in BONES:
    report.append(f'  {ok(b in bones)}bone {b}')

actions = [a.name for a in bpy.data.actions]
report.append(f'{ok(any("idle" in a.lower() for a in actions))}idle animation')
report.append(f'{ok("No" in actions)}"No" animation (hit reaction)')
report.append(f'   all actions: {", ".join(actions) or "none"}')

keys = set()
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.shape_keys:
        keys |= {k.name for k in o.data.shape_keys.key_blocks}
for m in MORPHS:
    report.append(f'{ok(m in keys)}shape key {m}')

mats = {m.name for m in bpy.data.materials}
report.append(f'{ok("Black" in mats)}"Black" eye material')
report.append(f'   materials: {", ".join(sorted(mats))}')

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
lo = Vector((min(v[i] for o in meshes for v in (o.matrix_world @ Vector(c) for c in o.bound_box)) for i in range(3)))
hi = Vector((max(v[i] for o in meshes for v in (o.matrix_world @ Vector(c) for c in o.bound_box)) for i in range(3)))
size = hi - lo
report.append(f'   size {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m, feet at z={lo.z:.2f}')
print('\n'.join(report) + '\n')

# Save the working file before adding preview-only camera/lights.
bpy.ops.wm.save_as_mainfile(filepath=str(out))

# --- previews: front + side, black background like the booth ---
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x, scene.render.resolution_y = 600, 800
world = bpy.data.worlds.new('Preview')
world.color = (0, 0, 0)
scene.world = world
scene.display.shading.background_type = 'WORLD'

center = (lo + hi) / 2
cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 50
dist = size.z * 2.4
renders = HERE / 'renders'
renders.mkdir(exist_ok=True)
for name, angle in [('front', 0), ('side', 90)]:
    a = math.radians(angle)
    cam.location = center + Vector((math.sin(a) * dist, -math.cos(a) * dist, size.z * 0.1))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(renders / f'{src.stem}_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)
