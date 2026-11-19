import {clamp,length,mix,nearest,pitMerge,pitPace,pose,railClearance,railFaceAt,track} from './track.js';
import {createSound} from './audio.js';
import {lessonSpeed,targetSpeed} from './coach.js';
import {shiftGear} from './vehicle.js';
import {drivers,laps,Race,telemetry} from './race.js';
import {landscape} from './mesh.js';
import {createRenderer} from './gpu.js';

const get = id => document.getElementById(id);
const world=get('world'), overlay=get('overlay'), primary=get('primary'), secondary=get('secondary');
const race=new Race(), keys=new Set(), pointers=new Map();
const views=['头盔座舱','追车视角','高位追车','车头视角'];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let view=0, ready=false, render, previous=0, accumulator=0, beforePause='running';
let enabled=true, audio, eye, target, cameraPace=0, lastOrder, goUntil=0, coachMode=1, footcam=true, lastCall='', steeringTouch=null;
let returnPhase='menu', studioYaw=.70, studioTilt=.34, studioZoom=1, drag;
const displayCar={x:0,y:0,z:0,yaw:0,steer:0,brake:false,traveled:0};

const map=get('map'), mapCtx=map.getContext('2d');
const dial=get('dial').getContext('2d');
const minX=Math.min(...track.map(p=>p.x)), maxX=Math.max(...track.map(p=>p.x));
const minZ=Math.min(...track.map(p=>p.z)), maxZ=Math.max(...track.map(p=>p.z));
const mapScale=Math.min((map.width-26)/(maxX-minX),(map.height-20)/(maxZ-minZ));
const mapPoint=p=>[map.width/2-(p.x-(minX+maxX)/2)*mapScale,map.height/2-(p.z-(minZ+maxZ)/2)*mapScale];
const outline=new Path2D();
track.forEach((p,i)=>{
  const point=mapPoint(p);
  if (i) outline.lineTo(...point);
  else outline.moveTo(...point);
});
outline.closePath();
get('distance').textContent=(length/1000).toFixed(3)+' KM';

function formatTime(time) {
  if (!Number.isFinite(time)) return '—';
  const total=Math.max(0,Math.floor(time*1000));
  return Math.floor(total/60000)+':'+String(Math.floor(total/1000)%60).padStart(2,'0')
    +'.'+String(total%1000).padStart(3,'0');
}

function drawDash(rpm) {
  dial.clearRect(0,0,420,420);
  dial.save();
  dial.translate(210,210);
  dial.lineCap='round';
  dial.beginPath();
  dial.arc(0,0,204,0,Math.PI*2);
  dial.fillStyle='#101610e8';
  dial.fill();
  dial.lineWidth=2;
  dial.strokeStyle='#d7e6cb65';
  dial.stroke();
  const begin=Math.PI*.75, sweep=Math.PI*1.5;
  const arc=(t1,t2,color,width)=>{
    dial.beginPath();
    dial.arc(0,0,184,begin+sweep*t1,begin+sweep*t2);
    dial.strokeStyle=color;
    dial.lineWidth=width;
    dial.stroke();
  };
  arc(0,1,'#ffffff2b',9);
  arc(.88,1,'#dc644a',9);
  arc(0,rpm,rpm>.88?'#f69854':'#d1f562',10);
  for(let tick=0;tick<=24;tick++) {
    const major=tick%3===0,a=begin+sweep*tick/24;
    const cos=Math.cos(a),sin=Math.sin(a);
    dial.beginPath();
    dial.moveTo(cos*171,sin*171);
    dial.lineTo(cos*(major?156:163),sin*(major?156:163));
    dial.strokeStyle=major?'#e9eee2':'#b3bcb185';
    dial.lineWidth=major?3:1.8;
    dial.stroke();
    if(!major) continue;
    dial.font='600 21px Barlow, sans-serif';
    dial.fillStyle='#e9eee2';
    dial.textAlign='center';
    dial.textBaseline='middle';
    dial.fillText(String(tick/3),cos*140,sin*140);
  }
  dial.restore();
}

