"""Decimate the editable R8 master per component and export a textured, self-contained GLB."""
import json
from pathlib import Path

import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[1]
TARGET = 32000
OUT = ROOT / 'assets/r8/audi-r8.glb'


def triangle_count(mesh):
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
before = {obj.name: triangle_count(obj.data) for obj in objects}
total = sum(before.values())
# Keep the fitted glass, optical outlines and mating edges exactly as authored.
# Decimating adjacent materials independently moves their boundaries across the paint.
def retain_faces(mesh, keep):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


skin_meshes = {}
remaining = {}
for obj in objects:
    mask = obj.data.attributes.get('exterior_skin')
    if mask:
        protected = [entry.value for entry in mask.data]
        if all(protected):
            continue
        skin = obj.data.copy()
        retain_faces(skin, protected)
        retain_faces(obj.data, [not value for value in protected])
        skin_meshes[obj.name] = skin
    remaining[obj.name] = triangle_count(obj.data)

budget = TARGET - (total-sum(remaining.values()))
weights = {name: count**.79 for name,count in remaining.items()}
weight_sum = sum(weights.values())
for obj in objects:
    if obj.name not in remaining:
        continue
    quota = max(128, round(budget*weights[obj.name]/weight_sum))
    if remaining[obj.name] > quota:
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('Race mesh', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = quota/remaining[obj.name]
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if obj.name in skin_meshes:
        skin = skin_meshes[obj.name]
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.from_mesh(skin)
        bm.to_mesh(obj.data)
        bm.free()
        bpy.data.meshes.remove(skin)
        obj.data.update()

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
