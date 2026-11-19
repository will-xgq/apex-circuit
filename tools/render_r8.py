"""Render both assembly states from the reduced GLB, using the same part offsets as the game."""
from pathlib import Path
import math

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/r8/audi-r8.glb'))
parts=[o for o in bpy.context.scene.objects if o.type=='MESH']
original={o.name:o.location.copy() for o in parts}


def aim(obj,point):
    obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()


def softbox(name,location,power,width,height):
    lamp=bpy.data.lights.new(name,'AREA')
    lamp.energy=power
    lamp.shape='RECTANGLE'
    lamp.size=width
    lamp.size_y=height
    obj=bpy.data.objects.new(name,lamp)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    aim(obj,(0,0,.45))


scene=bpy.context.scene
scene.world=bpy.data.worlds.new('Studio')
scene.world.use_nodes=True
bg=scene.world.node_tree.nodes.get('Background')
bg.inputs[0].default_value=(.63,.65,.68,1)
bg.inputs[1].default_value=.55
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.006))
floor=bpy.data.materials.new('Warm grey sweep')
floor.diffuse_color=(.30,.307,.30,1)
bpy.context.object.data.materials.append(floor)
softbox('Long strip',(-3.8,-3,6),415,5.6,2.8)
softbox('Side fill',(5.1,-.8,4.7),510,6.2,2.2)
softbox('Rear rim',(-2.0,4.6,5.5),580,4.7,3.3)
bpy.ops.object.camera_add()
camera=bpy.context.object
camera.data.type='ORTHO'
scene.camera=camera
scene.render.engine='CYCLES'
scene.cycles.device='CPU'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1440
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
for explosion,name in [(0,'assembled'),(1,'exploded')]:
    for obj in parts:
        x,y,z=obj.get('explosion',[0,0,0])
        obj.location=original[obj.name]+Vector((x,-z,y))*explosion
    focus=(0,-.04,.58+explosion*.14)
    camera.location=(5.8,-7.5,3.85+explosion*.8)
    aim(camera,focus)
    camera.data.ortho_scale=5.85+explosion*2.1
    scene.render.filepath=str(ROOT/('design/r8/r8-'+name+'.png'))
    bpy.ops.render.render(write_still=True)
