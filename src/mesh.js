import {roadsideTrees} from '../assets/nordschleife/roadside.js';
import {addLandmarks,wooded} from './scenery.js';
import {lineOffset,referenceSpeed} from './coach.js';
import {angle,clamp,concreteBank,concreteLeft,concreteRight,crossfall,gridSlot,ground,kerbRise,kerbSide,kerbWidth,length,localRoad,mix,pitMerge,pitOffset,pitOpening,pose,railFaceAt,slabLength,step,terrainBounds,track,wrap} from './track.js';

const sub = (a,b) => a.map((value,i)=>value-b[i]);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const norm = a => a.map(value=>value/(Math.hypot(...a)||1));

class Mesh {
  data = [];
  tri(a,b,c,color,material=0,colorB=color,colorC=color) {
    const normal=norm(cross(sub(b,a),sub(c,a)));
    this.data.push(...a,...normal,...color,material,...b,...normal,...colorB,material,...c,...normal,...colorC,material);
  }
  quad(a,b,c,d,color,material=0) {
    this.tri(a,b,c,color,material);
    this.tri(a,c,d,color,material);
  }
  panel(a,b,c,d,ua,ub,uc,ud,material) {
    this.tri(a,b,c,ua,material,ub,uc);this.tri(a,c,d,ua,material,uc,ud);
  }
  smoothPanel(points,normals,colors,material) {
    for(const i of [0,1,2,0,2,3]) this.data.push(...points[i],...normals[i],...colors[i],material);
  }
  box(x,y,z,w,h,d,color,material=0,yaw=0) {
    const sin=Math.sin(yaw), cos=Math.cos(yaw);
    const points=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
      [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([a,b,c])=>[
        x + a*w/2*cos + c*d/2*sin, y+b*h/2, z+c*d/2*cos-a*w/2*sin]);
    const faces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]];
    for (const [a,b,c,d] of faces) this.quad(points[a],points[b],points[c],points[d],color,material);
  }
}

// Hermite offsets take the pavement through every surveyed station and tangent.
const arcs=track.slice(0,-1).map((a,i)=>{
  const b=track[i+1],x=b.x-a.x,z=b.z-a.z,h=Math.hypot(x,z);
  return [h*Math.sin(a.yaw)-x,h*Math.cos(a.yaw)-z,x-h*Math.sin(b.yaw),z-h*Math.cos(b.yaw)];
});
const bankRates=arcs.map((_,i)=>{
  const n=arcs.length;
  return (track[(i+1)%n].bank-track[(i+n-1)%n].bank)/(2*step);
});
function pavementStation(s) {
  const f=wrap(s)/step,i=Math.min(arcs.length-1,Math.floor(f)),t=f-i,k=t*(1-t),a=arcs[i];
  const p=pose(s);
  return {...p,s,x:p.x+k*mix(a[0],a[2],t),z:p.z+k*mix(a[1],a[3],t),
    rightX:Math.cos(p.yaw),rightZ:-Math.sin(p.yaw),line:lineOffset(s),
    bankRate:mix(bankRates[i],bankRates[(i+1)%arcs.length],t)};
}
function pavementVertex(p,l,h=0) {
  return [p.x+p.rightX*l,p.y+crossfall(p.centerBank,p.half,l)+h,p.z+p.rightZ*l];
}
const road=(s,l,y=0)=>pavementVertex(pavementStation(s),l,y);
function strip(mesh,a,b,l,r,y,color,material=0) {
  mesh.quad(road(a,l,y),road(b,l,y),road(b,r,y),road(a,r,y),color,material);
}
function seeded(seed) {
  return () => {
    seed = (Math.imul(1664525, seed)+1013904223) >>> 0;
    return seed/4294967296;
  };
}

