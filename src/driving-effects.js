import {clamp, nearest} from './track.js';

const shader=/* wgsl */ `
struct View { eye:vec4f, right:vec4f, up:vec4f, front:vec4f, optics:vec4f }
@group(0) @binding(0) var<uniform> view:View;
struct Output { @builtin(position) position:vec4f, @location(0) uv:vec2f, @location(1) strength:f32 }
fn project(p:vec3f)->vec4f {
  let r=p-view.eye.xyz; let z=dot(r,view.front.xyz);
  return vec4f(dot(r,view.right.xyz)*view.optics.x,dot(r,view.up.xyz)*view.optics.y,z*1.000024-.075,z);
}
const quad=array<vec2f,6>(vec2f(-1,0),vec2f(1,0),vec2f(-1,1),vec2f(-1,1),vec2f(1,0),vec2f(1,1));
@vertex fn tread(@builtin(vertex_index) i:u32,@location(0) a:vec4f,@location(1) b:vec4f)->Output {
  let uv=quad[i]; let delta=normalize(b.xyz-a.xyz);
  let side=vec3f(delta.z,0,-delta.x);
  let p=mix(a.xyz,b.xyz,uv.y)+uv.x*.125*side;
  return Output(project(p),uv,b.w*(1.0-smoothstep(8.0,20.0,view.eye.w-a.w)));
}
@fragment fn rubber(in:Output)->@location(0) vec4f {
  let edge=1.0-smoothstep(.76,1.0,abs(in.uv.x));
  let groove=.79+.21*cos(in.uv.x*18.0);
  return vec4f(.065,.068,.067,in.strength*edge*groove);
}
@vertex fn puff(@builtin(vertex_index) i:u32,@location(0) a:vec4f,@location(1) b:vec4f)->Output {
  let age=view.eye.w-a.w;
  if (age>1.05) { return Output(vec4f(3,3,2,1),vec2f(0),0); }
  let uv=quad[i]*vec2f(1,2)-vec2f(0,1);
  let seed=fract(sin(dot(b.xz,vec2f(3.41,6.17)))*1456.4);
  let size=.13+age*(.62+seed*.34);
  let rise=vec3f(age*(seed-.38)*.51,.17+age*.63,age*(seed-.6)*.25);
  let p=b.xyz+rise+(view.right.xyz*uv.x+view.up.xyz*uv.y)*size;
  return Output(project(p),uv,b.w*.17*(1.0-smoothstep(.06,1.05,age)));
}
@fragment fn smoke(in:Output)->@location(0) vec4f {
  let r=length(in.uv)+.07*sin(in.uv.x*8.0)*sin(in.uv.y*6.0);
  return vec4f(.74,.76,.75,in.strength*(1.0-smoothstep(.12,1.0,r)));
}
`;

// Two rear tyre ribbons persist on the asphalt. Their newest samples also seed the smoke.
export async function createDrivingEffects(device,format,camera) {
  const capacity=1400, samples=new Float32Array(capacity*8);
  const usage=GPUBufferUsage.COPY_DST|GPUBufferUsage.VERTEX;
  const tracks=device.createBuffer({size:samples.byteLength,usage});
  const module=device.createShaderModule({code:shader});
  const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
  const group=device.createBindGroup({layout,entries:[{binding:0,resource:{buffer:camera}}]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}};
  function pipeline(vertex,fragment) {
    return device.createRenderPipelineAsync({layout:pipelineLayout,
      vertex:{module,entryPoint:vertex,buffers:[{arrayStride:32,stepMode:'instance',attributes:[
        {shaderLocation:0,offset:0,format:'float32x4'},{shaderLocation:1,offset:16,format:'float32x4'},
      ]}]},fragment:{module,entryPoint:fragment,targets:[{format,blend}]},
      depthStencil:{format:'depth24plus',depthCompare:'less-equal',depthWriteEnabled:false},multisample:{count:4},
    });
  }
  const [rubber,smoke]=await Promise.all([pipeline('tread','rubber'),pipeline('puff','smoke')]);
  let owner,lastWheels,count=0,cursor=0,lastTime=-1,lastMark=-Infinity;
  function update(car,time) {
    if (owner!==car || time<lastTime) {
      owner=car; count=cursor=0; lastWheels=null; lastTime=-1; lastMark=-Infinity;
    }
    if (time===lastTime) return;
    lastTime=time;
    if (!car.drifting) { lastWheels=null; return; }
    const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw);
    const wheels=[-.80,.80].map(x=>{
      const wx=car.x+x*cos-1.43*sin,wz=car.z-x*sin-1.43*cos;
      return [wx,nearest(wx,wz).y+.068,wz];
    });
    const spacing=lastWheels?Math.hypot(wheels[0][0]-lastWheels[0][0],wheels[0][2]-lastWheels[0][2]):Infinity;
    if (spacing<.42) return;
    if (lastWheels && spacing<4) {
      const strength=clamp(Math.abs(car.driftAngle)*1.55,.24,.78);
      const start=cursor;
      for (let i=0;i<2;i++) {
        samples.set([...lastWheels[i],time,...wheels[i],strength],cursor*8);
        cursor=(cursor+1)%capacity;
      }
      // Entries arrive in pairs, so a pair never straddles the buffer boundary.
      device.queue.writeBuffer(tracks,start*32,samples.buffer,start*32,64);
      count=Math.min(count+2,capacity); lastMark=time;
    }
    lastWheels=wheels;
  }
  return (pass,car,time)=>{
    update(car,time);
    if (count && time-lastMark<20) {
      pass.setPipeline(rubber); pass.setBindGroup(0,group); pass.setVertexBuffer(0,tracks); pass.draw(6,count);
      if (time-lastMark<1.05) { pass.setPipeline(smoke); pass.draw(6,count); }
    }
  };
}
