import {angle,bodyRailClearance,clamp,gridSlot,length,nearest,pitMerge,pitOffset,pitPace,pose,railFaceAt,wrap} from './track.js';
import {drivingState,driveVehicle,finishVehicle} from './vehicle.js';
import {Coach,lineOffset,targetSpeed} from './coach.js';

export const laps = 3;
export const drivers = [
  {number: '07', name: '你', color: '#caff51'},
  {number: '24', name: 'NOVA', color: '#ef694d'},
  {number: '13', name: 'VOSS', color: '#70b8ef'},
  {number: '86', name: 'SATO', color: '#ffbc52'},
  {number: '42', name: 'RIVERA', color: '#e8e9ee'},
  {number: '51', name: 'BLAKE', color: '#b591ec'},
];

// R8 dimensions include the mirrors. The length allowance covers the projection on a grade.
const halfWidth=1.022, halfLength=2.31, contactSkin=.04;
function resolveRails(car) {
  let course=nearest(car.x,car.z);
  const side=Math.sign(course.lateral), wasTouching=car.railContact;
  car.railContact=false;
  const width=halfWidth+1.24*Math.abs(Math.sin((car.roadRoll||course.bank)+(car.bodyRoll||0)));
  const nose=halfLength+.5*Math.abs(course.grade);
  if (Math.abs(course.lateral)<railFaceAt(course,side)-Math.hypot(width,nose)-.18) return course;
  for (let pass=0;pass<5;pass++) {
    const closest=bodyRailClearance(car.x,car.z,car.yaw,width,nose,side,course.index);
    if (closest.gap>contactSkin+.003) break;
    car.railContact=true;
    const {nx,nz}=closest, outward=car.vx*nx+car.vz*nz;
    if (outward>0) {
      car.vx-=nx*outward; car.vz-=nz*outward;
      const scrape=1-Math.min(wasTouching?.025:.32,outward*.013);
      car.vx*=scrape; car.vz*=scrape;
    }
    if (closest.gap>=contactSkin) break;
    const push=contactSkin-closest.gap+.001;
    car.x-=nx*push; car.z-=nz*push;
    course=nearest(car.x,car.z);
  }
  return course;
}

function followLine(car,look,lane=0) {
  const station=car.s+look,base=pose(station);
  const lateral=clamp(lineOffset(station)+lane,-base.half+1.25,base.half-1.25);
  return steerAt(car,look,pose(station,lateral));
}
function steerAt(car,look,aim) {
  const error=angle(Math.atan2(aim.x-car.x,aim.z-car.z)-car.yaw);
  const lock=.046+.52/(1+(car.speed/12)**1.7);
  return clamp((Math.atan(2*2.65*Math.sin(error)/look)+error*.23)/lock,-1,1);
}

// Both drivers lose the closing component of velocity. Use both body axes through corners.
function separateCars(a,b) {
  const dx=b.x-a.x,dz=b.z-a.z;
  if(dx*dx+dz*dz>25)return;
  const axes=c=>[[Math.cos(c.yaw),-Math.sin(c.yaw)],[Math.sin(c.yaw),Math.cos(c.yaw)]];
  const aa=axes(a),bb=axes(b);
  let penetration=Infinity,nx=0,nz=0;
  for(const [x,z] of [...aa,...bb]) {
    const radius=axes=>Math.abs(axes[0][0]*x+axes[0][1]*z)*.98+Math.abs(axes[1][0]*x+axes[1][1]*z)*2.22;
    const distance=dx*x+dz*z, overlap=radius(aa)+radius(bb)-Math.abs(distance);
    if(overlap<=0) return;
    if(overlap<penetration) {penetration=overlap;nx=x*Math.sign(distance||1);nz=z*Math.sign(distance||1);}
  }
  const shift=(penetration+.002)*.5, closing=Math.max(0,(a.vx-b.vx)*nx+(a.vz-b.vz)*nz)*.52;
  a.x-=shift*nx;a.z-=shift*nz;b.x+=shift*nx;b.z+=shift*nz;
  a.vx-=closing*nx;a.vz-=closing*nz;b.vx+=closing*nx;b.vz+=closing*nz;
}

