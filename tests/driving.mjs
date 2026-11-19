import assert from 'node:assert/strict';
import {Coach,corners,lineOffset,targetSpeed} from '../src/coach.js';
import {shiftGear} from '../src/vehicle.js';
import {Race,laps} from '../src/race.js';
import {angle,clamp,length,nearest,pose,pitMerge,pitOffset,railFaceAt,surfaceAt,kerbSide,track,wrap} from '../src/track.js';

const dt=1/120;
function place(s=40,lane=0,speed=0,yawOffset=0,mode='trial') {
  const race=new Race();
  race.reset(mode); race.beginner=false;race.phase='running';
  const p=race.player, at=pose(s,lane), yaw=at.yaw+yawOffset;
  Object.assign(p,at,{s,lastS:wrap(s),yaw,vx:speed*Math.sin(yaw),vz:speed*Math.cos(yaw),speed});
  return race;
}
function run(race,steps,controls) {
  for (let i=0;i<steps;i++) race.step(dt,controls);
}
// Compare against the actual straight chords joined by the rail mesh, independently of the contact solver.
const rails=[-1,1].map(sign=>track.map(p=>pose(p.s,sign*railFaceAt(p,sign))));
function cross(a,b,c) { return (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x); }
function crosses(a,b,c,d) { return cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0; }
function inside(car) {
  const near=nearest(car.x,car.z),n=track.length-1;
  assert.ok(Number.isFinite(car.speed) && Math.abs(near.lateral)<railFaceAt(near,Math.sign(near.lateral)),'car centre outside the rails');
  const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw);
  const corners=[[-1.019,-2.26],[1.019,-2.26],[1.019,2.26],[-1.019,2.26]].map(([w,h])=>
    ({x:car.x+w*cos+h*sin,z:car.z-w*sin+h*cos}));
  const edge=rails[near.lateral>0?1:0];
  for (let j=-7;j<=7;j++) {
    const k=(near.index+j+n)%n;
    for (let i=0;i<4;i++) assert.ok(!crosses(corners[i],corners[(i+1)%4],edge[k],edge[k+1]),'R8 crosses steel face at '+near.s);
  }
}

