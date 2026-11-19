import {createMipmappedTexture,readAsset} from './textures.js';

// Runtime format: a self-contained GLB exported by the R8 preparation script.
// Each part has a translation pivot and an optional explosion vector, in metres.
const shader = /* wgsl */ `
struct View { eye: vec4f, right: vec4f, up: vec4f, front: vec4f, optics: vec4f }
struct Material { base: vec4f, factors: vec4f }
struct Part { transform: mat4x4f, paintBrake: vec4f }
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> parts: array<Part>;
@group(0) @binding(2) var outdoor:texture_2d<f32>;
@group(0) @binding(3) var envSampler:sampler;
@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var baseMap: texture_2d<f32>;
@group(1) @binding(2) var surfaceMap: texture_2d<f32>;
@group(1) @binding(3) var normalMap: texture_2d<f32>;
@group(1) @binding(4) var<uniform> mat: Material;

struct Fragment {
  @builtin(position) screen: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) paintBrake: vec4f,
}
@vertex fn modelVertex(@location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
    @builtin(instance_index) part: u32) -> Fragment {
  let model=parts[part].transform;
  let world=(model*vec4f(position,1)).xyz;
  let rel=world-view.eye.xyz;
  let depth=dot(rel,view.front.xyz);
  var v: Fragment;
  v.screen=vec4f(dot(rel,view.right.xyz)*view.optics.x,dot(rel,view.up.xyz)*view.optics.y,depth*1.000024-.075,depth);
  v.world=world;
  v.normal=(model*vec4f(normal,0)).xyz;
  v.uv=uv;
  v.paintBrake=parts[part].paintBrake;
  return v;
}
fn environment(ray: vec3f, roughness: f32) -> vec3f {
  let horizon=smoothstep(-.16-roughness*.22,.10+roughness*.22,ray.y);
  var e=mix(vec3f(.095,.10,.091),vec3f(.58,.64,.70),horizon);
  e+=vec3f(.25,.25,.23)*smoothstep(.18,.9,ray.y);
  if(view.optics.z<.5) {
    let uv=vec2f(.5+atan2(ray.x,ray.z)/6.2831853,.5-asin(clamp(ray.y,-1.0,1.0))/3.14159265);
    let sk=pow(textureSampleLevel(outdoor,envSampler,uv,roughness*5.0).rgb,vec3f(2.2));
    e=mix(vec3f(.085,.115,.066),sk,horizon);
  }
  if (view.optics.z>.5) {
    e=mix(vec3f(.19,.19,.19),vec3f(.60,.61,.63),horizon);
    let spread=1.0+roughness*4.0;
    let band=exp(-pow((ray.y-.5)/(spread*.13),2.0));
    e+=vec3f(1.35,1.32,1.29)*band*smoothstep(-.2,.65,ray.x);
  }
  return e;
}
@fragment fn modelFragment(v: Fragment) -> @location(0) vec4f {
  let original=textureSample(baseMap,texSampler,v.uv).rgb*mat.base.rgb;
  let peak=max(original.r,max(original.g,original.b));
  let chroma=(peak-min(original.r,min(original.g,original.b)))/max(.001,peak);
  let paint=mat.factors.w*(1.0-smoothstep(.10,.32,chroma))*smoothstep(.047,.22,peak);
  let base=original*mix(vec3f(1),v.paintBrake.rgb,paint);
  let surface=textureSample(surfaceMap,texSampler,v.uv);
  let rough=clamp(surface.g*mat.factors.y,.12,1.0);
  let metal=clamp(surface.b*mat.factors.x,0,1);
  let dx=dpdx(v.world); let dy=dpdy(v.world);
  let ux=dpdx(v.uv); let uy=dpdy(v.uv);
  var n=normalize(v.normal);
  let tRaw=dx*uy.y-dy*ux.y;
  let bRaw=dy*ux.x-dx*uy.x;
  let determinant=ux.x*uy.y-ux.y*uy.x;
  let normalTex=textureSample(normalMap,texSampler,v.uv).xyz*2.0-1.0;
  if (abs(determinant)>1e-12 && dot(tRaw,tRaw)>1e-18 && dot(bRaw,bRaw)>1e-18) {
    let basis=sign(determinant);
    let tangent=normalize(tRaw)*basis;
    let bitangent=normalize(bRaw)*basis;
    n=normalize(n*normalTex.z+(tangent*normalTex.x+bitangent*normalTex.y)*mat.factors.z);
  }
  let eye=normalize(view.eye.xyz-v.world);
  let light=normalize(vec3f(-.60,.84,.48));
  let halfVector=normalize(eye+light);
  let ndv=max(dot(n,eye),.015);
  let ndl=max(dot(n,light),0.0);
  let f0=mix(vec3f(.045),base,metal);
  let fresnel=f0+(vec3f(1)-f0)*pow(1.0-ndv,5.0);
  let shade=.52+.23*(n.y*.5+.5)+.35*ndl;
  let diffuse=base*(1.0-metal)*shade;
  let env=environment(reflect(-eye,n),rough);
  let highlight=pow(max(dot(n,halfVector),0),mix(130.0,5.0,rough*rough))*.33;
  var color=diffuse+env*fresnel*(.96-.30*rough)+highlight*f0;
  let redLens=smoothstep(.06,.23,original.r-max(original.g,original.b));
  color+=vec3f(.34,.009,.003)*redLens*v.paintBrake.w;
  return vec4f(pow(clamp(color,vec3f(0),vec3f(1)),vec3f(1.0/2.2)),1);
}
`;

