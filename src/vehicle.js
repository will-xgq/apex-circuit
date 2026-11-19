import {angle,clamp,mix,nearest,surfaceAt} from './track.js';

const mass=1670,gravity=9.81,wheelbase=2.65,frontArm=1.48,rearArm=wheelbase-frontArm;
const wheelRadius=.335,ratios=[13.969,9.287,6.746,5.080,4.003,3.171,2.343];
const torqueCurve=[[850,209],[1800,350],[3200,455],[4800,505],[6000,558],[6600,580],[7400,560],[8000,544],[8700,433]];
export const wheels=[{x:.8225,z:1.22},{x:-.8225,z:1.22},{x:.7995,z:-1.43},{x:-.7995,z:-1.43}];
const approach=(a,b,rate,dt)=>mix(a,b,1-Math.exp(-rate*dt));
function torque(rpm) {
  for (let i=1;i<torqueCurve.length;i++) {
    const [r,t]=torqueCurve[i],[prev,power]=torqueCurve[i-1];
    if (rpm<=r) return mix(power,t,clamp((rpm-prev)/(r-prev),0,1));
  }
  return 0;
}
export const drivingState=()=>({
  vx:0,vz:0,speed:0,steer:0,steerAngle:0,yawRate:0,driftAngle:0,drifting:false,railContact:false,
  gear:1,gearMode:'auto',rpm:850,throttle:0,brakePedal:0,brake:false,shiftTime:0,shiftLock:0,shiftSerial:0,accel:0,lateralG:0,
  wheelLift:[0,0,0,0],kerbLoad:0,kerbSide:0,grassLoad:0,concreteLoad:0,roughness:0,bodyLift:0,bodyRoll:0,bodyPitch:0,roadRoll:0,scrub:0,surface:'asphalt',
});
function transmission(car,u,dt) {
  const wheelRpm=Math.abs(u)*60/(2*Math.PI*wheelRadius);
  car.shiftLock=Math.max(0,car.shiftLock-dt); car.shiftTime=Math.max(0,car.shiftTime-dt);
  const gear=car.gear,rpm=wheelRpm*ratios[gear-1];
  if (u>0 && car.shiftLock===0 && car.gearMode!=='manual') {
    if (gear<ratios.length && car.brakePedal<.035 && car.throttle>.10 && rpm>mix(5650,8480,car.throttle)) car.gear++;
    else if (gear>1 && rpm<mix(2450,4050,car.throttle) && wheelRpm*ratios[gear-2]<7550) car.gear--;
    if (car.gear!==gear) { car.shiftTime=.091; car.shiftLock=.39; car.shiftSerial++; }
  }
  const clutchFloor=car.gear===1 && car.throttle>.1?850+car.throttle*2860:850;
  const target=Math.max(clutchFloor,wheelRpm*ratios[car.gear-1]);
  car.rpm=approach(car.rpm,clamp(target,850,8700),car.shiftTime?22:15,dt);
  const cut=car.shiftTime>.025?.15:1;
  return target>8700?0:torque(car.rpm)*ratios[car.gear-1]*.92/wheelRadius*car.throttle*cut;
}
export function shiftGear(car,delta) {
  car.gearMode='manual';
  if(car.shiftLock>0) return;
  const gear=clamp(car.gear+delta,1,7);
  const rpm=car.speed*60/(2*Math.PI*wheelRadius)*ratios[gear-1];
  if(gear===car.gear || rpm>8640) return;
  car.gear=gear;car.shiftTime=.091;car.shiftLock=.24;car.shiftSerial++;
}
function contacts(car,dt) {
  const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw);
  let kerbs=0,grass=0,concrete=0,side=0,rough=0;
  const grip=wheels.map((wheel,i)=>{
    const x=car.x+wheel.x*cos+wheel.z*sin,z=car.z-wheel.x*sin+wheel.z*cos;
    const near=nearest(x,z),surface=surfaceAt(near.s,near.lateral);
    if (surface.kind==='kerb') { kerbs++; side+=Math.sign(wheel.x); }
    if (surface.kind==='grass') grass++;
    if (surface.kind==='concrete') concrete++;
    const target=surface.kerb+(surface.kind==='grass'?.016*Math.sin(near.s*3.7+i):0);
    rough+=Math.abs(target-car.wheelLift[i]);
    car.wheelLift[i]=approach(car.wheelLift[i],target,35,dt);
    return surface.mu;
  });
  car.kerbLoad=kerbs/4; car.kerbSide=Math.sign(side);
  car.grassLoad=grass/4; car.concreteLoad=concrete/4;
  car.roughness=approach(car.roughness,rough/4,17,dt);
  car.surface=kerbs?'kerb':grass?'grass':concrete?'concrete':'asphalt';
  return {front:(grip[0]+grip[1])/2,rear:(grip[2]+grip[3])/2,grass:car.grassLoad};
}
function tyreForce(slip,stiffness,limit,longitudinal) {
  const available=Math.sqrt(Math.max(0,limit*limit-longitudinal*longitudinal));
  return available*Math.tanh(stiffness*slip/Math.max(available,1));
}
export function driveVehicle(car,input,course,dt) {
  const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw);
  const u=car.vx*sin+car.vz*cos,v=car.vx*cos-car.vz*sin;
  const tyres=contacts(car,dt),direc=angle(car.yaw-course.yaw);
  car.throttle=approach(car.throttle,input.brake?0:(input.gas||0),input.gas?10:17,dt);
  car.brakePedal=approach(car.brakePedal,Number(input.brake||0),15,dt);
  car.brake=car.brakePedal>.06||!!input.hand;
  car.steer=approach(car.steer,input.steer||0,7.2,dt);
  const lock=.046+.52/(1+(Math.abs(u)/12)**1.7);
  car.steerAngle=car.steer*lock;
  const shiftingForce=transmission(car,u,dt);
  const frontLoad=clamp(mass*(gravity*rearArm-.48*car.accel)/wheelbase,mass*gravity*.22,mass*gravity*.73);
  const rearLoad=mass*gravity-frontLoad;
  const frontLimit=tyres.front*frontLoad,rearLimit=tyres.rear*rearLoad*(input.hand?.57:1);
  // Slip-limited four-wheel drive, front-biased braking, and a lockable rear axle.
  const reverse=car.brakePedal>.1 && u<.45;
  const service=reverse?0:car.brakePedal*mass*12.1;
  let demand=shiftingForce;
  if (reverse) demand=-car.brakePedal*mass*2.6;
  if (u>1.2) demand-=(1-car.throttle)*mass*(.29+.70*car.rpm/8500);
  const hand=input.hand?Math.sign(u)*Math.min(rearLimit,Math.abs(u)*mass/dt):0;
  const bias=clamp(.26+.60*frontLoad/(mass*gravity),.57,.74);
  const frontFx=clamp(demand*.38-service*bias,-frontLimit*.94,frontLimit*.96);
  const rearFx=clamp(demand*.62-service*(1-bias)-hand,-rearLimit*(input.hand?.99:.89),rearLimit*.96);
  const forwardSpeed=Math.max(Math.abs(u),3.8),steer=car.steerAngle;
  const frontSlip=steer-Math.atan2(v+frontArm*car.yawRate,forwardSpeed);
  const rearSlip=-Math.atan2(v-rearArm*car.yawRate,forwardSpeed);
  const frontFy=tyreForce(frontSlip,93500,frontLimit,frontFx);
  const rearFy=tyreForce(rearSlip,112000,rearLimit,rearFx);
  const fy=frontFy*Math.cos(steer)+frontFx*Math.sin(steer);
  const drag=.5*1.225*.35*2.01*u*Math.abs(u);
  const resistance=Math.sign(u)*Math.min(Math.abs(u)*mass/dt,mass*gravity*(.013+.09*tyres.grass));
  const slope=course.grade*Math.cos(direc)+course.bank*Math.sin(direc);
  let ax=(frontFx*Math.cos(steer)-frontFy*Math.sin(steer)+rearFx-drag-resistance)/mass-gravity*slope;
  if (u<-8 && ax<0) ax=0;
  const ay=(fy+rearFy)/mass-gravity*(course.bank*Math.cos(direc)-course.grade*Math.sin(direc));
  const blend=clamp((u-2.2)/4,0,1);
  const yawLimit=gravity*(tyres.front+tyres.rear)*.5/Math.max(6,u);
  const neutralYaw=clamp(u*Math.tan(steer)/(wheelbase+.0013*u*u),-yawLimit,yawLimit);
  const sideslip=Math.atan2(v,Math.max(4,u));
  const stability=input.hand || u<6 ? 0 : clamp((neutralYaw-car.yawRate)*2.9+sideslip*6.2,-2.1,2.1);
  const rate=car.yawRate+((frontArm*fy-rearArm*rearFy)/2460+stability)*dt;
  car.yawRate=mix(u*Math.tan(steer)/wheelbase,clamp(rate,-2.8,2.8),blend);
  const stopped=Math.abs(u)<.12 && !input.gas && !input.brake;
  const next=stopped?0:u+ax*dt;
  const side=mix(v*Math.exp(-dt*13),v+ay*dt,blend);
  car.vx=sin*next+cos*side; car.vz=cos*next-sin*side;
  car.yaw=angle(car.yaw+car.yawRate*dt);
  car.x+=car.vx*dt; car.z+=car.vz*dt;
  car.accel=approach(car.accel,ax,9,dt); car.lateralG=approach(car.lateralG,ay/gravity,11,dt);
  car.scrub=clamp((Math.max(Math.abs(frontSlip),Math.abs(rearSlip))-.055)*3.2,0,1)*clamp((u-3)/10,0,1);
  const [fl,fr,rl,rr]=car.wheelLift;
  car.bodyLift=approach(car.bodyLift,(fl+fr+rl+rr)/4,12,dt);
  car.bodyRoll=approach(car.bodyRoll,clamp(car.lateralG*.028+(fl+rl-fr-rr)/3.2,-.10,.10),11,dt);
  car.bodyPitch=approach(car.bodyPitch,clamp(car.accel*.0022+(fl+fr-rl-rr)/5.3,-.06,.06),9,dt);
}
export function finishVehicle(car,course,dt) {
  const sin=Math.sin(car.yaw),cos=Math.cos(car.yaw),u=car.vx*sin+car.vz*cos,v=car.vx*cos-car.vz*sin;
  car.speed=Math.hypot(car.vx,car.vz); car.traveled+=Math.sign(u)*car.speed*dt;
  car.driftAngle=u>3?Math.atan2(v,u):0;
  car.drifting=!car.railContact && u>7 && Math.abs(car.driftAngle)>.14 && car.scrub>.18;
  const relative=angle(car.yaw-course.yaw);
  car.pitch=Math.atan(course.grade*Math.cos(relative)+course.bank*Math.sin(relative));
  car.roadRoll=Math.atan(course.bank*Math.cos(relative)-course.grade*Math.sin(relative));
  car.y=course.y;
}
