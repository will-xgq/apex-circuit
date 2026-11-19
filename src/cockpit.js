import {createMipmappedTexture,readAsset} from './textures.js';

// Camera-aligned interior layers share one driver eye point; the instrument panel sits behind the wheel.
const shader=/* wgsl */ `
struct Cabin { viewport:vec4f, wheel:vec4f, panel:vec4f, motion:vec4f, pedals:vec4f, foot:vec4f }
@group(0) @binding(0) var<uniform> cab:Cabin;
@group(0) @binding(1) var filtering:sampler;
@group(0) @binding(2) var interior:texture_2d<f32>;
@group(0) @binding(3) var wheelTex:texture_2d<f32>;
@group(0) @binding(4) var instruments:texture_2d<f32>;
@group(0) @binding(5) var helmet:texture_2d<f32>;
@group(0) @binding(6) var gloveL:texture_2d<f32>;
@group(0) @binding(7) var gloveR:texture_2d<f32>;
@group(0) @binding(8) var footwell:texture_2d<f32>;
@group(0) @binding(9) var shoe:texture_2d<f32>;
struct Out { @builtin(position) pos:vec4f,@location(0) uv:vec2f,@location(1) @interpolate(flat) layer:u32 }
const uvRect=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1));
@vertex fn vertex(@builtin(vertex_index) i:u32,@builtin(instance_index) layer:u32)->Out {
  let uv=uvRect[i%6u]; let screen=cab.viewport.xy;
  var p=vec2f(0);var tex=uv;
  if(layer==0u) {
    let bottom=i>=6u;
    tex.y=select(uv.y*.45,.45+uv.y*.55,bottom);
    p=vec2f(cab.viewport.z+uv.x*cab.viewport.w,select(mix(-.022,.61,uv.y),mix(.61,1.115,uv.y),bottom)*screen.y);
  } else if(layer==1u) {
    p=cab.panel.xy+(uv-.5)*cab.panel.zw;
  } else if(layer==2u) {
    let v=(uv-.5)*cab.wheel.z;let cs=cos(cab.wheel.w);let sn=sin(cab.wheel.w);
    p=cab.wheel.xy+vec2f(cs*v.x-sn*v.y,(sn*v.x+cs*v.y)*.90);
   } else if(layer==3u || layer==4u) {
    let sign=select(-1.0,1.0,layer==4u);
    let handAngle=asin(.985*sin(cab.wheel.w));
    let rim=cab.wheel.xy+sign*cab.wheel.z*.437*vec2f(cos(handAngle),sin(handAngle)*.90);
    let hand=(uv-vec2f(select(.56,.44,layer==4u),.17))*cab.wheel.z*vec2f(.315,.64);
    let cs=cos(handAngle*.51);let sn=sin(handAngle*.51);
    p=rim+vec2f(cs*hand.x-sn*hand.y,sn*hand.x+cs*hand.y);
  } else if(layer==5u) {
    p=(uv-.5)*screen*vec2f(1.025,1.05)+screen*.5-cab.motion.xy*.37;
  } else if(layer==6u) {
    p=cab.foot.xy+uv*cab.foot.zw;
  } else {
    let right=layer==8u;
    let pedal=select(0.0,max(cab.pedals.x,cab.pedals.y),right);
    let cx=select(.218,mix(.782,.555,cab.pedals.y),right);
    let sy=.29-pedal*.052;
    p=cab.foot.xy+vec2f(cx+(uv.x-.5)*.245,sy+uv.y*(.90+.045*pedal))*cab.foot.zw;
    if(!right){tex.x=1.0-tex.x;}
  }
  if(layer<5u){p+=cab.motion.xy;}
  return Out(vec4f(p.x/screen.x*2.0-1.0,1.0-p.y/screen.y*2.0,0,1),tex,layer);
}
@fragment fn fragment(in:Out)->@location(0) vec4f {
  var c=vec4f(0);
  if(in.layer==0u){c=textureSampleLevel(interior,filtering,in.uv,0);}
  else if(in.layer==1u){c=textureSampleLevel(instruments,filtering,in.uv,0);}
  else if(in.layer==2u){c=textureSampleLevel(wheelTex,filtering,in.uv,0);}
  else if(in.layer==3u){c=textureSampleLevel(gloveL,filtering,in.uv,0);}
  else if(in.layer==4u){c=textureSampleLevel(gloveR,filtering,in.uv,0);}
  else if(in.layer==5u){c=textureSampleLevel(helmet,filtering,in.uv,0);}
  else if(in.layer==6u){
    var uv=in.uv;
    let brake=(1.0-smoothstep(.075,.14,abs(uv.x-.555)))*cab.pedals.y;
    let gas=(1.0-smoothstep(.04,.083,abs(uv.x-.782)))*cab.pedals.x;
    uv.y+=(uv.y-.17)*.18*(brake+gas)*(1.0-smoothstep(.57,.78,uv.y));
    c=textureSampleLevel(footwell,filtering,uv,0);
    if(min(min(in.uv.x,1.0-in.uv.x)*cab.foot.z,min(in.uv.y,1.0-in.uv.y)*cab.foot.w)<1.5){c=vec4f(.48,.51,.47,1);}
  } else {
    if(any(in.pos.xy<cab.foot.xy)||any(in.pos.xy>cab.foot.xy+cab.foot.zw)){discard;}
    c=textureSampleLevel(shoe,filtering,in.uv,0);
    if(in.layer==7u){c=vec4f(c.rgb*.76,c.a);}
  }
  return vec4f(c.rgb*cab.motion.z,c.a);
}`;