function opponentInput(car,index,field,beginner,dt) {
  const speed=car.speed,look=9+speed*.46;
  // Practice drivers use the lesson pace. Each driver's throttle, brakes and tyres remain physical.
  let target=targetSpeed(car.s+speed*.47,beginner)*(beginner?.90+index*.015:.80+index*.024);
  const launchLane=clamp((85-car.s)/80,0,1);
  let lane=(car.lane-lineOffset(car.s+look))*launchLane;
  let leader=null,closest=Infinity;
  for(const other of field) {
    if(other===car) continue;
    const gap=wrap(other.s-car.s);
    if(gap<closest && gap<Math.max(17,speed*.90) && Math.abs((other.lateral||0)-(car.lateral||0))<2.65) {leader=other;closest=gap;}
  }
  const course=pose(car.s+look);
  let passing=field[car.passIndex];
  if(passing) {
    const gap=wrap(passing.s-car.s+length/2)-length/2;
    if(gap< -6.5 || gap>45 || (passing.speed>4 && Math.abs(course.curve)>.013)) {
      car.passIndex=-1;passing=null;
    }
  }
  if(leader) {
    const their=leader.lateral||0,side=their>=0?-1:1,stopped=leader.speed<4;
    const pass=stopped?side*(course.half-1.55):their+side*2.8;
    if(!passing && Math.abs(pass)<course.half-1.3 && (stopped || Math.abs(course.curve)<.006) && target>leader.speed+.7) {
      passing=leader;car.passIndex=field.indexOf(leader);car.passLane=pass;
    }
    if(!passing || Math.abs((car.lateral||0)-their)<2.1) {
      const followSpeed=Math.max(0,leader.speed+(closest-6.8)*.30);
      target=Math.min(target,passing===leader && stopped?Math.max(2.5,followSpeed):followSpeed);
    }
  }
  const lookSteer=passing && passing.speed<4?Math.min(look,3.7+speed*.30):look;
  if(passing) lane=clamp(car.passLane,-course.half+1.30,course.half-1.30)-lineOffset(car.s+lookSteer);
  car.aimLane+=(lane-car.aimLane)*(1-Math.exp(-dt*(passing?5:2)));
  const error=target-speed;
  return {steer:followLine(car,lookSteer,car.aimLane),gas:clamp(error*.5+.25,0,1),brake:clamp(-error*.30,0,.94)};
}

