"""Give another human model Pie's face: copy shape keys from blender/human.blend onto it by position.

Usage: blender --background <target.blend> --python blender/transfer_face.py -- <mesh name> <out.glb>
e.g.   blender --background human-realistic-expressions.blend --python blender/transfer_face.py -- \
           mh_3305_mocap embodiment/public/models/human-realistic-expressions.glb

The meshes don't share topology, so each head vertex of the target is matched to the closest point on Pie's
face (after lining the two faces up by the eyes) and moves the way that point moves in each shape key.
Shape keys the target already has (its own Smile, Angry, Smirk, Sad...) are left alone.
"""
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, geometry
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
argv = sys.argv[sys.argv.index('--') + 1:]
TARGET, OUT = argv[0], Path(argv[1]).resolve()

KEYS = [
    # lip sync (mouth.js)
    'aa_02', 'aa_ah_ax_01', 'ao_03', 'aw_09', 'ay_11', 'd_t_n_19', 'er_05', 'ey_eh_uh_04', 'f_v_18', 'h_12',
    'k_g_ng_20', 'l_14', 'ow_08', 'oy_10', 'p_b_m_21', 'r_13', 'sh_ch_jh_zh_16', 'sil_00', 's_z_15', 'th_dh_17',
    'w_uw_07', 'y_iy_ih_ix_06',
    # gaze and brows (character.js)
    'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight',
    'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
    'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
    # expressions (make_human.py); Happy/Smug are covered by a target's own Smile/Smirk when it has them
    'Happy', 'Smug', 'Angry', 'Sad', 'Surprised', 'Bored', 'Pain', 'Wince', 'Disgust', 'Contempt', 'Cold', 'Fear',
    'Blink', 'MouthOpen',
]
COVERED_BY = {'Happy': 'Smile', 'Smug': 'Smirk'}
REACH = 0.02   # source distance (m) where a match starts fading out
FADE = 0.03    # ...and is gone this much further away

target = bpy.data.objects[TARGET]
tmesh = target.data

# --- bring in Pie's body and eyes (rest pose; their mesh coords are the Basis) ---
with bpy.data.libraries.load(str(HERE / 'human.blend')) as (src, dst):
    dst.objects = ['Pie.body', 'Pie.high-poly']
body, eyes = dst.objects


def key_deltas(obj):
    """{key name: (n, 3) offset from Basis} for the keys we transfer."""
    kb = obj.data.shape_keys.key_blocks
    n = len(obj.data.vertices)
    base = np.empty(n * 3, np.float32)
    kb['Basis'].data.foreach_get('co', base)
    out = {}
    for name in KEYS:
        if name in kb:
            co = np.empty(n * 3, np.float32)
            kb[name].data.foreach_get('co', co)
            out[name] = (co - base).reshape(n, 3)
    return out


def bvh(obj, keep=None):
    """Triangle BVH over the mesh (optionally only triangles whose vertices are all in `keep`)."""
    me = obj.data
    me.calc_loop_triangles()
    tris = [tuple(t.vertices) for t in me.loop_triangles if keep is None or all(v in keep for v in t.vertices)]
    verts = [obj.matrix_world @ v.co for v in me.vertices]
    return BVHTree.FromPolygons(verts, tris), verts, tris


def group(obj, name, min_w=0.5):
    gi = obj.vertex_groups[name].index
    return {v.index for v in obj.data.vertices for g in v.groups if g.group == gi and g.weight >= min_w}


# Pie's body without MPFB helper geometry (only the "body" group is real skin)
body_tree, body_verts, body_tris = bvh(body, group(body, 'body'))
eye_tree, eye_verts, eye_tris = bvh(eyes)
deltas = {'body': key_deltas(body), 'eyes': key_deltas(eyes)}


# --- line the faces up by the eyes: target point -> Pie space ---
def eye_centers(points):
    left = [p for p in points if p.x > 0]
    right = [p for p in points if p.x <= 0]
    return sum(left, Vector()) / len(left), sum(right, Vector()) / len(right)


mats = {m.name: i for i, m in enumerate(tmesh.materials)}
iris_idx = {v for p in tmesh.polygons if p.material_index == mats.get('iris', -1) for v in p.vertices}
t_world = [target.matrix_world @ v.co for v in tmesh.vertices]
tl, tr = eye_centers([t_world[i] for i in iris_idx])
sl, sr = eye_centers(eye_verts)
scale = (tl - tr).length / (sl - sr).length
t_mid, s_mid = (tl + tr) / 2, (sl + sr) / 2
print(f'eye distance target {(tl - tr).length:.4f} / pie {(sl - sr).length:.4f} -> scale {scale:.3f}')

# --- match every head vertex to a point on Pie's face ---
gi = target.vertex_groups['head'].index
head_w = {v.index: g.weight for v in tmesh.vertices for g in v.groups if g.group == gi and g.weight > 0.01}
matches = []  # (target index, source name, triangle verts, barycentric weights, strength)
for i, w in head_w.items():
    p = (t_world[i] - t_mid) / scale + s_mid
    hb = body_tree.find_nearest(p)
    he = eye_tree.find_nearest(p)
    use_eyes = i in iris_idx or (he[0] is not None and he[3] < hb[3] * 0.6)
    loc, _, tri_i, dist = he if use_eyes else hb
    if loc is None:
        continue
    tri = (eye_tris if use_eyes else body_tris)[tri_i]
    verts = eye_verts if use_eyes else body_verts
    a, b, c = (verts[k] for k in tri)
    bary = geometry.barycentric_transform(loc, a, b, c, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    fade = max(0.0, min(1.0, 1 - (dist - REACH) / FADE))
    matches.append((i, 'eyes' if use_eyes else 'body', tri, bary, w * fade))
print(f'{len(matches)} head vertices matched ({sum(1 for m in matches if m[1] == "eyes")} on the eyes)')

# --- write the shape keys ---
if not tmesh.shape_keys:
    target.shape_key_add(name='Basis', from_mix=False)
existing = set(tmesh.shape_keys.key_blocks.keys())
n = len(tmesh.vertices)
base = np.empty(n * 3, np.float32)
tmesh.shape_keys.key_blocks['Basis'].data.foreach_get('co', base)
base = base.reshape(n, 3)
inv = np.array(target.matrix_world.inverted().to_3x3(), np.float32)
added = []
for name in KEYS:
    if name in existing or COVERED_BY.get(name) in existing:
        continue
    out = base.copy()
    moved = False
    for i, src_name, tri, bary, strength in matches:
        d = deltas[src_name].get(name)
        if d is None or strength <= 0:
            continue
        off = (d[tri[0]] * bary[0] + d[tri[1]] * bary[1] + d[tri[2]] * bary[2]) * scale * strength
        if np.abs(off).max() > 1e-6:
            out[i] += inv @ off
            moved = True
    if moved:
        key = target.shape_key_add(name=name, from_mix=False)
        key.data.foreach_set('co', out.ravel())
        key.value = 0
        added.append(name)
print(f'added {len(added)} shape keys:', ', '.join(added))

# --- clean up and export just the character ---
for o in (body, eyes):
    bpy.data.objects.remove(o)
for o in bpy.context.view_layer.objects:
    o.select_set(o in (target, target.parent))
bpy.context.view_layer.objects.active = target
bpy.ops.export_scene.gltf(
    filepath=str(OUT), export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_skins=True, export_morph=True, export_morph_normal=True, export_try_sparse_sk=True,
    export_animations=False, export_cameras=False, export_lights=False,
)
print('exported', OUT, f'{OUT.stat().st_size / 1e6:.1f} MB')