function drawMap() {
  mapCtx.clearRect(0,0,map.width,map.height);
  mapCtx.lineJoin='round';
  mapCtx.strokeStyle='#eef5e7bf';
  mapCtx.lineWidth=3.5;
  mapCtx.stroke(outline);
  const start=mapPoint(track[0]);
  mapCtx.fillStyle='#edf1e9';
  mapCtx.fillRect(start[0]-2,start[1]-7,4,14);
  for(const car of [...race.cars].reverse()) {
    const [x,y]=mapPoint(car);
    mapCtx.fillStyle=car.driver.color;
    mapCtx.beginPath();
    mapCtx.arc(x,y,car===race.player?7:4,0,Math.PI*2);
    mapCtx.fill();
  }
}

function setOrdinal(element,current,total) {
  get(element).firstChild.textContent=String(current).padStart(2,'0')+' ';
  get(element).lastElementChild.textContent='/ '+String(total).padStart(2,'0');
}
function updateHUD() {
  const car=race.player, data=telemetry(car);
  get('speed').textContent=data.kmh;
  get('gear').textContent=data.kmh<1?'N':(car.vx*Math.sin(car.yaw)+car.vz*Math.cos(car.yaw)<0?'R':data.gear);
  get('lap-label').textContent=race.pitStart && !race.completed?'出站圈':'单圈';
  setOrdinal('lap',clamp(race.completed,1,laps),laps);
  get('lap-time').textContent=formatTime(race.completed>laps?race.best:race.completed?race.time-race.lapStart:0);
  get('best').textContent=formatTime(race.best);
  const order=race.order;
  setOrdinal('position',order.indexOf(car)+1,order.length);
  const orderKey=order.map(entry=>entry.driver.number).join(',');
  if (lastOrder!==orderKey) {
    const rows=order.map((entry,i)=>{
      const li=document.createElement('li'), rank=document.createElement('span');
      const dot=document.createElement('i'), name=document.createElement('span'), number=document.createElement('small');
      li.classList.toggle('self',entry===car);
      li.style.setProperty('--paint',entry.driver.color);
      rank.textContent=String(i+1).padStart(2,'0');
      name.textContent=entry.driver.name;
      number.textContent=entry.driver.number;
      li.append(rank,dot,name,number);
      return li;
    });
    get('positions').replaceChildren(...rows);
    lastOrder=orderKey;
  }
  const surfaces={kerb:car.kerbSide>0?'左轮压路肩':car.kerbSide<0?'右轮压路肩':'压路肩',grass:'草地',concrete:'倾斜混凝土',asphalt:'干燥柏油'};
  get('surface').textContent=(car.inPit?'维修通道':surfaces[car.surface])+' · '+(car.gearMode==='manual'?'手动挡':'自动挡');
  drawDash(data.rpm);drawMap();updateCoach();
}
function updateSound() {
  const active=enabled && (race.phase==='running'||race.phase==='countdown');
  audio?.update(race.player,active,view===0);
}
function initAudio() {
  if (!enabled) return;
  audio??=createSound();audio?.resume();
}
function updateCoach() {
  const show=coachMode>0 && ['running','countdown'].includes(race.phase);
  get('coach').hidden=!show;
  if(!show) return;
  const car=race.player,advice=race.coach.advice(car,race.beginner),corner=advice.corner;
  const kmh=v=>Math.round(v*3.6),limit=v=>race.beginner?lessonSpeed(v):v;
  const recommended=car.inPit?pitPace(car.s+car.speed*.43):targetSpeed(car.s+car.speed*.47,race.beginner);
  get('pace-actual').textContent=kmh(car.speed);get('pace-target').textContent=kmh(recommended);
  get('coach').dataset.pace=car.speed>recommended+2?'fast':car.speed>recommended-.6?'near':'open';
  get('coach').querySelector('.coach-speeds').hidden=!!car.inPit;
  if(car.inPit) {
    get('coach').dataset.stage='approach';get('coach-corner').textContent='T13 维修通道';
    get('coach-distance').textContent=Math.max(0,Math.ceil((pitMerge-car.s)/5)*5)+' m';
    get('coach-cue').textContent='按住油门出站，沿箭头并入赛道';get('coach-result').hidden=true;
    return;
  }
  get('coach').dataset.stage=advice.stage;
  get('coach-corner').textContent=corner.name;
  get('coach-distance').textContent=advice.distance>0?Math.ceil(advice.distance/5)*5+' m':'弯中';
  get('coach-cue').textContent=advice.heading+' · '+(car.assistBrake>.1?'辅助制动':advice.cue);
  get('coach-in').textContent=kmh(limit(corner.entrySpeed));get('coach-out').textContent=kmh(limit(corner.exitSpeed))+' km/h';
  let result='';
  if(advice.actualIn!=null) result='本弯实际入弯 '+kmh(advice.actualIn)+' km/h';
  else if(advice.result && race.time-advice.result.time<8) {
    const r=advice.result;result='上弯实测 '+kmh(r.entry)+' / '+kmh(r.exit)+' · 参考 '+kmh(limit(r.targetIn))+' / '+kmh(limit(r.targetOut));
  }
  get('coach-result').hidden=!result;get('coach-result').textContent=result;
  if(coachMode===2 && enabled && race.phase==='running' && 'speechSynthesis' in window) {
    const near=advice.distance<Math.max(65,car.speed*3)&&advice.distance>0;
    const cue=advice.stage==='brake'?'制动':near?advice.heading+'，入弯 '+kmh(limit(corner.entrySpeed)):null;
    const key=advice.key+'/'+(advice.stage==='brake'?'brake':'approach');
    if(cue && key!==lastCall) {lastCall=key;const voice=new SpeechSynthesisUtterance(cue);voice.lang='zh-CN';voice.rate=1.16;voice.volume=.75;window.speechSynthesis.cancel();window.speechSynthesis.speak(voice);}
  }
}
function cycleCoach() {
  coachMode=(coachMode+1)%('speechSynthesis' in window?3:2);
  get('coach-toggle').textContent=['教练关闭','教练提示','教练语音'][coachMode];
  window.speechSynthesis?.cancel();lastCall='';updateCoach();
}
function toggleAssist() {
  race.beginner=!race.beginner;race.showLine=race.beginner;
  get('assist-toggle').textContent=race.beginner?'新手辅助':'专业驾驶';
  get('assist-toggle').setAttribute('aria-pressed',String(race.beginner));
  get('lesson-help').textContent=race.beginner?'新手辅助已开启。按住 W 或油门跟线，轻点方向微调。绿线加速，黄线收油，红线刹车。':'专业驾驶使用完整油门和独立转向。按 L 可单独打开参考线。';
}
get('assist-toggle').onclick=toggleAssist;
function switchView() {view=(view+1)%views.length;get('view-label').textContent=views[view];eye=target=null;syncMode();}
function toggleFootcam() {footcam=!footcam;get('pedal-toggle').setAttribute('aria-pressed',String(footcam));}
get('coach-toggle').onclick=cycleCoach;get('view-button').onclick=switchView;get('pedal-toggle').onclick=toggleFootcam;
get('touch-gear').onclick=()=>shiftGear(race.player,1);

