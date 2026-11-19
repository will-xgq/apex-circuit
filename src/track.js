import {samples,sections} from '../assets/nordschleife/route.js';
import {edges,pitDeparture} from '../assets/nordschleife/roadside.js';
import {origin,spacing,columns,heights} from '../assets/nordschleife/relief.js';

export const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
export const mix=(a,b,t)=>a+(b-a)*t;
export const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
export const length=20832, step=length/samples.length;
export const wrap=s=>((s%length)+length)%length;
export function gridSlot(order) {
  const stagger=order%2;
  return {s:-6-Math.floor(order/2)*18-stagger*1.5,lane:stagger?1.65:-1.65};
}
export const railFaceAt=(p,side)=>side<0?p.railRight:p.railLeft;
export const terrainBounds={x:origin[0],z:origin[1],right:origin[0]+(columns-1)*spacing,
  top:origin[1]+(heights.length/columns-1)*spacing};
const count=samples.length;
const indexAt=i=>(i+count)%count;
const smooth=t=>t*t*(3-2*t);

let sectionIndex=0;
export const track=samples.map(([x,y,z,width],i)=>{
  const s=i*step;
  if (sectionIndex+1<sections.length && sections[sectionIndex+1][0]<=s) sectionIndex++;
  const prev=samples[indexAt(i-1)],next=samples[indexAt(i+1)];
  // Beyond the pit divider the driving corridor includes the converging pit exit.
  const exitEdge=s>=144 && s<=234 ? 10.9-3.2*clamp((s-190)/44,0,1) : 0;
  return {s,x,y,z,half:width/2,railRight:Math.max(edges[i][0]/10,exitEdge),railLeft:edges[i][1]/10,
    fenceRight:edges[i][2]/10,fenceLeft:edges[i][3]/10,section:sections[sectionIndex][1],
    yaw:Math.atan2(next[0]-prev[0],next[2]-prev[2]),grade:(next[1]-prev[1])/Math.hypot(next[0]-prev[0],next[2]-prev[2])};
});
for (let i=0;i<count;i++) {
  const p=track[i];
  p.curve=angle(track[indexAt(i+1)].yaw-track[indexAt(i-1)].yaw)/(2*step);
  const bowl=p.section==='Karussell'||p.section==='Mini-Karussell';
  p.bank=bowl?-clamp((p.curve-.002)*13,0,p.section==='Karussell'?.43:.28):-clamp(p.curve*1.6,-.045,.045);
}
const rawBanks=track.map(p=>p.bank);
track.forEach((p,i)=>{p.bank=(rawBanks[indexAt(i-1)]+2*rawBanks[i]+rawBanks[indexAt(i+1)])/4;});
track.push({...track[0],s:length});

