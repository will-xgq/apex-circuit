import {accessRoads,bridges,buildings,pavedAreas} from '../assets/nordschleife/roadside.js';
import {woodlandRows} from '../assets/nordschleife/woodland.js';
import {localRoad,pose,railFaceAt,terrainBounds} from './track.js';

export function wooded(x,z) {
  const col=Math.floor((x-terrainBounds.x)/10),row=woodlandRows[Math.floor((z-terrainBounds.z)/10)];
  if(!row) return false;
  for(let i=0;i<row.length;i+=2) {
    if(col<row[i]) return false;
    if(col<row[i+1]) return true;
  }
  return false;
}

export const boards=[['T13','START / ZIEL'],['BOXENGASSE','T13  •  PIT LANE'],['SABINE-SCHMITZ-KURVE','NORDSCHLEIFE'],['BRÜNNCHEN','NORDSCHLEIFE'],['ANTONIUSBUCHE','NORDSCHLEIFE'],['AUSFAHRT','PIT EXIT   →'],['BOX 01','T13  /  SERVICE'],['BOX 02','T13  /  SERVICE'],['BOX 03','T13  /  SERVICE']];

function sign(mesh,s,l,h,width,height,row) {
  const p=pose(s,l),yaw=p.yaw,cs=Math.cos(yaw),sn=Math.sin(yaw);
  const point=(w,y)=>[p.x+cs*w,p.y+y,p.z-sn*w];
  for(const w of [-width*.34,width*.34]) mesh.box(p.x+cs*w,p.y+h*.5,p.z-sn*w,.09,h,.11,[.39,.42,.42],4,yaw);
  mesh.panel(point(width/2,h+height),point(-width/2,h+height),point(-width/2,h),point(width/2,h),[0,0,row],[1,0,row],[1,1,row],[0,1,row],13);
}

function grandstand(mesh,points,heightAt) {
  const cx=points.reduce((n,p)=>n+p[0],0)/points.length,cz=points.reduce((n,p)=>n+p[1],0)/points.length;
  const yaw=Math.atan2(84,77),sn=Math.sin(yaw),cs=Math.cos(yaw);
  const along=points.map(([x,z])=>(x-cx)*sn+(z-cz)*cs),across=points.map(([x,z])=>(x-cx)*cs-(z-cz)*sn);
  const low=Math.min(...along),high=Math.max(...along),edge=Math.max(...across),back=Math.min(...across);
  const world=(u,v)=>[cx+sn*u+cs*v,cz+cs*u-sn*v];
  const pos=(u,v,h)=>{const [x,z]=world(u,v);return [x,heightAt(x,z)+h,z];};
  const risers=12,rise=.375,tread=(edge-back)/risers;
  for(let bay=0;bay<6;bay++) {
    const u=low+(high-low)*bay/6,v=low+(high-low)*(bay+1)/6;
    for(let row=0;row<risers;row++) {
      const a=edge-row*tread,b=a-tread,h=.36+row*rise;
      mesh.quad(pos(u,a,h),pos(v,a,h),pos(v,b,h),pos(u,b,h),[.63,.64,.62]);
      mesh.quad(pos(u,a,h-rise),pos(v,a,h-rise),pos(v,a,h),pos(u,a,h),[.39,.40,.39]);
      for(const end of [u,v]) mesh.quad(pos(end,a,0),pos(end,b,0),pos(end,b,h),pos(end,a,h),[.43,.44,.42]);
      const seat=[.34,.373,.398];
      mesh.quad(pos(u+.8,b+.43,h+.13),pos(v-.8,b+.43,h+.13),pos(v-.8,b+.12,h+.13),pos(u+.8,b+.12,h+.13),seat,4);
    }
    for(const a of [u,v]) {const [x,y,z]=pos(a,back,.36+risers*rise+.45);mesh.box(x,y,z,.075,.95,.08,[.46,.48,.46],4,yaw);}
    mesh.quad(pos(u,back,5.45),pos(v,back,5.45),pos(v,back,5.53),pos(u,back,5.53),[.56,.58,.58],4);
  }
  // Portable service shelters, wheel stacks and drawer cabinets inside the working apron.
  for(const [box,s] of [30,63,96].entries()) {
    const middle=pose(s);
    const front=-17.65,back=-22.4;
    const location=(u,v,h)=>{const p=pose(s+u,v);return [p.x,heightAt(p.x,p.z)+h,p.z];};
    const mpoint=(u,v,h,w,t,d,color,mat=0)=>{const [x,y,z]=location(u,v,h);mesh.box(x,y,z,w,t,d,color,mat,middle.yaw);};
    const span=4.0,low=2.62,high=3.12,ridge=(front+back)/2;
    const fabric=box===1?[.27,.29,.31]:[.72,.73,.70];
    for(const v of [front,back]) {
      mesh.quad(location(-span,v,low),location(span,v,low),location(span,ridge,high),location(-span,ridge,high),fabric);
      mesh.quad(location(-span,v,low-.28),location(span,v,low-.28),location(span,v,low),location(-span,v,low),[.20,.23,.24]);
      for(const u of [-span,span]) mpoint(u,v,low/2,.065,low,.065,[.55,.58,.58],4);
    }
    const a=location(-span,front,low),b=location(-span,back,low),c=location(-span,ridge,high);
    mesh.tri(a,b,c,fabric);
    mesh.panel(location(-span-.04,front,low),location(-span-.04,back,low),location(-span-.04,back,low-.45),location(-span-.04,front,low-.45),[0,0,6+box],[1,0,6+box],[1,1,6+box],[0,1,6+box],13);
    // Work surface, a red roller chest, and three used racing tyres with open centres.
    mpoint(.8,back+.6,1.02,.74,.11,2.1,[.45,.47,.46],4);
    mpoint(-1.9,front-.6,.51,.72,.91,1.15,[.46,.12,.102]);
    for(let i=0;i<4;i++)mpoint(-1.9,front-.22,.27+i*.16,.025,.025,.94,[.67,.67,.64],4);
    const [tx,ty,tz]=location(2.5,front-.58,0);
    for(let j=0;j<3;j++)for(let n=0;n<16;n++) {
      const tire=(i,r,h)=>[tx+r*Math.cos(i*Math.PI/8),ty+j*.23+h,tz+r*Math.sin(i*Math.PI/8)];
      mesh.quad(tire(n,.345,.018),tire(n+1,.345,.018),tire(n+1,.345,.213),tire(n,.345,.213),[.101,.106,.107]);
      mesh.quad(tire(n,.345,.213),tire(n+1,.345,.213),tire(n+1,.207,.218),tire(n,.207,.218),[.145,.151,.15]);
    }
    for(let u=-span;u<span;u+=4)mpoint(u+1.24,ridge,low+.11,.07,.055,1.65,[.85,.85,.77]);
  }
  sign(mesh,11,-19,.75,2.6,1.00,1);

}