let impacts=0;
for (const s of [0,80,690,4032,7704,12104,14560,17000,length-.4]) {
  for (const sign of [-1,1]) for (const degrees of [-145,-85,-35,0,35,85,145]) {
    const race=place(s,sign*(railFaceAt(pose(s),sign)-.5),0,sign*degrees*Math.PI/180);
    const at=pose(s),car=race.player;
    car.vx=31*Math.sin(at.yaw)+sign*71*Math.cos(at.yaw);
    car.vz=31*Math.cos(at.yaw)-sign*71*Math.sin(at.yaw);
    race.step(dt,{gas:1}); inside(car);
    assert.ok(car.railContact,'first impact is detected');
    assert.ok(!car.drifting);
    for (let i=0;i<18;i++) { race.step(dt,{gas:1,steer:sign}); inside(car); }
    impacts++;
  }
}
const graze=place(18300,railFaceAt(pose(18300),1)-1.05,32);
graze.player.vx+=Math.cos(graze.player.yaw)*6;graze.player.vz-=Math.sin(graze.player.yaw)*6;
graze.step(dt,{});assert.ok(graze.player.railContact && graze.player.speed>26);
const curvy=track.find(p=>Math.abs(p.curve)>.008 && kerbSide(p));
const edge=kerbSide(curvy)*(curvy.half+.25);
assert.equal(surfaceAt(curvy.s,edge).kind,'kerb');
assert.ok(surfaceAt(curvy.s+.4,edge).kerb>surfaceAt(curvy.s,edge).kerb+.01);
assert.equal(surfaceAt(12104,0).kind,'concrete');assert.ok(pose(12104).bank<-.20);
const bump=place(curvy.s,kerbSide(curvy)*(curvy.half-.54),13);
run(bump,12,{gas:.15});assert.ok(bump.player.kerbLoad>0 && bump.player.wheelLift.some(x=>x>.018));
assert.ok(bump.player.wheelLift.some(x=>x<.005),'suspension reacts at the individual wheels');
const flat=place(18300,0,0);let launch=0;
while(flat.player.speed<100/3.6 && launch<6) {flat.step(dt,{gas:1});launch+=dt;}
assert.ok(launch>2.8 && launch<3.7 && flat.player.gear===2);
const topRpm=flat.player.rpm;
run(flat,60,{brake:1});assert.ok(flat.player.speed<24 && flat.player.gear<=2 && flat.player.brakePedal>.9 && flat.player.rpm<topRpm);
const manual=place(18400,0,30);
shiftGear(manual.player,1);assert.equal(manual.player.gear,2);
run(manual,35,{});shiftGear(manual.player,-1);
assert.equal(manual.player.gear,2,'protect against downshifts beyond the limiter');
const reverse=place(18200);run(reverse,160,{brake:1});
assert.ok(reverse.player.vx*Math.sin(reverse.player.yaw)+reverse.player.vz*Math.cos(reverse.player.yaw)<-1);
const normal=place(18300,0,22),slide=place(18300,0,22);
run(normal,80,{steer:1,gas:.55});run(slide,80,{steer:1,gas:.55,hand:true});
assert.ok(slide.player.scrub>normal.player.scrub && Math.abs(slide.player.driftAngle)>Math.abs(normal.player.driftAngle)+.035);
const steerTest=place(18000,0,33);
const tap=Math.abs(steerTest.inputs(steerTest.player,{steer:1},dt).steer);
let held=0;for(let i=0;i<120;i++) held=steerTest.inputs(steerTest.player,{steer:1},dt).steer;
assert.ok(tap<.35 && held>.95);
for(const p of track) assert.ok(Math.abs(lineOffset(p.s))<=p.half-1.48);
const turn=corners.find(c=>c.name==='Aremberg'),coach=new Coach(turn.entry-2);
coach.step({s:turn.entry+.1,speed:24},1);assert.ok(coach.entry!==null);
for(let s=turn.entry+2;s<=turn.exit+1;s+=1) coach.step({s,speed:26},2+s/25);
assert.ok(coach.lastResult && coach.lastResult.exit>25);
assert.ok(targetSpeed(turn.apex,true)<targetSpeed(turn.apex,false));
const lesson=new Race();lesson.reset('trial');lesson.phase='countdown';
let touches=0,slowing=0,reports=0,prev=null;
for(let i=0;i<120*850 && lesson.player.s<length+.1;i++) {
  lesson.step(dt,{gas:1});touches+=Number(lesson.player.railContact);slowing+=Number(lesson.player.assistBrake>.1);
  if(lesson.coach.lastResult!==prev){prev=lesson.coach.lastResult;reports++;}
}
assert.ok(lesson.player.s>=length && lesson.completed===2,'one full beginner lap holding only the accelerator');
assert.equal(touches,0);assert.ok(slowing>1000 && reports>80);
for(const mode of ['trial','race']) {
  const r=place(laps*length-1,0,16,0,mode);r.completed=laps;r.lapStart=0;r.time=420;
  run(r,35,{gas:.2});assert.equal(r.phase,'finished');assert.equal(r.completed,laps+1);assert.ok(Number.isFinite(r.best));
}
// Pit release uses the mapped outside branch. It must not push the R8 through the divider
// or start timing a lap after it has already left the timing line behind.
const pit=new Race();pit.reset('pit');pit.phase='running';
assert.ok(pit.player.inPit && pit.player.lateral< -9 && pit.firstTiming===length);
let peakInPit=0,pitHits=0;
while(pit.player.inPit && pit.time<35) {
  const car=pit.player;
  assert.ok(Math.abs(nearest(car.x,car.z).lateral-pitOffset(car.s))<2.1);
  peakInPit=Math.max(peakInPit,car.speed*3.6);pitHits+=Number(car.railContact);
  pit.step(dt,{gas:1});
}
assert.ok(!pit.player.inPit && pit.player.s>=pitMerge && peakInPit>57 && peakInPit<62);
assert.equal(pitHits,0);assert.equal(pit.completed,0);
const beforeLine=pose(length-1);
Object.assign(pit.player,beforeLine,{s:length-1,lastS:length-1,vx:14*Math.sin(beforeLine.yaw),vz:14*Math.cos(beforeLine.yaw)});
run(pit,45,{gas:.3});assert.equal(pit.completed,1);assert.equal(pit.best,Infinity);
const field=new Race();field.phase='running';const started=field.cars.map(c=>[c.x,c.z]);
run(field,120*18,{gas:1});
assert.equal(field.cars.length,6);
for(const [i,c] of field.cars.entries()) {
  assert.ok(c.gear>1 && c.shiftSerial>0 && c.rpm>1600 && Math.hypot(c.vx,c.vz)>9,'each R8 must drive through its own transmission and tyres');
  assert.ok(Math.hypot(c.x-started[i][0],c.z-started[i][1])>45);inside(c);
}
const parked=new Race();parked.phase='running';const gridStation=parked.player.s;
run(parked,120*20,{});
assert.ok(Math.abs(parked.player.s-gridStation)<.65,'the field should pass a stationary car at the start');
assert.ok(parked.cars.slice(1).every(c=>c.s>120),'all five competitors clear the grid');
lesson.phase='paused';const before=JSON.stringify(lesson.player);run(lesson,90,{gas:1});assert.equal(JSON.stringify(lesson.player),before);
lesson.recover();assert.equal(lesson.player.speed,0);assert.equal(lesson.player.rpm,850);
console.log(impacts+' rail impacts; four-wheel kerbs, six R8 drivetrains, pit merge/out-lap, coach, full beginner lap and race timing passed.');
console.log('Accelerator-only lap: '+(lesson.time/60).toFixed(2)+' min, '+touches+' guardrail contacts, '+reports+' corner reports.');