function profile(bank,half,lateral) {
  return Math.abs(bank)>.065 ? bank*clamp(lateral,-half*.55,half*.86) : bank*lateral;
}
function location(i,t,lateral) {
  const a=track[i],b=track[i+1],yaw=a.yaw+angle(b.yaw-a.yaw)*t;
  const half=mix(a.half,b.half,t),bank=mix(a.bank,b.bank,t);
  return {x:mix(a.x,b.x,t)+Math.cos(yaw)*lateral,z:mix(a.z,b.z,t)-Math.sin(yaw)*lateral,
    y:mix(a.y,b.y,t)+profile(bank,half,lateral),yaw,half,curve:mix(a.curve,b.curve,t),
    railRight:mix(a.railRight,b.railRight,t),railLeft:mix(a.railLeft,b.railLeft,t),
    grade:mix(a.grade,b.grade,t),bank:profile(bank,half,lateral+.5)-profile(bank,half,lateral-.5),section:a.section};
}
export function pose(distance,lateral=0) {
  const pos=wrap(distance)/step,i=Math.min(count-1,Math.floor(pos));
  return location(i,pos-i,lateral);
}
function makeEdges(points,side=1) {
  return points.slice(0,-1).map((a,i)=>{
    const b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,size=Math.hypot(dx,dz);
    return {i,x:a.x,z:a.z,dx,dz,inv:1/(size*size),nx:side*dz/size,nz:-side*dx/size};
  });
}
const centerline=makeEdges(track);
const rails=[-1,1].map(side=>makeEdges(track.map(p=>({
  x:p.x+side*railFaceAt(p,side)*Math.cos(p.yaw),z:p.z-side*railFaceAt(p,side)*Math.sin(p.yaw),
})),side));
const grid=new Map(),cell=96;
const gridKey=(i,j)=>i+','+j;
for (const edge of centerline) {
  const x=edge.x+edge.dx,z=edge.z+edge.dz;
  for(let j=Math.floor((Math.min(edge.z,z)-cell)/cell);j<=Math.floor((Math.max(edge.z,z)+cell)/cell);j++)
    for(let i=Math.floor((Math.min(edge.x,x)-cell)/cell);i<=Math.floor((Math.max(edge.x,x)+cell)/cell);i++) {
      const key=gridKey(i,j);
      if (!grid.has(key)) grid.set(key,[]);
      grid.get(key).push(edge);
    }
}
function project(x,z,edges,radius=Infinity) {
  let best=radius*radius,chosen,t,lateral;
  for (const edge of edges) {
    const ox=x-edge.x,oz=z-edge.z;
    const f=clamp((ox*edge.dx+oz*edge.dz)*edge.inv,0,1),rx=ox-f*edge.dx,rz=oz-f*edge.dz;
    const d=rx*rx+rz*rz;
    if (d>=best) continue;
    best=d; chosen=edge; t=f; lateral=rx*edge.nx+rz*edge.nz;
  }
  if (!chosen) return null;
  const i=chosen.i;
  return {...location(i,t,lateral),s:(i+t)*step,index:i,lateral,distance:Math.sqrt(best)};
}
export function localRoad(x,z,radius=90) {
  const edges=grid.get(gridKey(Math.floor(x/cell),Math.floor(z/cell)));
  return edges?project(x,z,edges,Math.min(radius,cell)):null;
}
export const nearest=(x,z)=>localRoad(x,z)||project(x,z,centerline);
// The pit divider ends before the separate outside rail of the merge begins.
export const pitOpening=(side,index)=>side<0 && index===17;
const pitOffsets=[];
for(let i=1;i<pitDeparture.length;i++) {
  const [a,b]=[pitDeparture[i-1],pitDeparture[i]],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);
  for(let j=0;j<=n;j++) {
    const p=nearest(mix(a[0],b[0],j/n),mix(a[1],b[1],j/n));
    const station=p.s>length/2?p.s-length:p.s;
    if(!pitOffsets.length || station>pitOffsets[pitOffsets.length-1][0]+.02)pitOffsets.push([station,p.lateral]);
  }
}
export const pitMerge=pitOffsets[pitOffsets.length-1][0];
export function pitOffset(s) {
  let i=0,end=pitOffsets.length-1;
  while(i+1<end) {const k=(i+end)>>1;if(pitOffsets[k][0]<=s)i=k;else end=k;}
  const a=pitOffsets[i],b=pitOffsets[end];
  return mix(a[1],b[1],clamp((s-a[0])/(b[0]-a[0]),0,1));
}
// Set pit approach speeds from the curvature of the mapped apron and merge, then
// propagate braking distances backwards. The limit applies along the straight apron.
const pitStations=Array.from({length:Math.ceil(pitMerge/2)+7},(_,i)=>{
  const s=i*2;return pose(s,pitOffset(s));
});
const pitSpeeds=pitStations.map((p,i,all)=>{
  const a=all[Math.max(0,i-2)],b=all[Math.min(all.length-1,i+2)];
  const bend=Math.abs(angle(Math.atan2(b.x-p.x,b.z-p.z)-Math.atan2(p.x-a.x,p.z-a.z)))/4;
  return Math.min(60/3.6,Math.sqrt(4.5/Math.max(.001,bend)));
});
pitSpeeds[0]=pitSpeeds[1];
for(let i=pitSpeeds.length-2;i>=0;i--)pitSpeeds[i]=Math.min(pitSpeeds[i],Math.sqrt(pitSpeeds[i+1]**2+16));
export function pitPace(s) {
  const i=clamp(s/2,0,pitSpeeds.length-1.001),a=Math.floor(i);
  return mix(pitSpeeds[a],pitSpeeds[a+1],i-a);
}
export function railClearance(x,z,side,index) {
  const edges=rails[side>0?1:0];
  let best=Infinity,gap=Infinity,nx=0,nz=0;
  for (let j=-3;j<=3;j++) {
    const edge=edges[indexAt(index+j)];
    if(pitOpening(side,edge.i))continue;
    const ox=x-edge.x,oz=z-edge.z;
    const t=clamp((ox*edge.dx+oz*edge.dz)*edge.inv,0,1),rx=ox-t*edge.dx,rz=oz-t*edge.dz;
    const d=rx*rx+rz*rz;
    if (d>=best) continue;
    best=d; nx=edge.nx; nz=edge.nz; gap=-(rx*nx+rz*nz);
  }
  return {gap,nx,nz};
}
// Clip the oriented body rectangle to each finite steel segment. This also tests a
// rail joint landing between two body corners in the tight, banked hairpins.
export function bodyRailClearance(x,z,yaw,halfWidth,halfLength,side,index) {
  const es=rails[side>0?1:0],sn=Math.sin(yaw),cs=Math.cos(yaw);
  const corners=[[-halfWidth,-halfLength],[halfWidth,-halfLength],[halfWidth,halfLength],[-halfWidth,halfLength]]
    .map(([a,b])=>[x+a*cs+b*sn,z-a*sn+b*cs]);
  let gap=Infinity,nx=0,nz=0;
  for(let j=-2;j<=2;j++) {
    const e=es[indexAt(index+j)];
    if(pitOpening(side,e.i))continue;
    const proj=corners.map(([px,pz])=>{
      const dx=px-e.x,dz=pz-e.z;
      return [(dx*e.dx+dz*e.dz)*e.inv,dx*e.nx+dz*e.nz];
    });
    let out=-Infinity;
    for(let k=0;k<4;k++) {
      const [t,d]=proj[k],[next,h]=proj[(k+1)%4];
      if(t>=0 && t<=1) out=Math.max(out,d);
      for(const end of [0,1]) if((end-t)*(end-next)<0) out=Math.max(out,mix(d,h,(end-t)/(next-t)));
    }
    if(-out<gap) {gap=-out;nx=e.nx;nz=e.nz;}
  }
  return {gap,nx,nz};
}
export function relief(x,z) {
  const u=clamp((x-origin[0])/spacing,0,columns-1.001),v=clamp((z-origin[1])/spacing,0,heights.length/columns-1.001);
  const i=Math.floor(u),j=Math.floor(v),a=j*columns+i;
  return mix(mix(heights[a],heights[a+1],u-i),mix(heights[a+columns],heights[a+columns+1],u-i),v-j);
}
export function ground(x,z) {
  const terrain=relief(x,z),near=localRoad(x,z,90);
  if (!near) return terrain;
  const roadY=pose(near.s).y;
  return mix(roadY-3.4,terrain,smooth(clamp((near.distance-26)/64,0,1)));
}