function setMenu(kicker,title,copy,action,next) {
  get('menu-kicker').textContent=kicker;
  const lines=title.split('\n');
  const heading=get('menu-title');
  heading.replaceChildren(lines[0]);
  if (lines.length>1) heading.append(document.createElement('br'),lines[1]);
  get('menu-copy').textContent=copy;
  primary.textContent=action;
  secondary.textContent=next;
  overlay.hidden=false;
}
function syncMode() {
  const driving=race.phase==='running'||race.phase==='countdown';
  updateSound();
  document.querySelector('.sim').dataset.drive=String(driving);
  document.querySelector('.sim').dataset.studio=String(race.phase==='studio');
  document.querySelector('.sim').dataset.cabin=String(view===0&&driving);
  get('pedal-toggle').hidden=!(view===0&&driving);
  get('pit-start').hidden=race.phase!=='menu';
  get('view-button').disabled=!driving;
  get('view-label').textContent=views[view];
  if(!driving) window.speechSynthesis?.cancel();
  get('pause').disabled=!ready||!['running','countdown','paused'].includes(race.phase);
  get('pause').textContent=race.phase==='paused'?'▶':'Ⅱ';
  get('pause').setAttribute('aria-label',race.phase==='paused'?'继续':'暂停');
}
function clearInput() {
  keys.clear();
  pointers.clear();steeringTouch=null;
  document.querySelectorAll('.touch .active').forEach(button=>button.classList.remove('active'));
}
function start(mode) {
  race.reset(mode);
  race.phase='countdown';
  eye=target=null;
  lastCall='';
  clearInput();
  goUntil=0;
  overlay.hidden=true;
  initAudio();
  syncMode();
}
function resume() {
  race.phase=beforePause;
  overlay.hidden=true;
  initAudio();
  syncMode();
}
function pause() {
  if (race.phase==='paused') return resume();
  if (!['running','countdown'].includes(race.phase)) return;
  beforePause=race.phase;
  race.phase='paused';
  clearInput();
  setMenu('NORDSCHLEIFE · 纽伯格林北环','暂停','比赛已暂停。','继续驾驶','重新开始');
  syncMode();
}
function results() {
  const rank=race.order.indexOf(race.player)+1;
  setMenu('NORDSCHLEIFE · 纽伯格林北环','完赛',race.mode==='race'
    ? `第 ${rank} 名 · 最快圈 ${formatTime(race.best)} · 总用时 ${formatTime(race.time)}`
    : `最快圈 ${formatTime(race.best)} · 总用时 ${formatTime(race.time)}`,
    '再跑一场',race.mode==='race'?'自由计时':'三圈竞速');
  syncMode();
}
function showError(message) {
  ready=false;
  render=null;
  race.phase='menu';
  get('studio').hidden=true;
  overlay.hidden=false;
  secondary.disabled=get('inspect').disabled=get('pit-start').disabled=true;
  primary.disabled=false;
  primary.textContent='重新加载';
  get('error').hidden=false;
  get('error').textContent=message;
  get('gpu-status').textContent='WEBGPU 离线';
  syncMode();
}