export function addLandmarks(tileFor,heightAt) {
  const meshAt=(x,z)=>tileFor(x,z).mesh;
  for(const [kind,height,points,roof] of buildings) {
    const mid=points.reduce(([x,z],p)=>[x+p[0]/points.length,z+p[1]/points.length],[0,0]);
    const mesh=meshAt(...mid);
    if(kind==='stand') {grandstand(mesh,points,heightAt);continue;}
    const base=points.map(([x,z])=>heightAt(x,z)),eave=Math.max(...base)+height;
    const top=points.map(([x,z])=>[x,eave,z]);
    for(let i=0;i<points.length;i++) {
      const j=(i+1)%points.length,[x,z]=points[i],[xx,zz]=points[j],width=Math.hypot(xx-x,zz-z);
      const type=kind==='garage'?2:kind==='hall'?1:0;
      mesh.panel([x,base[i]-.28,z],[xx,base[j]-.28,zz],top[j],top[i],[0,-.28,type],[width,-.28,type],[width,eave-base[j],type],[0,eave-base[i],type],14);
    }
    const color=kind==='house'?[.29,.285,.273]:[.38,.398,.40];
    for(const [a,b,c] of roof) mesh.tri(top[c],top[b],top[a],color);
  }
  for(const [gravel,points,tris] of pavedAreas) {
    const top=points.map(([x,z])=>[x,heightAt(x,z)+.095,z]);
    for(const [a,b,c] of tris) meshAt(top[a][0],top[a][2]).tri(top[c],top[b],top[a],gravel?[.61,.58,.51]:[.32,.33,.33],gravel?8:1);
  }
  for(const [width,points] of accessRoads) {
    for(let i=1;i<points.length;i++) {
      const [x,z]=points[i-1],[xx,zz]=points[i],size=Math.hypot(xx-x,zz-z);
      if(size<.01) continue;
      const steps=Math.ceil(size/4),nx=(zz-z)/size,nz=(x-xx)/size;
      const point=(f,l,h)=>{const px=x+(xx-x)*f+nx*l,pz=z+(zz-z)*f+nz*l;return [px,heightAt(px,pz)+h,pz];};
      for(let j=0;j<steps;j++) {
        const a=j/steps,b=(j+1)/steps,m=meshAt(x+(xx-x)*a,z+(zz-z)*a),half=width/2;
        const pavement=(left,right,h,mark)=>{
          const pts=[point(a,left,h),point(b,left,h),point(b,right,h),point(a,right,h)];
          const colors=pts.map(([x,,z])=>{const course=localRoad(x,z,24);return [course?Math.abs(course.lateral)-course.half:16,mark,0];});
          m.panel(...pts,...colors,16);
        };
        pavement(-half,half,.067,0);
        if(width===7)for(const side of [-1,1]) {
          const k=side*(half-.12);pavement(k-.045,k+.045,.077,1);
        }
      }
    }
  }
  // Both road bridges use their mapped crossing and skew, including the Antoniusbuche overpass.
  for(const [width,pts] of bridges) {
    const [a,b]=[pts[0],pts[pts.length-1]],x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,p=localRoad(x,z),mesh=meshAt(x,z);
    if(!p)continue;
    const span=Math.hypot(b[0]-a[0],b[1]-a[1]),yaw=Math.atan2(b[0]-a[0],b[1]-a[1]);
    mesh.box(x,p.y+5.1,z,width,1.05,span,[.49,.50,.475],0,yaw);
    for(const side of [-1,1]) {
      const x1=x+side*Math.cos(yaw)*(width/2-.12),z1=z-side*Math.sin(yaw)*(width/2-.12);
      mesh.box(x1,p.y+5.97,z1,.20,.82,span,[.46,.465,.45],4,yaw);
    }
    for(const f of [.09,.91]) {const px=a[0]+(b[0]-a[0])*f,pz=a[1]+(b[1]-a[1])*f;mesh.box(px,p.y+1.75,pz,width+.35,5.8,1.0,[.43,.44,.415],0,yaw);}
  }
  for(const [s,side,margin,h,w,dh,row] of [[2,-1,.42,1.2,3.0,1.36,0],[199,-1,2.5,1.2,2.0,.85,5],[220,1,1,1.24,3.7,.90,2],[14435,-1,1.15,1.15,3,.92,3],[19827,1,1.15,1.18,3.1,.85,4]]) {
    const p=pose(s),l=side*(railFaceAt(p,side)+margin+w/2),center=pose(s,l);
    sign(meshAt(center.x,center.z),s,l,h,w,dh,row);
  }
}