export const kerbWidth=.76, slabLength=1.6;
export function kerbSide(p) {
  if (p.section==='T13'||p.section==='Karussell'||p.section==='Mini-Karussell'||Math.abs(p.curve)<.0025) return 0;
  return Math.sign(p.curve);
}
export function kerbRise(s,t) {
  if (t<=0||t>=1) return 0;
  const phase=wrap(s)/.8;
  const ribs=.5-.5*Math.cos(2*Math.PI*phase);
  return Math.min(t/.27,1,(1-t)/.26)*(.063+.026*ribs);
}
export function surfaceAt(s,lateral) {
  const p=pose(s,lateral),edge=Math.abs(lateral)-p.half,side=Math.sign(lateral);
  const onKerb=side===kerbSide(p)&&edge>=-.10&&edge<kerbWidth-.10;
  const kerb=onKerb?kerbRise(s,(edge+.10)/kerbWidth):0;
  const concrete=p.bank<-.065 && lateral>=-p.half*.55 && lateral<=p.half*.86;
  const station=wrap(s);
  const pit=station<pitMerge+2 && lateral<0 && Math.abs(lateral-pitOffset(station))<3.52;
  const kind=pit?'asphalt':onKerb?'kerb':edge>0?'grass':concrete?'concrete':'asphalt';
  return {kind,kerb,y:p.y+kerb,mu:kind==='grass'?.50:kind==='kerb'?.89:concrete?1.02:1.13};
}