function readGLB(buffer) {
  const header=new DataView(buffer);
  if(header.getUint32(0,true)!==0x46546c67 || header.getUint32(4,true)!==2) throw new Error('车型文件不是 glTF 2.0。');
  const jsonLength=header.getUint32(12,true);
  const doc=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));
  const binary=20+jsonLength+8;
  function attribute(index,components) {
    const a=doc.accessors[index], view=doc.bufferViews[a.bufferView];
    const types={5121:Uint8Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
    const Type=types[a.componentType];
    if(!Type) throw new Error('车型顶点格式不受支持。');
    const stride=(view.byteStride || components*Type.BYTES_PER_ELEMENT)/Type.BYTES_PER_ELEMENT;
    const offset=binary+(view.byteOffset||0)+(a.byteOffset||0);
    const raw=new Type(buffer,offset,(a.count-1)*stride+components);
    if(stride===components) return raw;
    const result=new Type(a.count*components);
    for(let i=0;i<a.count;i++) for(let j=0;j<components;j++) result[i*components+j]=raw[i*stride+j];
    return result;
  }
  function image(index) {
    const image=doc.images[index], view=doc.bufferViews[image.bufferView];
    return new Blob([new Uint8Array(buffer,binary+(view.byteOffset||0),view.byteLength)],{type:image.mimeType});
  }
  return {doc,attribute,image};
}

function upload(device,data,usage) {
  const buffer=device.createBuffer({size:Math.ceil(data.byteLength/4)*4,usage,mappedAtCreation:true});
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));
  buffer.unmap();
  return buffer;
}

const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function translate(x,y,z) {
  const a=identity.slice();
  a[12]=x; a[13]=y; a[14]=z;
  return a;
}
function rotateY(a) {
  const c=Math.cos(a),s=Math.sin(a);
  return [c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1];
}
function rotateX(a) {
  const c=Math.cos(a),s=Math.sin(a);
  return [1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1];
}
function rotateZ(a) {
  const c=Math.cos(a),s=Math.sin(a);return [c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1];
}
function multiply(a,b) {
  const m=new Float32Array(16);
  for(let col=0;col<4;col++) for(let row=0;row<4;row++) {
    m[col*4+row]=a[row]*b[col*4]+a[4+row]*b[col*4+1]+a[8+row]*b[col*4+2]+a[12+row]*b[col*4+3];
  }
  return m;
}