primary.onclick=()=>{
  if (!ready) {location.reload();return;}
  if (race.phase==='paused') resume();
  else start(race.phase==='finished'?race.mode:'race');
};
get('pit-start').onclick=()=>{if(ready)start('pit');};
secondary.onclick=()=>{
  if (!ready) return;
  start(race.phase==='paused'?(race.pitStart?'pit':race.mode):race.phase==='finished'&&race.mode==='trial'?'race':'trial');
};
get('pause').onclick=pause;
get('audio').onclick=()=>{
  enabled=!enabled;
  get('audio').setAttribute('aria-pressed',String(enabled));
  get('audio').setAttribute('aria-label',enabled?'关闭驾驶音效':'开启驾驶音效');
  if(enabled) initAudio();
  else window.speechSynthesis?.cancel();
  updateSound();
};
const movement=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
window.addEventListener('keydown',event=>{
  if (['countdown','running'].includes(race.phase)&&movement.has(event.code)) {
    event.preventDefault();
    keys.add(event.code);
  }
  if (event.repeat || !ready) return;
  if (race.phase==='studio') {
    if(event.code==='Escape') closeStudio();
    return;
  }
  if (event.code==='Escape') pause();
  if (event.code==='KeyC') switchView();
  if(event.code==='KeyH') cycleCoach();
  if(event.code==='KeyB') toggleAssist();
  if(event.code==='KeyL') race.showLine=!race.showLine;
  if(event.code==='KeyV') toggleFootcam();
  if(race.phase==='running') {
    if(event.code==='KeyQ'||event.code==='KeyE') shiftGear(race.player,event.code==='KeyE'?1:-1);
    if(event.code==='KeyM') race.player.gearMode=race.player.gearMode==='auto'?'manual':'auto';
  }
  if (event.code==='KeyR'&&race.phase==='running') {
    race.recover();
    eye=target=null;
    lastCall='';
  }
});
window.addEventListener('keyup',event=>keys.delete(event.code));
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden&&['running','countdown'].includes(race.phase)) pause();
});
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown',event=>{
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,button.dataset.key);
    button.classList.add('active');
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) {
    button.addEventListener(name,event=>{
      pointers.delete(event.pointerId);
      button.classList.toggle('active',[...pointers.values()].includes(button.dataset.key));
    });
  }
}
const down=(...names)=>names.some(key=>keys.has(key)||[...pointers.values()].includes(key));
const throttle=()=>down('KeyW','ArrowUp');

