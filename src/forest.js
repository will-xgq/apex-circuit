import {createMipmappedTexture,readAsset} from './textures.js';

const shader = /* wgsl */ `
struct View { eye:vec4f, right:vec4f, up:vec4f, front:vec4f, optics:vec4f }
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var leaves:texture_2d<f32>;
@group(0) @binding(2) var filtered:sampler;
struct TreeVertex {
  @builtin(position) clip:vec4f, @location(0) uv:vec2f,
  @location(1) shade:f32, @location(2) haze:f32,
}
@vertex fn treeVertex(@builtin(vertex_index) i:u32,@location(0) root:vec4f,@location(1) shape:vec4f) -> TreeVertex {
  let corners=array<vec2f,6>(vec2f(0,1),vec2f(1,1),vec2f(0,0),vec2f(0,0),vec2f(1,1),vec2f(1,0));
  let uv=corners[i];
  let heading=normalize(view.eye.xz-root.xz);
  let across=vec2f(heading.y,-heading.x);
  let breeze=.047*sin(view.eye.w*1.3+root.x*.08+root.z*.05)*(1.0-uv.y);
  let xz=root.xz+across*(uv.x-.5)*shape.x+vec2f(breeze,breeze*.38);
  let rel=vec3f(xz.x,root.y+(1.0-uv.y)*root.w,xz.y)-view.eye.xyz;
  let depth=dot(rel,view.front.xyz);
  var out:TreeVertex;
  out.clip=vec4f(dot(rel,view.right.xyz)*view.optics.x,dot(rel,view.up.xyz)*view.optics.y,depth*1.000024-.075,depth);
  out.uv=vec2f((shape.y+select(1.0-uv.x,uv.x,shape.z>0))*.5,uv.y);
  out.shade=shape.w;
  out.haze=1.0-exp(-length(rel)*.00108);
  return out;
}
@fragment fn treeFragment(in:TreeVertex) -> @location(0) vec4f {
  let tex=textureSample(leaves,filtered,in.uv);
  if (tex.a<.045) { discard; }
  let color=tex.rgb*in.shade;
  return vec4f(mix(color,vec3f(.73,.754,.771),in.haze),smoothstep(.03,.85,tex.a));
}`;

export async function loadForest(device,format,camera,trees,groves) {
  const url=new URL('../assets/trees/silver-birch.webp',import.meta.url);
  const bitmap=await readAsset(url);
  const module=device.createShaderModule({code:shader});
  const [atlas,pipeline]=await Promise.all([
    createMipmappedTexture(device,bitmap),
    device.createRenderPipelineAsync({
      layout:'auto',vertex:{module,entryPoint:'treeVertex',buffers:[{arrayStride:32,stepMode:'instance',attributes:[
        {shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},
      ]}]},fragment:{module,entryPoint:'treeFragment',targets:[{format}]},
      depthStencil:{format:'depth24plus',depthCompare:'less',depthWriteEnabled:true},
      multisample:{count:4,alphaToCoverageEnabled:true},
    }),
  ]);
  const instances=device.createBuffer({size:trees.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:true});
  new Float32Array(instances.getMappedRange()).set(trees);
  instances.unmap();
  const sampler=device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:camera}},{binding:1,resource:atlas},{binding:2,resource:sampler},
  ]});
  return (pass,visible)=>{
    pass.setPipeline(pipeline);
    pass.setBindGroup(0,group);
    pass.setVertexBuffer(0,instances);
    for(const grove of groves) if(visible(grove,1500)) pass.draw(6,grove.count,0,grove.first);
  };
}