const tileSize=300, terrainStep=30;
export function landscape() {
  const tiles=new Map(),random=seeded(1947);
  function tileFor(x,z) {
    const i=Math.floor(x/tileSize),j=Math.floor(z/tileSize),key=i+','+j;
    if (!tiles.has(key)) tiles.set(key,{x:(i+.5)*tileSize,z:(j+.5)*tileSize,radius:235,mesh:new Mesh(),trees:[]});
    return tiles.get(key);
  }
  const {x:minX,z:minZ,right,top}=terrainBounds;
  const nx=Math.ceil((right-minX)/terrainStep),nz=Math.ceil((top-minZ)/terrainStep);
  const heights=new Float32Array((nx+1)*(nz+1));
  const idx=(i,j)=>j*(nx+1)+i;
  for(let j=0;j<=nz;j++) for(let i=0;i<=nx;i++) heights[idx(i,j)]=ground(minX+i*terrainStep,minZ+j*terrainStep);
  function terrainY(x,z) {
    const gx=clamp((x-minX)/terrainStep,0,nx-.001),gz=clamp((z-minZ)/terrainStep,0,nz-.001);
    const i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j;
    const a=heights[idx(i,j)],b=heights[idx(i,j+1)],c=heights[idx(i+1,j+1)],d=heights[idx(i+1,j)];
    return v>u?a*(1-v)+b*(v-u)+c*u:a*(1-u)+c*v+d*(u-v);
  }
  const terrainColor=(x,z)=>{
    const v=.83+.11*Math.sin(x*.013+z*.010)+.07*Math.cos(z*.032-x*.012);
    return [.31*v,.375*v,.213*v];
  };
  for(let j=0;j<nz;j++) for(let i=0;i<nx;i++) {
    const x=minX+i*terrainStep,z=minZ+j*terrainStep,w=terrainStep;
    const a=[x,heights[idx(i,j)],z],b=[x,heights[idx(i,j+1)],z+w],c=[x+w,heights[idx(i+1,j+1)],z+w],d=[x+w,heights[idx(i+1,j)],z];
    const mesh=tileFor(x+w/2,z+w/2).mesh,ca=terrainColor(x,z),cc=terrainColor(x+w,z+w);
    mesh.tri(a,b,c,ca,10,terrainColor(x,z+w),cc); mesh.tri(a,c,d,ca,10,cc,terrainColor(x+w,z));
  }
  const vertex=(p,l,h=0)=>{
    const point=pose(p.s,l);
    return [point.x,point.y+h,point.z];
  };
  function roadsideY(x,z,near=localRoad(x,z,58)) {
    const base=terrainY(x,z);
    if(!near) return base;
    const outer=Math.max(railFaceAt(near,Math.sign(near.lateral))+.9,near.s<222?23:0);
    const t=clamp((Math.abs(near.lateral)-outer)/19,0,1);
    return mix(near.y,base-.18,t*t*(3-2*t));
  }
  function vergePoint(p,side,band) {
    const outer=Math.max(railFaceAt(p,side)+21,41);
    // An inner verge wider than the turn radius folds back through the roadway.
    const limit=side*p.curve>.003 ? clamp(.79/(side*p.curve),p.half+4,outer) : outer;
    const offset=[p.half,p.half+.56,Math.min(p.half+3.4,limit),mix(p.half+3.4,limit,.48),limit][band];
    const at=pavementVertex(p,side*offset);
    const y=roadsideY(at[0],at[2],{...p,y:at[1],lateral:side*offset});
    const field=(1-clamp((offset-railFaceAt(p,side)-.5)/Math.max(4,limit-railFaceAt(p,side)-.5),0,1));
    return {point:[at[0],y+.016,at[2]],distance:offset-p.half,field};
  }
  function pavement(mesh,a,b,bowl) {
    function row(p) {
      const h=p.half;
      const offsets=[-h,-h+.135,-h+.245,h*concreteLeft,.54,h*concreteRight,h-.245,h-.135,h];
      return offsets.map(l=>({l,point:pavementVertex(p,l,.035),uv:[p.s,l,l-p.line]}));
    }
    function normal(p,v,slope) {
      const grade=(p.grade+p.bankRate*clamp(v.l,p.half*concreteLeft,p.half*concreteRight))/
        Math.max(.55,1-p.curve*v.l);
      const sn=Math.sin(p.yaw),cs=Math.cos(p.yaw);
      return norm([-sn*grade-cs*slope,1,-cs*grade+sn*slope]);
    }
    const first=row(a),last=row(b);
    const materials=[18,20,18,bowl?19:18,bowl?19:18,18,20,18];
    const white=[.82,.81,.76];
    for(let i=0;i<materials.length;i++) {
      const corners=[first[i],last[i],last[i+1],first[i+1]];
      const slope=(lo,hi)=>(hi.point[1]-lo.point[1])/(hi.l-lo.l);
      const sa=slope(first[i],first[i+1]),sb=slope(last[i],last[i+1]);
      const normals=[normal(a,corners[0],sa),normal(b,corners[1],sb),normal(b,corners[2],sb),normal(a,corners[3],sa)];
      mesh.smoothPanel(corners.map(v=>v.point),normals,corners.map(v=>materials[i]===20?white:v.uv),materials[i]);
    }
    for(const side of [-1,1]) {
      const grassWeight=p=>side<0 && (p.s<pitMerge+5 || p.s>length-55)?0:1;
      let left=vergePoint(a,side,0),right=vergePoint(b,side,0);
      for(let band=1;band<=4;band++) {
        const nextLeft=vergePoint(a,side,band),nextRight=vergePoint(b,side,band);
        const attr=(pt,p)=>[pt.distance,grassWeight(p),pt.field];
        const quad=side>0?[left,right,nextRight,nextLeft]:[nextLeft,nextRight,right,left];
        mesh.panel(...quad.map(v=>v.point),attr(quad[0],a),attr(quad[1],b),attr(quad[2],b),attr(quad[3],a),21);
        left=nextLeft;right=nextRight;
      }
    }
  }
  function fence(p,side) {
    const mapped=side<0?p.fenceRight:p.fenceLeft,face=railFaceAt(p,side);
    if(mapped>face+.36) return mapped;
    // Mesh protects exposed spectator areas where the OSM fence stops short of the sector.
    if((p.section==='T13'&&side>0)||(p.section==='Brünnchen'&&side<0)||(p.section==='Pflanzgarten'&&side<0)) return face+1.15;
    return 0;
  }
  const paint=[.82,.82,.76];
  for(let i=0;i<track.length-1;i++) {
    const p=track[i],q=track[i+1],mesh=tileFor(p.x,p.z).mesh;
    const turns=Math.ceil(Math.abs(angle(q.yaw-p.yaw))/.062);
    const pieces=clamp(turns,1,6),cuts=Array.from({length:pieces+1},(_,j)=>j/pieces);
    // Put a real edge where the banked concrete starts and ends, including the entry ramp.
    if((p.bank+concreteBank)*(q.bank+concreteBank)<0) cuts.push((-concreteBank-p.bank)/(q.bank-p.bank));
    cuts.sort((a,b)=>a-b);
    let a=pavementStation(p.s);
    for(const t of cuts.slice(1)) {
      const b=pavementStation(mix(p.s,q.s,t));
      if(b.s-a.s>.0001) pavement(mesh,a,b,(a.centerBank+b.centerBank)*.5 < -concreteBank);
      a=b;
    }
    for(const side of [-1,1]) {
      const faceA=railFaceAt(p,side),faceB=railFaceAt(q,side);
      if(pitOpening(side,i))continue;
      const steel=(h,depth=0)=>[vertex(p,side*(faceA+depth),h),vertex(q,side*(faceB+depth),h)];
      for(let row=0;row<3;row++) {
        const h=.19+row*.308,[a0,b0]=steel(h,.07),[a1,b1]=steel(h+.145),[a2,b2]=steel(h+.287,.07);
        const u=p.s,v=q.s;
        mesh.panel(a0,b0,b1,a1,[u,0,row],[v,0,row],[v,.5,row],[u,.5,row],11);
        mesh.panel(a1,b1,b2,a2,[u,.5,row],[v,.5,row],[v,1,row],[u,1,row],11);
        if(row===2) {const [c,d]=steel(h+.284,.18);mesh.quad(a2,b2,d,c,[.68,.705,.71],4);}
      }
      const f1=fence(p,side),f2=fence(q,side);
      if(f1 && f2 && Math.abs(f1-f2)<6) {
        const a=pose(p.s,side*f1),b=pose(q.s,side*f2);
        const ay=roadsideY(a.x,a.z),by=roadsideY(b.x,b.z),width=Math.hypot(a.x-b.x,a.z-b.z);
        const draw=(h,k,lean1,lean2)=>{
          const pt=(pt,y,height,lean)=>[pt.x-side*Math.cos(pt.yaw)*lean,y+height,pt.z+side*Math.sin(pt.yaw)*lean];
          mesh.panel(pt(a,ay,h,lean1),pt(b,by,h,lean1),pt(b,by,k,lean2),pt(a,ay,k,lean2),[p.s,h,0],[p.s+width,h,0],[p.s+width,k,0],[p.s,k,0],12);
        };
        draw(.06,2.72,0,0); draw(2.72,3.15,0,.32);
        mesh.box(a.x,ay+1.40,a.z,.095,2.80,.11,[.38,.40,.385],4,a.yaw);
      }
    }
    // Individual painted kerb blocks share their height profile with the four contact patches.
    for(let a=p.s;a<q.s-.01;a+=slabLength) {
      const b=Math.min(a+slabLength,q.s),mid=pose((a+b)/2),side=kerbSide(mid);
      if (!side) continue;
      const color=Math.floor((a+.02)/slabLength)%2?[.73,.73,.67]:[.57,.125,.096];
      const kerbRow=s=>{
        const station=pavementStation(s);
        return [0,.27,.74,1].map(t=>pavementVertex(station,side*(station.half-.10+t*kerbWidth),.041+kerbRise(s,t)));
      };
      let last=kerbRow(a);
      for(let u=a;u<b-.005;u+=.4) {
        const next=kerbRow(Math.min(u+.4,b));
        for(let k=0;k<3;k++) {
          if(side>0) mesh.quad(last[k],next[k],next[k+1],last[k+1],color,6);
          else mesh.quad(last[k+1],next[k+1],next[k],last[k],color,6);
        }
        last=next;
      }
    }
  }
  for(let s=2;s<length;s+=9) {
    const mid=pose(s,lineOffset(s)),m=tileFor(mid.x,mid.z).mesh;
    const mark=(at,w)=>road(at,lineOffset(at)+w,.086);
    const tint=[referenceSpeed(s),s,referenceSpeed(s+20)-referenceSpeed(s)];
    m.quad(mark(s,-.145),mark(s+2.0,-.145),mark(s+2.0,.145),mark(s,.145),tint,9);
    m.tri(mark(s+1.86,-.36),mark(s+3.25,0),mark(s+1.86,.36),tint,9);
  }
  // Concrete working apron between the two mapped pit paths and the T13 grandstand.
  for(let s=-5;s<145;s+=2) {
    const rim=u=>mix(-20.9,-8.5,clamp((u-102)/42,0,1));
    const m=tileFor(pose(s).x,pose(s).z).mesh;
    m.quad(road(s,rim(s),.050),road(s+2,rim(s+2),.050),road(s+2,-6,.050),road(s,-6,.050),[.54,.545,.525],17);
    if(s>=15 && s<104 && (s-15)%18===0)strip(m,s,s+.09,-20.7,-16.9,.083,[.85,.82,.69]);
  }
  for(let s=14;s<pitMerge-2;s+=6) {
    const p=pose(s,pitOffset(s)),m=tileFor(p.x,p.z).mesh;
    const pt=(u,l)=>road(u,pitOffset(u)+l,.124);
    const color=[60/3.6,s,0];
    m.tri(pt(s,-.21),pt(s+.95,0),pt(s,.21),color,15);
  }
  for(let s=0;s<length;s+=4.0) for(const side of [-1,1]) {
    const p=pose(s,side*(railFaceAt(pose(s),side)+.16)),mesh=tileFor(p.x,p.z).mesh;
    mesh.box(p.x,p.y+.53,p.z,.13,1.06,.17,[.385,.40,.405],4,p.yaw);
    if(s%32===0) mesh.box(p.x,p.y+1.10,p.z,.14,.11,.10,side<0?[.82,.63,.33]:[.84,.85,.80],0,p.yaw);
  }
  const gate=pose(0),gateMesh=tileFor(gate.x,gate.z).mesh;
  strip(gateMesh,0,.42,-gate.half,gate.half,.095,paint);
  // Discreet staggered starting boxes on the T13 approach.
  for(let i=0;i<6;i++) {
    const {s,lane:l}=gridSlot(i),p=pose(s),m=tileFor(p.x,p.z).mesh;
    strip(m,s+.8,s+.91,l-1.16,l+1.16,.09,paint);
    for(const sign of [-1,1]) strip(m,s-.14,s+.90,l+sign*1.12-.043,l+sign*1.12+.043,.09,paint);
  }
  addLandmarks(tileFor,roadsideY);
  function tree(x,y,z,h) {
    const w=h*.672*(.83+.29*random());
    tileFor(x,z).trees.push(x,y-.08,z,h,w,Math.floor(random()*2),random()>.5?1:-1,.74+random()*.34);
  }
  // Individual mapped trees also belong in clearings, paddock grounds and village streets.
  for(const [x,z] of roadsideTrees) {
    const near=localRoad(x,z,60);
    if(near && Math.abs(near.lateral)<railFaceAt(near,Math.sign(near.lateral))+1.4)continue;
    tree(x,roadsideY(x,z),z,8.5+random()*7.5);
  }
  for(let s=0;s<length;s+=5.2) for(const side of [-1,1]) {
    const st=s+random()*4,p=pose(st),offset=railFaceAt(p,side)+3.6+random()*15;
    const pos=pose(st,side*offset);
    if(!wooded(pos.x,pos.z) || localRoad(pos.x,pos.z,p.half+2.8)) continue;
    tree(pos.x,roadsideY(pos.x,pos.z),pos.z,10+random()*11);
  }
  for(let z=minZ+15;z<top-15;z+=21) for(let x=minX+15;x<right-15;x+=21) {
    const wx=x+random()*19,wz=z+random()*19;
    if(!wooded(wx,wz) || localRoad(wx,wz,26)) continue;
    tree(wx,roadsideY(wx,wz),wz,12+random()*12);
  }
  const chunks=[],treeRows=[],groves=[];
  for(const tile of tiles.values()) {
    const {x,z,radius,mesh,trees}=tile;
    if(mesh.data.length) chunks.push({x,z,radius,vertices:new Float32Array(mesh.data)});
    if(trees.length) {groves.push({x,z,radius,first:treeRows.length/8,count:trees.length/8});treeRows.push(...trees);}
  }
  return {tiles:chunks,trees:new Float32Array(treeRows),groves};
}
