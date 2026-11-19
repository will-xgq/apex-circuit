import {angle,clamp,length,mix,pose,step,track,wrap} from './track.js';

import {offsets} from '../assets/nordschleife/line.js';

const n=track.length-1;
export function lineOffset(s) {
  const u=wrap(s)/step,i=Math.floor(u);
  return mix(offsets[i],offsets[(i+1)%n],u-i);
}
export const linePose=s=>pose(s,lineOffset(s));
const line=track.slice(0,n).map(p=>linePose(p.s));
const tangent=line.map((p,i)=>{const a=line[(i+n-1)%n],b=line[(i+1)%n];return Math.atan2(b.x-a.x,b.z-a.z);});
const speeds=track.slice(0,n).map((p,i)=>{
  const curve=angle(tangent[(i+1)%n]-tangent[(i+n-1)%n])/(2*step);
  const lateral=8.8-9.81*p.bank*Math.sign(curve);
  return Math.min(81,Math.sqrt(lateral/Math.max(.00065,Math.abs(curve))));
});
for(let lap=0;lap<3;lap++) {
  for(let i=0;i<n;i++) {
    const prev=(i+n-1)%n,v=speeds[prev],accel=clamp(370000/(1670*Math.max(12,v)),.6,8.8)-.00026*v*v-.15-9.81*track[prev].grade;
    speeds[i]=Math.min(speeds[i],Math.sqrt(Math.max(36,v*v+2*accel*step)));
  }
  for(let i=n-1;i>=0;i--) {
    const next=(i+1)%n,v=speeds[next],decel=8.1+9.81*track[i].grade;
    speeds[i]=Math.min(speeds[i],Math.sqrt(v*v+2*decel*step));
  }
}
export function referenceSpeed(s) {
  const u=wrap(s)/step,i=Math.floor(u);
  return mix(speeds[i],speeds[(i+1)%n],u-i);
}
export const lessonSpeed=v=>Math.min(53,v*.73);
export const targetSpeed=(s,beginner)=>beginner?lessonSpeed(referenceSpeed(s)):referenceSpeed(s);
export const corners=[];
let run=null;
function closeRun() {
  if (!run) return;
  const {first,last,apex,sign}=run;
  if ((last-first)*step>=16 && Math.abs(track[apex].curve)>.0031 && last>apex-1) {
    const entry=first*step,exit=Math.min(length,(last+1)*step),p=track[apex];
    corners.push({entry,apex:apex*step,exit,sign,name:p.section,
      entrySpeed:referenceSpeed(entry),exitSpeed:referenceSpeed(exit),apexSpeed:referenceSpeed(p.s)});
  }
  run=null;
}
for(let i=0;i<n;i++) {
  const k=track[i].curve,sign=Math.sign(k);
  if(Math.abs(k)<.00175) { if(run && i-run.last>3) closeRun();continue; }
  if(!run||run.sign!==sign||i-run.last>4) { closeRun();run={first:i,last:i,apex:i,sign}; }
  run.last=i;if(Math.abs(k)>Math.abs(track[run.apex].curve)) run.apex=i;
}
closeRun();
function nextCorner(s) {
  const pos=wrap(s),lapOffset=s-pos;
  let i=corners.findIndex(t=>t.exit>pos);
  if (i<0) return {corner:corners[0],base:lapOffset+length};
  return {corner:corners[i],base:lapOffset};
}
export class Coach {
  constructor(s=-37) {this.reset(s);}
  reset(s) { this.lastS=s;this.lastSpeed=0;this.entry=null;this.lastResult=null;this.current=nextCorner(Math.max(0,s)); }
  step(car,time) {
    const s=car.s,delta=s-this.lastS;
    if (delta<-.6||delta>15) {this.reset(s);return;}
    const {corner,base}=this.current;
    const crossed=gate=>delta>0 && this.lastS<gate && s>=gate;
    const measured=gate=>mix(this.lastSpeed,car.speed,clamp((gate-this.lastS)/Math.max(.001,delta),0,1));
    if (crossed(base+corner.entry)) this.entry=measured(base+corner.entry);
    if (crossed(base+corner.exit)) {
      if(this.entry!==null) this.lastResult={name:corner.name,entry:this.entry,exit:measured(base+corner.exit),
        targetIn:corner.entrySpeed,targetOut:corner.exitSpeed,time};
      this.entry=null;
    }
    this.current=nextCorner(Math.max(0,s));
    const next=this.current, nextEntry=next.base+next.corner.entry;
    if((next.corner!==corner || next.base!==base) && crossed(nextEntry)) this.entry=measured(nextEntry);
    this.lastS=s;this.lastSpeed=car.speed;
  }
  advice(car,beginner=false) {
    const {corner:c,base}=this.current,distance=base+c.entry-car.s,toApex=base+c.apex-car.s;
    const slope=pose(car.s).grade,brakeDist=Math.max(0,(car.speed**2-(beginner?lessonSpeed(c.entrySpeed):c.entrySpeed)**2)/(2*(8.1+9.81*slope)));
    const target=targetSpeed(car.s,beginner);
    let cue='保持线路',stage='approach';
    if(distance>0) {
      if (distance<=brakeDist+car.speed*.38 && car.speed>(beginner?lessonSpeed(c.entrySpeed):c.entrySpeed)+1.1) {cue='直线制动';stage='brake';}
      else if(distance<Math.max(30,car.speed*1.9)) {cue='准备转入';stage='turn';}
    } else if(toApex>10) {cue=car.speed>target+2?'减速，收向弯心':'渐松刹车';stage='turn';}
    else if(toApex>=-10) {cue='贴近弯心';stage='apex';}
    else {cue='回方向，逐步补油';stage='exit';}
    const result=this.lastResult;
    return {corner:c,distance:Math.max(0,distance),cue,stage,actualIn:this.entry,
      result,heading:c.sign>0?'左弯':'右弯',key:base+c.entry};
  }
}