function openStudio() {
  if(!ready) return;
  clearInput();
  returnPhase=race.phase;
  race.phase='studio';
  get('studio').hidden=false;
  overlay.hidden=true;
  syncMode();
  get('studio-back').focus();
}
function closeStudio() {
  race.phase=returnPhase;
  overlay.hidden=false;
  get('studio').hidden=true;
  eye=target=null;
  drag=null;
  syncMode();
  get('inspect').focus();
}
get('inspect').onclick=openStudio;
get('studio-back').onclick=closeStudio;
get('explosion').oninput=()=>{get('explosion-value').textContent=get('explosion').value+'%';};
world.addEventListener('pointerdown',event=>{
  if(race.phase==='running'&&view===0&&event.clientY>world.clientHeight*.6) {
    world.setPointerCapture(event.pointerId);steeringTouch={id:event.pointerId,x:event.clientX,value:0};return;
  }
  if(race.phase!=='studio') return;
  world.setPointerCapture(event.pointerId);
  drag={id:event.pointerId,x:event.clientX,y:event.clientY};
});
world.addEventListener('pointermove',event=>{
  if(steeringTouch?.id===event.pointerId) {steeringTouch.value=clamp((steeringTouch.x-event.clientX)/(world.clientWidth*.19),-1,1);return;}
  if(!drag||drag.id!==event.pointerId) return;
  studioYaw-=(event.clientX-drag.x)*.008;
  studioTilt=clamp(studioTilt+(event.clientY-drag.y)*.006,.08,1.23);
  drag.x=event.clientX;
  drag.y=event.clientY;
});
world.addEventListener('lostpointercapture',()=>{drag=null;steeringTouch=null;});
world.addEventListener('wheel',event=>{
  if(race.phase!=='studio') return;
  event.preventDefault();
  studioZoom=clamp(studioZoom*Math.exp(event.deltaY*.001),.69,1.65);
},{passive:false});

