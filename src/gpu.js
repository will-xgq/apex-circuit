import {boards} from './scenery.js';
import {terrainBounds} from './track.js';
import {cross,norm} from './mesh.js';
import {loadVehicle} from './model.js';
import {createMipmappedTexture,readAsset} from './textures.js';
import {loadCockpit} from './cockpit.js';
import {loadForest} from './forest.js';
import {createDrivingEffects} from './driving-effects.js';

const shader = /* wgsl */ `
struct View {
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  front: vec4f,
  optics: vec4f,
}
struct Object {
  position: vec4f,
  rotation: vec4f,
}
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage,read> objects: array<Object>;
@group(0) @binding(2) var skyMap:texture_2d<f32>;
@group(0) @binding(3) var skySampler:sampler;
@group(0) @binding(4) var aerial:texture_2d<f32>;
@group(0) @binding(5) var signs:texture_2d<f32>;
@group(0) @binding(6) var groundSampler:sampler;
@group(0) @binding(7) var detailMap:texture_2d<f32>;
@group(0) @binding(8) var t13Aerial:texture_2d<f32>;

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);
}
fn noise(p: vec2f) -> f32 {
  let i=floor(p);
  let t=fract(p);
  let u=t*t*(3.0-2.0*t);
  return mix(mix(hash(i),hash(i+vec2f(1,0)),u.x),
    mix(hash(i+vec2f(0,1)),hash(i+vec2f(1)),u.x),u.y);
}
fn filteredJoint(meters:f32, period:f32, pixel:f32, radius:f32) -> f32 {
  let distance=abs(fract(meters/period+.5)-.5)*period;
  let width=max(.003,pixel);
  return (1.0-smoothstep(max(0.0,radius-.5*width),radius+.5*width,distance))*
    min(1.0,2.0*radius/width);
}
fn turnUV(p:vec2f) -> vec2f { return vec2f(.80*p.x-.60*p.y,.60*p.x+.80*p.y); }
fn sky(ray: vec3f) -> vec3f {
  let uv=vec2f(.5+atan2(ray.x,ray.z)/6.2831853,.5-asin(clamp(ray.y,-1.0,1.0))/3.14159265);
  return textureSampleLevel(skyMap,skySampler,uv,0).rgb;
}
struct SkyOut {
  @builtin(position) clip: vec4f,
  @location(0) screen: vec2f,
}
@vertex fn skyVertex(@builtin(vertex_index) i: u32) -> SkyOut {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var out: SkyOut;
  out.clip=vec4f(p[i],.99999,1);
  out.screen=p[i];
  return out;
}
@fragment fn skyFragment(in: SkyOut) -> @location(0) vec4f {
  let ray=normalize(view.front.xyz+view.right.xyz*in.screen.x/view.optics.x+view.up.xyz*in.screen.y/view.optics.y);
  if (view.optics.z>.5) {
    let wall=vec3f(.78,.79,.78);
    if(ray.y>=-.0001) { return vec4f(wall,1); }
    let ground=view.eye.xyz-ray*(view.eye.y/ray.y);
    let e=view.optics.z-1.0;
    let shadow=exp(-dot(ground.xz/vec2f(1.35,2.5),ground.xz/vec2f(1.35,2.5))*1.6);
    var shade=1.0-shadow*mix(.39,.21,e);
    for (var i=0u;i<4u;i++) {
      let side=select(-1.0,1.0,(i&1u)>0u);
      let hub=vec2f(side*(.81+e*.84),select(1.22,-1.43,i>1u));
      let delta=(ground.xz-hub)/vec2f(.25,.45);
      shade-=.21*exp(-dot(delta,delta)*1.9);
    }
    let floorColor=vec3f(.665,.681,.68)*shade;
    return vec4f(mix(floorColor,wall,smoothstep(4.0,42.0,length(ground.xz))),1);
  }
  return vec4f(sky(ray),1);
}

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) @interpolate(flat) material: f32,
  @location(4) @interpolate(flat) brake: f32,
}
@vertex fn meshVertex(@location(0) p: vec3f,@location(1) n: vec3f,@location(2) c: vec3f,
  @location(3) material: f32,@builtin(instance_index) index: u32) -> VertexOut {
  let obj=objects[index];
  let a=obj.rotation.x;
  let b=obj.rotation.y;
  let world=vec3f(p.x*b+p.z*a,p.y,p.z*b-p.x*a)+obj.position.xyz;
  let rel=world-view.eye.xyz;
  let z=dot(rel,view.front.xyz);
  var out: VertexOut;
  out.clip=vec4f(dot(rel,view.right.xyz)*view.optics.x,dot(rel,view.up.xyz)*view.optics.y,
    z*1.000024-.075,z);
  out.world=world;
  out.normal=vec3f(n.x*b+n.z*a,n.y,n.z*b-n.x*a);
  out.color=c;
  out.material=material;
  out.brake=obj.rotation.z;
  return out;
}
@fragment fn meshFragment(in: VertexOut) -> @location(0) vec4f {
  let p=in.world.xz;
  let uv=(vec2f(${terrainBounds.right}.0,${terrainBounds.top}.0)-p)/vec2f(${terrainBounds.right-terrainBounds.x}.0,${terrainBounds.top-terrainBounds.z}.0);
  let du=dpdx(uv);let dv=dpdy(uv);let dx=dpdx(p);let dy=dpdy(p);
  let surf=textureSampleGrad(detailMap,groundSampler,p*.43,dx*.43,dy*.43).rgb;
  let trackUV=in.color.yx;
  let trackDx=dpdx(trackUV);let trackDy=dpdy(trackUV);let trackPixel=abs(trackDx)+abs(trackDy);
  let wireGrid=vec2f(in.color.x+in.color.y,in.color.x-in.color.y)*6.5;
  let wirePixel=max(fwidth(wireGrid),vec2f(.001));let heightPixel=fwidth(in.color.y);
  if(in.material==9 || in.material==15) {
    if((in.material==15)!=(view.optics.w>.5)){discard;}
    let player=objects[1];
    let ahead=(fract((in.color.y-player.position.w+10416.0)/20832.0)-.5)*20832.0;
    if(view.right.w<.5 || ahead< -9.0 || ahead>195.0){discard;}
    let desired=select(in.color.x,min(53.0,in.color.x*.73),view.front.w>.5 && in.material==9);
    let excess=player.rotation.w-desired;
    let warning=excess>-.6 || (in.color.z<-.7 && excess> -4.0);
    var ink=select(vec3f(.39,.78,.53),vec3f(.97,.73,.24),warning);
    if(excess>2.0){ink=vec3f(.94,.28,.18);}
    return vec4f(mix(ink,vec3f(.27,.29,.27),.17+.49*smoothstep(85.0,195.0,ahead)),1);
  }
  let fog=1.0-exp(-length(view.eye.xyz-in.world)*.00068);
  if(in.material==10 || in.material==21) {
    var ortho=textureSampleGrad(aerial,groundSampler,uv,du,dv).rgb;
    let pitUV=(vec2f(180.0,172.0)-p)/vec2f(340.0,272.0);
    let fade=min(pitUV,vec2f(1)-pitUV)*vec2f(340,272);
    let weight=smoothstep(0.0,8.0,min(fade.x,fade.y));
    if(weight>0.0){ortho=mix(ortho,textureSampleGrad(t13Aerial,groundSampler,pitUV,-dx/vec2f(340,272),-dy/vec2f(340,272)).rgb,weight);}
    let light=.89+.14*abs(in.normal.y);
    let near=1.0-smoothstep(40.0,145.0,length(in.world-view.eye.xyz));
    let vegetation=smoothstep(.004,.054,ortho.g-ortho.r*.95);
    var ground=clamp(ortho*1.12+vec3f(.025,.028,.012),vec3f(.032),vec3f(.89));
    var grain=mix(.75+.50*surf.b,.65+.73*surf.g,vegetation);
    if(in.material==21) {
      let d=in.color.x;
      let edge=smoothstep(.06,.47,d+.15*(surf.g-.5));
      let grass=mix(vec3f(.34,.315,.221),vec3f(.295,.350,.215),edge);
      let apron=1.0-smoothstep(1.4,6.5,d);
      let field=smoothstep(.0,.85,in.color.z)*.85;
      let shoulder=max(field,apron)*in.color.y;
      ground=mix(ground,grass*(.79+.24*noise(p*.31)+.13*noise(p*.064)),shoulder);
      grain=mix(grain,.72+.55*surf.g,shoulder);
    }
    return vec4f(mix(ground*light*mix(1.0,grain,near),vec3f(.67,.73,.75),fog),1);
  }
  if(in.material==11) {
    let h=in.color.y;
    let folds=.52+.17*cos(h*12.566-.70)+.065*sin(h*6.283);
    let join=1.0-smoothstep(.016,.040,abs(fract((in.color.x+.24)/4.0)-.5)*4.0);
    let bolt=length(vec2f((fract(in.color.x/2.0+.5)-.5)*2.0,(h-.50)*.30));
    let metal=folds+.21*smoothstep(.90,.99,h)-join*.12+.062*(1.0-smoothstep(.015,.033,bolt))+.045*noise(p*.73);
    return vec4f(mix(vec3f(.96,1.0,1.03)*metal,vec3f(.68,.73,.76),fog),1);
  }
  if(in.material==12) {
    let d=abs(fract(wireGrid+.5)-.5);let pix=wirePixel;
    let wire=1.0-smoothstep(vec2f(.019)-.5*pix,vec2f(.019)+.5*pix,d);
    let coverage=max(wire.x,wire.y)*(1.0-smoothstep(.32,1.75,max(pix.x,pix.y)));
    let cable=1.0-smoothstep(.014,.024+min(.06,heightPixel),min(abs(in.color.y-1.38),abs(in.color.y-2.71)));
    let alpha=max(coverage,cable*.86);
    if(alpha<.045){discard;}
    return vec4f(mix(vec3f(.29,.32,.31),vec3f(.67,.73,.75),fog),alpha);
  }
  if(in.material==13) {
    let uvSign=vec2f(clamp(in.color.x,.001,.999),(in.color.z+clamp(in.color.y,.004,.996))/${boards.length}.0);
    return vec4f(mix(textureSampleLevel(signs,groundSampler,uvSign,0).rgb,vec3f(.70,.73,.74),fog),1);
  }
  if(in.material==14) {
    let u=in.color.x;let h=in.color.y;let kind=in.color.z;
    var color=vec3f(.69,.67,.624);
    if(kind>1.5) {
      let bay=fract(u/4.3);
      if(bay>.055 && bay<.94 && h>.12 && h<3.05){
        color=vec3f(.43,.46,.46)*(.88+.12*smoothstep(.08,.27,fract(h/.15)));
        if(h>2.13 && h<2.53 && fract(u/.68)>.07){color=vec3f(.15,.21,.23);}
      }
      if(h>3.25){color=vec3f(.29,.31,.31);}
    } else {
      if(kind>.5){color=vec3f(.62,.634,.62);}
      let bay=fract(u/select(3.2,2.0,kind>.5));let floorH=fract(max(h,0.0)/3.1);
      if(bay>.18 && bay<.77 && floorH>.35 && floorH<.82){color=mix(vec3f(.19,.24,.265),vec3f(.39,.46,.48),floorH*.40);}
    }
    return vec4f(mix(color*(.82+.18*abs(in.normal.x)),vec3f(.68,.72,.75),fog),1);
  }
  let dir=normalize(view.eye.xyz-in.world);
  var normal=normalize(in.normal);
  if (dot(normal,dir)<0 && in.material==4) { normal=-normal; }
  let light=normalize(vec3f(-.68,.78,.31));
  let closeGrain=1.0-smoothstep(.012,.068,max(length(dx),length(dy)));
  let illumination=.81+max(0.0,dot(normal,light))*.22;
  var color=in.color*illumination;
  let accessRoad=in.material==16;
  if(accessRoad) {
    if(in.color.x<.06){discard;}
    color=select(vec3f(.302,.306,.31),vec3f(.81,.81,.77),in.color.y>.5)*illumination;
  }
  if (in.material==1 || (accessRoad && in.color.y<.5)) {
    let variation=noise(p*.35)*.78+noise(p*3.5)*.22;
    let seams=1.0-smoothstep(0.0,.025,abs(noise(p*.23)-.44));
    let grain=noise(p*38.0);
    let blotch=noise(p*.075);
    color*=(.80+.14*variation+.06*mix(.5,noise(p*26.0),closeGrain)+.11*grain+.095*blotch-.065*seams)*(.67+.68*surf.r);
  }
  let circuit=in.material==18 || in.material==19;
  if(circuit) {
    // Both scales use metres along/across the track, so aggregate, wear and joints turn with it.
    let fine=textureSampleGrad(detailMap,groundSampler,trackUV*.94,trackDx*.94,trackDy*.94).rgb;
    let rotated=textureSampleGrad(detailMap,groundSampler,turnUV(trackUV)*.227+vec2f(.32,.61),
                                   turnUV(trackDx)*.227,turnUV(trackDy)*.227).rgb;
    let lane=in.color.z+(rotated.b-.52)*.34;
    let rubber=exp(-lane*lane*.18);
    let tread=abs(lane)-.79;
    let wheelPath=exp(-tread*tread*3.8);
    let weather=noise(vec2f(trackUV.x*.145,trackUV.y*.075));
    let normalLight=.81+.21*max(0.0,dot(normal,light));
    if(in.material==19) {
      // Two pours of slab concrete, with staggered transverse expansion joints.
      let outer=trackUV.x>.54;
      let station=trackUV.y+select(0.0,1.72,outer);
      let repeat=3.58;
      let across=filteredJoint(station+(fine.b-.52)*.014,repeat,trackPixel.y,.012);
      let longitudinal=1.0-smoothstep(.006,.018+.5*trackPixel.x,abs(trackUV.x-.54+(rotated.b-.52)*.012));
      let edge=min(1.0,.024/max(.002,trackPixel.x));
      let seam=max(across,longitudinal*edge);
      let slab=hash(vec2f(floor(station/repeat),select(0.0,1.0,outer)))-.5;
      let concrete=.80+.29*fine.b+.105*rotated.b+.095*(weather-.5)+.055*slab;
      color=vec3f(.545,.532,.492)*normalLight*concrete*(1.0-.145*rubber-.067*wheelPath);
      color*=1.0-.37*seam;
    } else {
      let stone=.76+.32*fine.r+.14*rotated.r+.11*(weather-.5);
      color=vec3f(.282,.288,.293)*normalLight*stone*(1.0-.105*rubber-.039*wheelPath);
    }
  }
  if(in.material==20) {
    color*=.81+.20*surf.r+.09*noise(p*.64);
  }
  if (in.material==2) {
    color*=(.82+.13*noise(p*.24)+.12*noise(p*3.4))*(.62+.82*surf.g);
  }
  if(in.material==17) {
    let joints=min(abs(fract(p.x*.16)-.5),abs(fract(p.y*.16)-.5));
    color*= (.77+.43*surf.b)*(.86+.14*smoothstep(.0003,.004,joints));
  }
  if (in.material==8) { color*=.91+.11*noise(p*11.0); }
  if (in.material==6) {
    let flecks=smoothstep(.62,.82,surf.b);
    color=color*(.82+.24*surf.b)+vec3f(.045)*flecks;
    color=mix(color,vec3f(.40,.392,.363),.17*noise(p*.62));
  }
  if (in.material==4) {
    let reflection=reflect(-dir,normal);
    color+=sky(reflection)*(.07+.18*pow(1.0-abs(dot(normal,dir)),3.0));
  }
  if (in.material==3) { color=in.color; }
  if (in.material==5) { color=in.color*mix(.62,1.2,in.brake); }
  if (circuit || in.material==1 || in.material==6 || accessRoad || in.material==17 || in.material==20) {
    for(var i=1u;i<=u32(view.up.w);i++) {
      let obj=objects[i];
      let delta=in.world.xz-obj.position.xz;
      if(dot(delta,delta)>8.0 || abs(in.world.y-obj.position.y)>1.0){continue;}
      let row=obj.rotation;
      let local=vec2f(dot(delta,vec2f(row.y,-row.x)),dot(delta,vec2f(row.x,row.y)));
      let contact=local/vec2f(1.14,2.35);
      color*=1.0-.57*(1.0-smoothstep(.54,1.25,dot(contact,contact)));
    }
  }
  return vec4f(mix(color,sky(-dir),fog),1);
}
`;