export async function loadCockpit(device,format) {
  const urls=['interior','wheel','helmet','left-glove','right-glove','footwell','shoe'].map(n=>new URL('../assets/cockpit/'+n+'.webp',import.meta.url));
  const textures=[];
  for(const url of urls) {
    textures.push(await createMipmappedTexture(device,await readAsset(url)));
  }
  const screen=document.createElement('canvas');screen.width=512;screen.height=156;
  const ctx=screen.getContext('2d');
  const panel=device.createTexture({size:[512,156],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
  const params=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const module=device.createShaderModule({code:shader});
  const info=await module.getCompilationInfo();
  const errors=info.messages.filter(x=>x.type==='error');
  if(errors.length) throw new Error(errors.map(x=>'座舱 WGSL '+x.lineNum+' '+x.message).join('\n'));
  const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}};
  const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vertex'},
    fragment:{module,entryPoint:'fragment',targets:[{format,blend}]},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'},multisample:{count:4}});
  const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:params}},
    {binding:1,resource:sampler},{binding:2,resource:textures[0]},{binding:3,resource:textures[1]},{binding:4,resource:panel.createView()},...textures.slice(2).map((resource,i)=>({binding:5+i,resource}))]});
  let previous='';
  const compact=matchMedia('(pointer: coarse), (max-width: 640px)');
  return (pass,car,w,h,footcam,dpr)=>{
    const speed=Math.round(car.speed*3.6),rpm=Math.round(car.rpm/100),reverse=car.vx*Math.sin(car.yaw)+car.vz*Math.cos(car.yaw)<-.4;
    const gear=reverse?'R':speed<1?'N':(car.gearMode==='manual'?'M':'D')+car.gear;
    const key=[speed,rpm,gear,car.gear].join('/');
    if(key!==previous) {
      previous=key;ctx.clearRect(0,0,512,156);ctx.fillStyle='#101619';ctx.fillRect(8,5,496,145);
      ctx.fillStyle='#dee8e9';ctx.textAlign='left';ctx.font='600 17px Barlow, sans-serif';ctx.fillText('R8   PERFORMANCE',22,31);
      ctx.textAlign='right';ctx.fillText((rpm*100).toLocaleString('en-US')+' RPM',489,31);
      for(let i=0;i<40;i++){ctx.fillStyle=i<rpm/87*40?(i>34?'#f05e46':i>28?'#ffbd56':'#c8e5c4'):'#34403e';ctx.fillRect(23+i*11.8,42,9,9);}
      ctx.fillStyle='#f3f5ed';ctx.textAlign='center';ctx.font='italic 600 66px Barlow,sans-serif';ctx.fillText(String(speed),250,116);
      ctx.font='600 18px Barlow,sans-serif';ctx.fillText('KM/H',250,139);ctx.font='600 35px Barlow,sans-serif';ctx.fillText(gear,429,116);
      device.queue.copyExternalImageToTexture({source:screen},{texture:panel},[512,156]);
    }
    const scale=Math.max(w*1.20,h*1.40),left=w*.475-scale*.401;
    const wheelW=Math.min(scale*.313,h*.50),wx=left+scale*.401,wy=h*.863;
    const roll=car.bodyRoll||0,lift=car.bodyLift||0;
    const fw=Math.min(h*.37,w*(w/h<.79?.29:.215)),fh=fw*.63;
    const belowFeet=compact.matches?Math.min(h*.43,139*dpr):Math.max(40*dpr,h*.09);
    const paramsData=new Float32Array([w,h,left,scale,wx,wy,wheelW,-car.steerAngle*15.7,
      left+scale*.395,h*.715,scale*.220,h*.091,clampMotion(roll*h*.14),clampMotion((car.bodyPitch*.12+lift*.06)*h),.98,0,car.throttle,car.brakePedal,0,0,w-fw-w*.023,h-fh-belowFeet,fw,fh]);
    device.queue.writeBuffer(params,0,paramsData);
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);
    pass.draw(12,1,0,0);pass.draw(6,1,0,1);pass.draw(6,1,0,2);
    pass.draw(6,3,0,3);if(footcam) pass.draw(6,3,0,6);
  };
}
const clampMotion=x=>Math.max(-7,Math.min(7,x));
