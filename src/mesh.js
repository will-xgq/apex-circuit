import {roadsideTrees} from '../assets/nordschleife/roadside.js';
import {addLandmarks,wooded} from './scenery.js';
import {lineOffset,referenceSpeed} from './coach.js';
import {clamp,gridSlot,ground,kerbRise,kerbSide,kerbWidth,length,localRoad,mix,pitMerge,pitOffset,pitOpening,pose,railFaceAt,slabLength,terrainBounds,track} from './track.js';

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
  box(x,y,z,w,h,d,color,material=0,yaw=0) {
    const sin=Math.sin(yaw), cos=Math.cos(yaw);
    const points=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
      [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(([a,b,c])=>[
        x + a*w/2*cos + c*d/2*sin, y+b*h/2, z+c*d/2*cos-a*w/2*sin]);
    const faces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]];
    for (const [a,b,c,d] of faces) this.quad(points[a],points[b],points[c],points[d],color,material);
  }
}

const road = (s,l,y=0) => {
  const p=pose(s,l);
  return [p.x,p.y+y,p.z];
};
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
  function band(mesh,p,q,leftA,leftB,rightA,rightB,h,color,mat=0) {
    mesh.quad(vertex(p,leftA,h),vertex(q,leftB,h),vertex(q,rightB,h),vertex(p,rightA,h),color,mat);
  }
  function roadsideY(x,z,near=localRoad(x,z,58)) {
    const base=terrainY(x,z);
    if(!near) return base;
    const outer=Math.max(railFaceAt(near,Math.sign(near.lateral))+.9,near.s<222?23:0);
    const t=clamp((Math.abs(near.lateral)-outer)/19,0,1);
    return mix(near.y,base-.18,t*t*(3-2*t));
  }
  function verge(p,side,t) {
    const face=railFaceAt(p,side),end=Math.max(face+21,41);
    const offset=mix(p.half+.42,end,t),out=pose(p.s,side*offset);
    return [out.x,roadsideY(out.x,out.z,{...out,s:p.s,lateral:side*offset})+.016,out.z];
  }
  function fence(p,side) {
    const mapped=side<0?p.fenceRight:p.fenceLeft,face=railFaceAt(p,side);
    if(mapped>face+.36) return mapped;
    // Mesh protects exposed spectator areas where the OSM fence stops short of the sector.
    if((p.section==='T13'&&side>0)||(p.section==='Brünnchen'&&side<0)||(p.section==='Pflanzgarten'&&side<0)) return face+1.15;
    return 0;
  }
  const grass=[.315,.375,.22],paint=[.82,.82,.76],asphalt=[.272,.278,.282];
  for(let i=0;i<track.length-1;i++) {
    const p=track[i],q=track[i+1],mesh=tileFor(p.x,p.z).mesh;
    const bowl=p.section==='Karussell'||p.section==='Mini-Karussell';
    if (bowl) {
      const fractions=[-1,-.55,0,.86,1];
      for(let k=1;k<fractions.length;k++) {
        const a=fractions[k-1],b=fractions[k];
        const concrete=k===2||k===3;
        band(mesh,p,q,p.half*a,q.half*a,p.half*b,q.half*b,.035,concrete?(i%2?[.58,.55,.50]:[.54,.52,.48]):asphalt,concrete?8:1);
      }
    } else band(mesh,p,q,-p.half,-q.half,p.half,q.half,.035,asphalt,1);
    for(const side of [-1,1]) {
      const a=side*p.half,b=side*q.half,faceA=railFaceAt(p,side),faceB=railFaceAt(q,side);
      band(mesh,p,q,a-side*.19-.045,b-side*.19-.045,a-side*.19+.045,b-side*.19+.045,.054,paint);
      band(mesh,p,q,a,b,a+side*.42,b+side*.42,.018,grass,2);
      for(const [t,u] of [[0,.35],[.35,.65],[.65,1]]) {
        const a1=verge(p,side,t),b1=verge(q,side,t),a2=verge(p,side,u),b2=verge(q,side,u);
        if(side>0) mesh.quad(a1,b1,b2,a2,grass,10);else mesh.quad(a2,b2,b1,a1,grass,10);
      }
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
      for (const [lo,hi] of [[0,.27],[.27,.74],[.74,1]]) {
        const pt=(s,t)=>{const h=pose(s).half; return road(s,side*(h-.10+t*kerbWidth),.041+kerbRise(s,t));};
        for(let u=a;u<b-.005;u+=.4) {
          const v=Math.min(u+.4,b);
          if(side>0) mesh.quad(pt(u,lo),pt(v,lo),pt(v,hi),pt(u,hi),color,6);
          else mesh.quad(pt(u,hi),pt(v,hi),pt(v,lo),pt(u,lo),color,6);
        }
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
