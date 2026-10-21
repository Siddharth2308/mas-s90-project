"""Export blender/human.blend (from make_human.py) to the app as embodiment/public/models/pie.glb.

Usage: blender --background --python blender/export_human.py
Works on a throwaway copy in memory; human.blend itself is never modified.
"""
from pathlib import Path

import bpy

from bl_ext.blender_org.mpfb.services import ExportService

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'embodiment/public/models/pie.glb'

# Shape keys the app uses (character.js / mouth.js). Everything else is dropped to keep the file small.
KEEP = {
    'Angry', 'Surprised', 'Sad', 'Smug', 'Happy', 'Bored', 'Blink', 'MouthOpen',
    'aa_02', 'aa_ah_ax_01', 'ao_03', 'aw_09', 'ay_11', 'd_t_n_19', 'er_05', 'ey_eh_uh_04', 'f_v_18',
    'h_12', 'k_g_ng_20', 'l_14', 'ow_08', 'oy_10', 'p_b_m_21', 'r_13', 'sh_ch_jh_zh_16', 'sil_00',
    's_z_15', 'th_dh_17', 'w_uw_07', 'y_iy_ih_ix_06',
}

bpy.ops.wm.open_mainfile(filepath=str(HERE / 'human.blend'))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for obj in meshes:
    if not obj.data.shape_keys:
        continue
    for key in list(obj.data.shape_keys.key_blocks[1:]):
        if key.name not in KEEP:
            obj.shape_key_remove(key)
    if len(obj.data.shape_keys.key_blocks) == 1:  # only Basis left
        obj.shape_key_remove(obj.data.shape_keys.key_blocks[0])

# MPFB wires every texture's alpha into the shader, which exports as BLEND (sorting glitches, no depth).
# Hair-like parts become alpha cutouts (a Round node exports as MASK); everything else is opaque.
CUTOUT = {'Pie.short02', 'Pie.eyebrow001', 'Pie.eyelashes01', 'Pie.high-poly'}  # eyes: clear cornea shell
for obj in meshes:
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf or not bsdf.inputs['Alpha'].is_linked:
            continue
        src = bsdf.inputs['Alpha'].links[0].from_socket
        nt.links.remove(bsdf.inputs['Alpha'].links[0])
        bsdf.inputs['Alpha'].default_value = 1
        if obj.name in CUTOUT:
            clip = nt.nodes.new('ShaderNodeMath')
            clip.operation = 'ROUND'
            nt.links.new(src, clip.inputs[0])
            nt.links.new(clip.outputs[0], bsdf.inputs['Alpha'])

# Bake the clothes/helper masks into the body without losing its shape keys.
body = bpy.data.objects['Pie.body']
ExportService.bake_modifiers_remove_helpers(body, bake_masks=True, remove_helpers=True)

for obj in meshes:
    keys = obj.data.shape_keys.key_blocks if obj.data.shape_keys else []
    print(f'{obj.name:24} {len(obj.data.vertices):6} verts  {max(len(keys) - 1, 0):2} shape keys')

bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format='GLB',
    export_yup=True,
    export_apply=False,          # applying modifiers would drop the shape keys
    export_skins=True,
    export_morph=True,
    export_morph_normal=True,
    export_try_sparse_sk=True,   # face keys only move face vertices
    export_animations=False,
    export_image_format='WEBP',  # keeps alpha for hair/brows, much smaller than PNG
    export_image_quality=85,
    export_cameras=False,
    export_lights=False,
)
print('exported', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB')