async function signTexture(device) {
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192*boards.length;
  const ctx=canvas.getContext('2d');
  boards.forEach(([title,caption],i)=>{
    const y=i*192;ctx.fillStyle='#21272a';ctx.fillRect(0,y,768,192);
    ctx.fillStyle='#ce3931';ctx.fillRect(0,y,11,192);
    const x=i===0?384:32;ctx.textAlign=i===0?'center':'left';
    ctx.fillStyle='#faf9f1';ctx.font='bold '+(i===0?107:title.length>14?64:88)+'px system-ui';
    ctx.fillText(title,x,y+111,712);ctx.font='600 34px system-ui';ctx.fillStyle='#d3d8d3';ctx.fillText(caption,x,y+161,700);
  });
  return createMipmappedTexture(device,await new Promise(resolve=>canvas.toBlob(resolve)));
}

export async function createRenderer(canvas, scene, drivers, onError) {
  if (!navigator.gpu) throw new Error('当前浏览器没有提供 WebGPU。请用支持 WebGPU 的浏览器通过本地服务或 HTTPS 打开。');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if (!adapter) throw new Error('找不到可用的 WebGPU 显卡。请检查浏览器的硬件加速设置。');
  const device=await adapter.requestDevice();
  const ctx=canvas.getContext('webgpu');
  if (!ctx) throw new Error('无法创建 WebGPU 显示上下文。');
  const format=navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({device,format,alphaMode:'opaque'});
  const module=device.createShaderModule({code:shader});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(message=>message.type==='error');
  if (errors.length) throw new Error(errors.map(error=>error.message).join('\n'));

  const camera=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const bodies=device.createBuffer({size:(1+drivers.length)*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const [environment,aerialMap,signAtlas,detailMap,t13Aerial]=await Promise.all([
    readAsset(new URL('../assets/sky/eifel.webp',import.meta.url)).then(blob=>createMipmappedTexture(device,blob)),
    readAsset(new URL('../assets/nordschleife/eifel-aerial.webp',import.meta.url)).then(blob=>createMipmappedTexture(device,blob)),
    signTexture(device),
    readAsset(new URL('../assets/nordschleife/material-detail.webp',import.meta.url)).then(blob=>createMipmappedTexture(device,blob)),
    readAsset(new URL('../assets/nordschleife/t13-aerial.webp',import.meta.url)).then(blob=>createMipmappedTexture(device,blob)),
  ]);
  const groundSampler=device.createSampler({addressModeU:'repeat',addressModeV:'repeat',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',maxAnisotropy:4});
  const skySampler=device.createSampler({addressModeU:'repeat',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'});
  const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
    {binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
    {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
    {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:6,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:8,visibility:GPUShaderStage.FRAGMENT,texture:{}},
  ]});
  const bindings=device.createBindGroup({layout,entries:[
    {binding:0,resource:{buffer:camera}}, {binding:1,resource:{buffer:bodies}},{binding:2,resource:environment},{binding:3,resource:skySampler},
    {binding:4,resource:aerialMap},{binding:5,resource:signAtlas},{binding:6,resource:groundSampler},{binding:7,resource:detailMap},{binding:8,resource:t13Aerial},
  ]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const depth={format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'};
  const multisample={count:4};
  const [sky,world,drawVehicle,drawForest,drawEffects,drawCockpit]=await Promise.all([
    device.createRenderPipelineAsync({
      layout:pipelineLayout,vertex:{module,entryPoint:'skyVertex'},
      fragment:{module,entryPoint:'skyFragment',targets:[{format}]},
      depthStencil:{...depth,depthWriteEnabled:false,depthCompare:'always'},multisample,
    }),
    device.createRenderPipelineAsync({
      layout:pipelineLayout,vertex:{module,entryPoint:'meshVertex',buffers:[{
        arrayStride:40,attributes:[
          {shaderLocation:0,offset:0,format:'float32x3'},
          {shaderLocation:1,offset:12,format:'float32x3'},
          {shaderLocation:2,offset:24,format:'float32x3'},
          {shaderLocation:3,offset:36,format:'float32'},
        ],
      }]},
      fragment:{module,entryPoint:'meshFragment',targets:[{format}]},
      depthStencil:depth,multisample:{...multisample,alphaToCoverageEnabled:true},
    }),
    loadVehicle(device,format,camera,new URL('../assets/r8/audi-r8.glb?v=surfacing-1',import.meta.url),environment,skySampler,drivers),
    loadForest(device,format,camera,scene.trees,scene.groves),
    createDrivingEffects(device,format,camera),
    loadCockpit(device,format),
  ]);
  device.lost.then(reason=>onError('WebGPU 设备已断开。刷新页面可重新连接。'+(reason.message?' '+reason.message:'')));
  device.addEventListener('uncapturederror',event=>onError(event.error.message));
  function upload(data) {
    const buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:true});
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return {buffer,count:data.length/10};
  }
  const tiles=scene.tiles.map(({vertices,...bounds})=>({...bounds,...upload(vertices)}));
  let depthTexture,colorTexture,width=0,height=0;
  const states=new Float32Array((1+drivers.length)*8);
  states[5]=1;
  const uniforms=new Float32Array(20);
  return (eye,target,cars,fov,hidePlayer=false,explosion=null,time=0,cabin=false,footcam=true,showLine=false,beginner=false)=>{
    const dpr=Math.min(devicePixelRatio,1.5);
    const nextW=Math.max(1,Math.round(canvas.clientWidth*dpr));
    const nextH=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if (nextW!==width || nextH!==height) {
      width=canvas.width=nextW;
      height=canvas.height=nextH;
      depthTexture?.destroy();
      colorTexture?.destroy();
      const attachment={size:[width,height],sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT};
      depthTexture=device.createTexture({...attachment,format:'depth24plus'});
      colorTexture=device.createTexture({...attachment,format});
    }
    const front=norm(target.map((value,i)=>value-eye[i]));
    const right=norm(cross(front,[0,1,0])), up=cross(right,front);
    const focal=1/Math.tan(fov/2);
    uniforms.set(eye,0);
    uniforms[3]=time;
    uniforms.set(right,4);
    uniforms.set(up,8);
    uniforms.set(front,12);
    uniforms[11]=cars.length;uniforms[7]=Number(showLine);uniforms[15]=Number(beginner);
    uniforms.set([focal*height/width,focal,explosion===null?0:1+explosion,Number(!!cars[0].inPit)],16);
    cars.forEach((car,i)=>states.set([car.x,car.y,car.z,car.s||0,Math.sin(car.yaw),Math.cos(car.yaw),Number(car.brake),car.speed||0],(i+1)*8));
    device.queue.writeBuffer(camera,0,uniforms);
    device.queue.writeBuffer(bodies,0,states);
    const commands=device.createCommandEncoder();
    const pass=commands.beginRenderPass({
      colorAttachments:[{view:colorTexture.createView(),resolveTarget:ctx.getCurrentTexture().createView(),
        loadOp:'clear',storeOp:'discard',clearValue:{r:.67,g:.71,b:.73,a:1}}],
      depthStencilAttachment:{view:depthTexture.createView(),depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1},
    });
    pass.setBindGroup(0,bindings);
    pass.setPipeline(sky);
    pass.draw(3);
    if (explosion===null) {
      pass.setPipeline(world);
      const horizontalFov=width/(height*focal);
      const visible=(tile,range)=>{
        const dx=tile.x-eye[0],dz=tile.z-eye[2],along=dx*front[0]+dz*front[2];
        return along>-tile.radius && dx*dx+dz*dz<range*range && Math.abs(dx*right[0]+dz*right[2])<Math.max(0,along)*horizontalFov+tile.radius*(1+horizontalFov);
      };
      for(const tile of tiles) if(visible(tile,2700)) {
        pass.setVertexBuffer(0,tile.buffer);pass.draw(tile.count);
      }
      drawForest(pass,visible);
      const racers=cars.filter((car,i)=>(i!==0||!hidePlayer) && visible({x:car.x,z:car.z,radius:4},520));
      drawVehicle(pass,racers);
    } else drawVehicle(pass,cars,explosion);
    if (explosion===null) drawEffects(pass,cars[0],time);
    if(cabin && explosion===null) drawCockpit(pass,cars[0],width,height,footcam,dpr);
    pass.end();
    device.queue.submit([commands.finish()]);
  };
}