function camera(dt) {
  if(race.phase==='studio') {
    const explosion=Number(get('explosion').value)/100;
    const aspect=world.clientWidth/Math.max(1,world.clientHeight);
    const radius=(6.25+3.05*explosion)*studioZoom/Math.min(1,aspect*.71);
    const focus=[0,.52+explosion*.19,.15+explosion*.12];
    const cameraPosition=[radius*Math.sin(studioYaw)*Math.cos(studioTilt),
      focus[1]+radius*Math.sin(studioTilt),focus[2]+radius*Math.cos(studioYaw)*Math.cos(studioTilt)];
    render(cameraPosition,focus,[displayCar],.67,false,explosion);
    return;
  }
  const car=race.player,menu=race.phase==='menu',cabin=!menu&&view===0,hood=!menu&&view===3;
  const narrow=clamp((.92-world.clientWidth/Math.max(1,world.clientHeight))/.42,0,1);
  const pace=menu||reducedMotion.matches?0:clamp((car.speed-2)/62,0,1);
  const desiredPace=pace*(2-pace);
  cameraPace=eye?mix(cameraPace,desiredPace,1-Math.exp(-dt*4.5)):desiredPace;
  const yaw=car.yaw+(cabin||hood?0:.38*clamp(car.driftAngle,-.6,.6)),sn=Math.sin(yaw),cs=Math.cos(yaw);
  const pitch=car.pitch||0;
  const at=(ahead,up,side=0)=>[car.x+sn*ahead+cs*side,car.y+up+ahead*Math.sin(pitch),car.z+cs*ahead-sn*side];
  let desiredEye,desiredTarget,fov=.82;
  if(menu) {desiredEye=at(-7.7-2*narrow,2.36,-.62);desiredTarget=at(12,1.0,.30);}
  else if(cabin||hood) {
    const head=car.bodyLift+.45*car.roughness;
    desiredEye=at(cabin?.10:.96,(cabin?1.015:.89)+head,cabin?.35:0);
    const peek=cabin?clamp(pose(car.s+15).curve*Math.min(car.speed,40)*1.8,-1.3,1.3):0;
    desiredTarget=at(16,(cabin?.16:.5)+car.bodyPitch*7,peek+(cabin?.35:0));
    fov=(cabin?.98:.94)+.07*narrow+.32*cameraPace;
  } else {
    const distance=(view===1?6.8+3.2*narrow:9.8+2.5*narrow)*(1-.11*cameraPace);
    const height=(view===1?2.5:5.15)+.45*narrow-.28*cameraPace;
    desiredEye=at(-distance,height,car.steer*.43);
    desiredTarget=at(13,1.05);fov+=.31*cameraPace;
  }
  const follow=cabin||hood?1:1-Math.exp(-dt*12);
  eye=eye?eye.map((v,i)=>mix(v,desiredEye[i],follow)):desiredEye;
  target=target?target.map((v,i)=>mix(v,desiredTarget[i],follow)):desiredTarget;
  if(!cabin&&!hood&&!car.inPit) {
    const r=nearest(eye[0],eye[2]);
    if(Math.abs(r.lateral)>railFaceAt(r,Math.sign(r.lateral))-.55) {
      const c=railClearance(eye[0],eye[2],Math.sign(r.lateral),r.index),push=Math.max(0,.45-c.gap);
      eye[0]-=c.nx*push;eye[2]-=c.nz*push;eye[1]=Math.max(eye[1],r.y+1.4);
    }
  }
  render(eye,target,race.cars,fov,cabin||hood,null,race.time,cabin,footcam,race.showLine&&!menu,race.beginner);

}

function frame(now) {
  const dt=previous?Math.min((now-previous)/1000,.075):1/60;
  previous=now;
  accumulator+=dt;
  const control={gas:Number(throttle()),brake:Number(down('KeyS','ArrowDown')),
    analog:!!steeringTouch,steer:steeringTouch?.value||Number(down('KeyA','ArrowLeft'))-Number(down('KeyD','ArrowRight')),hand:down('Space')};
  const phase=race.phase;
  while(accumulator>=1/120) {
    race.step(1/120,control);
    accumulator-=1/120;
  }
  if (phase!==race.phase) {
    if(race.phase==='running') { goUntil=now+650; syncMode(); }
    if(race.phase==='finished') results();
  }
  const countdown=get('countdown');
  countdown.hidden=race.phase!=='countdown'&&!(race.phase==='running'&&now<goUntil);
  if (!countdown.hidden) {
    const label=race.phase==='countdown'?String(Math.max(1,Math.ceil(race.countdown))):'GO';
    if(countdown.textContent!==label) countdown.textContent=label;
  }
  if (render) camera(dt);
  updateHUD();
  updateSound();
  requestAnimationFrame(frame);
}

(async()=>{
  try {
    if (!navigator.gpu) throw new Error('当前浏览器没有提供 WebGPU。请用支持 WebGPU 的浏览器通过本地服务或 HTTPS 打开。');
    render=await createRenderer(world,landscape(),drivers,showError);
    ready=true;
    primary.textContent='三圈竞速';
    primary.disabled=secondary.disabled=get('inspect').disabled=get('pit-start').disabled=false;
    if(new URLSearchParams(location.search).get('view')==='parts') openStudio();
    camera(0);
  } catch(error) {
    console.error(error);
    showError(error.message);
  }
  requestAnimationFrame(frame);
})();