export class Race {
  constructor() {
    this.beginner=true;this.showLine=true;
    this.reset();
  }
  reset(mode = 'race') {
    this.pitStart=mode==='pit';
    this.mode=this.pitStart?'trial':mode;
    this.firstTiming=this.pitStart?length:0;
    this.phase = 'menu';
    this.time = 0;
    this.countdown = 3;
    this.lapStart = 0;
    this.completed = 0;
    this.best = Infinity;
    
    this.cars = (mode === 'race' ? drivers : drivers.slice(0,1)).map((driver,i) => {
      const order = i === 0 ? 3 : i <= 3 ? i-1 : i;
      const grid=gridSlot(order);
      const s=this.pitStart?12:mode==='trial'?-7:grid.s;
      const lane=this.pitStart?pitOffset(s):mode==='trial'?0:grid.lane;
      return {driver,...pose(s,lane),inPit:this.pitStart,s,lastS:wrap(s),lane,lateral:lane,aimLane:lane,passIndex:-1,passLane:lane,...drivingState(),keyHold:0,keyDir:0,steeringAssist:0,assistBrake:0,traveled:0,finish:null};
    });
    this.coach=new Coach(this.player.s);
  }
  get player() { return this.cars[0]; }
  get order() {
    return [...this.cars].sort((a,b) =>
      (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.s - a.s);
  }
  recover() {
    const car = this.player;
    const center=pose(car.s,car.inPit?pitOffset(car.s):0);
    Object.assign(car,center,drivingState(),{lastS:wrap(car.s),keyHold:0,keyDir:0,steeringAssist:0,assistBrake:0});
    this.coach.reset(car.s);
  }
  inputs(car,control,dt) {
    if(car.inPit) {
      const look=4.7+car.speed*.30,station=car.s+look;
      const aim=pose(station,pitOffset(station));
      const guide=steerAt(car,look,aim),limit=pitPace(car.s+car.speed*.43);
      car.steeringAssist=guide;car.assistBrake=clamp((car.speed-limit)*.36,0,.70);
      return {steer:guide,gas:(control.gas||0)*clamp((limit-car.speed)*.65+.23,0,1),
        brake:car.speed<.45?0:Math.max(control.brake||0,car.assistBrake)};
    }
    const steer=control.steer||0,sign=Math.sign(steer);
    car.keyHold=sign && sign===car.keyDir?Math.min(1.2,car.keyHold+dt):0;
    car.keyDir=sign;
    const speed=car.speed;
    const progressive=control.analog?steer:steer*(.27+.73*Math.min(1,car.keyHold/(.25+.35*Math.min(1,speed/40))));
    car.steeringAssist=0;car.assistBrake=0;
    if(!this.beginner || control.hand || car.vx*Math.sin(car.yaw)+car.vz*Math.cos(car.yaw)<-.8)
      return {...control,steer:progressive};
    const guide=followLine(car,9+speed*.46);
    const influence=control.analog?Math.abs(steer):Math.abs(progressive);
    const override=influence*(.64+.22*Math.min(1,car.keyHold/.65));
    const assisted=guide*(1-override)+progressive*.88;
    const target=targetSpeed(car.s+speed*.47,true);
    const slowing=clamp((speed-target)*.29,0,.83);
    // Driver retains the accelerator and can brake harder or override the guide with deliberate steering.
    car.steeringAssist=guide*(1-override);
    car.assistBrake=control.brake?0:slowing;
    return {...control,steer:clamp(assisted,-1,1),gas:(control.gas||0)*clamp((target-speed)*.55+.28,0,1),
      brake:Math.max(control.brake||0,slowing)};
  }
  step(dt, control={}) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'running';
      return;
    }
    if (this.phase !== 'running') return;
    this.time += dt;

    const car = this.player;
    // Take all decisions from the same field state, then advance the six identical cars.
    const inputs=this.cars.map((c,i)=>i?opponentInput(c,i,this.cars,this.beginner,dt):this.inputs(c,control,dt));
    this.cars.forEach((c,i)=>driveVehicle(c,inputs[i],nearest(c.x,c.z),dt));
    for(let i=0;i<this.cars.length;i++) for(let j=i+1;j<this.cars.length;j++) separateCars(this.cars[i],this.cars[j]);
    for(const racer of this.cars) {
      const pitLane=racer.inPit && racer.s<144;
      const hit=pitLane?nearest(racer.x,racer.z):resolveRails(racer),delta=hit.s-racer.lastS;
      racer.s+=delta-length*Math.round(delta/length);
      racer.lastS=hit.s;racer.lateral=hit.lateral;
      if(racer.inPit && racer.s>=pitMerge)racer.inPit=false;
      finishVehicle(racer,hit,dt);
      if(racer!==car && racer.finish===null && racer.s>=laps*length)racer.finish=this.time;
    }
    this.coach.step(car,this.time);

    if (this.completed === 0 && car.s >= this.firstTiming) {
      this.completed = 1;
      this.lapStart = this.time;
    }
    if (this.completed > 0 && car.s >= this.firstTiming+this.completed*length) {
      this.best = Math.min(this.best,this.time-this.lapStart);
      this.completed++;
      this.lapStart=this.time;
      if (this.completed > laps) {
        car.finish=this.time;
        this.phase='finished';
      }
    }
  }
}

export function telemetry(car) {
  return {kmh:Math.round(car.speed*3.6),gear:car.gear,rpm:clamp(car.rpm/8700,0,1)};
}
