"""Decimate the editable R8 master per component and export a textured, self-contained GLB."""
import json
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
TARGET = 32000
OUT = ROOT / 'assets/r8/audi-r8.glb'


def triangle_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
before = {obj.name: triangle_count(obj.data) for obj in objects}
total = sum(before.values())
# Retain the thin spoiler and brake hardware while spending most faces on the shell and wheels.
weights = {obj.name: before[obj.name]**.79 for obj in objects}
total_weight = sum(weights.values())
for obj in objects:
    quota = max(128, round(TARGET * weights[obj.name]/total_weight))
    if before[obj.name] <= quota:
        continue
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Race mesh', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = quota/before[obj.name]
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

after = {obj.name: triangle_count(obj.data) for obj in objects}
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_extras=True,
                          export_yup=True, export_texcoords=True, export_normals=True,
                          export_image_format='JPEG', export_jpeg_quality=89)
metrics = {'source': 'local Blender exterior study from Image 2.6 views and Audi dimensions',
           'source_triangles': total, 'runtime_triangles': sum(after.values()),
           'bytes': OUT.stat().st_size, 'parts': after}
(ROOT/'design/r8/mesh-metrics.json').write_text(json.dumps(metrics, indent=2)+'\n')
print(json.dumps(metrics))