export async function loadVehicle(device,format,camera,url,environment,envSampler,drivers) {
  const capacity=drivers.length;
  const paints=new Map(drivers.map((driver,i)=>[driver, i===0?[1,1,1]:[1,3,5].map(offset=>{
    const channel=parseInt(driver.color.slice(offset,offset+2),16)/255;
    return ((channel+.055)/1.055)**2.4*1.16;
  })]));
  const {doc,attribute,image}=readGLB(await readAsset(url,'arrayBuffer'));
  const nodes=doc.nodes.filter(node=>Number.isInteger(node.mesh));
  if(!nodes.length) throw new Error('R8 文件缺少网格。');
  const module=device.createShaderModule({code:shader});
  const pipeline=await device.createRenderPipelineAsync({
    layout:'auto',
    vertex:{module,entryPoint:'modelVertex',buffers:[{arrayStride:32,attributes:[
      {shaderLocation:0,format:'float32x3',offset:0},{shaderLocation:1,format:'float32x3',offset:12},
      {shaderLocation:2,format:'float32x2',offset:24},
    ]}]},
    fragment:{module,entryPoint:'modelFragment',targets:[{format}]},
    primitive:{topology:'triangle-list'},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'},
    multisample:{count:4},
  });
  const transforms=device.createBuffer({size:nodes.length*capacity*80,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.STORAGE});
  const viewGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:camera}},{binding:1,resource:{buffer:transforms}},{binding:2,resource:environment},{binding:3,resource:envSampler},
  ]});
  const sampler=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',minFilter:'linear',magFilter:'linear',
    mipmapFilter:'linear',maxAnisotropy:4});
  const cache=new Map();
  function materialMap(entry,defaultColor,srgb) {
    const source=entry?doc.textures[entry.index].source:null;
    const key=String(source)+'/'+defaultColor.join(',')+'/'+Boolean(srgb);
    if(!cache.has(key)) cache.set(key,createMipmappedTexture(device,source==null?null:image(source),defaultColor,srgb));
    return cache.get(key);
  }
  const materials=await Promise.all(doc.materials.map(async material=>{
    const pbr=material.pbrMetallicRoughness||{};
    const [base,surface,normal]=await Promise.all([materialMap(pbr.baseColorTexture,[255,255,255,255],true),
      materialMap(pbr.metallicRoughnessTexture,[255,255,255,255],false),materialMap(material.normalTexture,[128,128,255,255],false)]);
    const factors=new Float32Array([...(pbr.baseColorFactor||[1,1,1,1]),pbr.metallicFactor??1,
      pbr.roughnessFactor??1,material.normalTexture?.scale??1,Number(material.name.startsWith('Silver •') || material.name==='Suzuka silver')]);
    const buffer=upload(device,factors,GPUBufferUsage.UNIFORM);
    return device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[
      {binding:0,resource:sampler},{binding:1,resource:base},{binding:2,resource:surface},
      {binding:3,resource:normal},{binding:4,resource:{buffer}},
    ]});
  }));
  const meshes=doc.meshes.map(mesh=>mesh.primitives.map(prim=>{
    const pos=attribute(prim.attributes.POSITION,3), normals=attribute(prim.attributes.NORMAL,3);
    const uv=prim.attributes.TEXCOORD_0==null?null:attribute(prim.attributes.TEXCOORD_0,2);
    const count=pos.length/3, data=new Float32Array(count*8);
    for(let i=0;i<count;i++) {
      data.set(pos.subarray(i*3,i*3+3),i*8);
      data.set(normals.subarray(i*3,i*3+3),i*8+3);
      if(uv) data.set(uv.subarray(i*2,i*2+2),i*8+6);
    }
    const indices=attribute(prim.indices,1);
    const index=indices.BYTES_PER_ELEMENT===1?new Uint16Array(indices):indices;
    return {vertices:upload(device,data,GPUBufferUsage.VERTEX),indices:upload(device,index,GPUBufferUsage.INDEX),
      count:index.length,format:index.BYTES_PER_ELEMENT===4?'uint32':'uint16',material:materials[prim.material]};
  }));
  const instances=new Float32Array(nodes.length*capacity*20);
  return function draw(pass,cars,explode=0) {
    if(!cars.length) return;
    cars.forEach((car,carIndex)=>{
      const paint=paints.get(car.driver)||[1,1,1];
      const orientation=multiply(rotateY(car.yaw),multiply(rotateX(-((car.pitch||0)+(car.bodyPitch||0))),rotateZ((car.roadRoll||0)+(car.bodyRoll||0))));
      const chassis=multiply(translate(car.x,car.y+.035+(car.bodyLift||0),car.z),orientation);
      nodes.forEach((node,i)=>{
        const center=node.translation||[0,0,0], meta=node.extras||{}, shift=meta.explosion||[0,0,0];
        const location=center.map((v,j)=>v+shift[j]*explode);
        if(meta.wheel && car.wheelLift) {
          const w=(meta.front?0:2)+(center[0]<0?1:0);
          location[1]+=car.wheelLift[w]-car.bodyLift-center[0]*car.bodyRoll-center[2]*car.bodyPitch;
        }
        let local=translate(...location);
        if(meta.wheel) {
          if(meta.front) local=multiply(local,rotateY(car.steerAngle||0));
          local=multiply(local,rotateX(car.traveled/.333));
        }
        const offset=(i*capacity+carIndex)*20;
        instances.set(multiply(chassis,local),offset);
        instances.set(paint,offset+16);
        instances[offset+19]=Number(car.brake)||0;
      });
    });
    device.queue.writeBuffer(transforms,0,instances);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0,viewGroup);
    nodes.forEach((node,i)=>{
      for (const prim of meshes[node.mesh]) {
        pass.setBindGroup(1,prim.material);
        pass.setVertexBuffer(0,prim.vertices);
        pass.setIndexBuffer(prim.indices,prim.format);
        pass.drawIndexed(prim.count,cars.length,0,0,i*capacity);
      }
    });
  };
}
