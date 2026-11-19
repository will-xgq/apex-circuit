import {readAsset} from './textures.js';
// Audi R8 LMS field recording by Edvvc, CC BY-SA 3.0. The four loops retain the recorded exhaust pulses.
const layers=[['low',1873],['mid',4485],['load',5880],['high',6785]];
export function createSound() {
  const Api=window.AudioContext||window.webkitAudioContext;
  if (!Api) return null;
  const ctx=new Api(),master=ctx.createGain(),limiter=ctx.createDynamicsCompressor();
  master.gain.value=0;master.connect(limiter);limiter.connect(ctx.destination);
  limiter.threshold.value=-13;limiter.ratio.value=5;
  const exhaust=ctx.createBiquadFilter();exhaust.type='lowpass';exhaust.Q.value=.58;exhaust.connect(master);
  const engines=[];
  const ready=Promise.all(layers.map(async ([name,rpm],i)=>{
    const url=new URL('../assets/audio/r8-'+name+'.wav',import.meta.url);
    const data=await ctx.decodeAudioData(await readAsset(url,'arrayBuffer'));
    const source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=data;source.loop=true;source.connect(gain);gain.gain.value=0;gain.connect(exhaust);source.start();
    engines[i]={source,gain,rpm};
  }));
  ready.catch(error=>console.warn(error.message));
  // Short patches give the tread texture and longer, independent swells give the airflow width.
  function noiseLoop(channels,seconds,patches) {
    // A fixed source rate keeps the filtered noise level consistent across audio devices.
    const rate=48000,clip=ctx.createBuffer(channels,Math.round(rate*seconds),rate);
    for (let channel=0;channel<channels;channel++) {
      const samples=clip.getChannelData(channel);
      const levels=Array.from({length:patches},()=>.7+.6*Math.random());
      for (let p=0;p<patches;p++) {
        const start=Math.round(p*clip.length/patches),end=Math.round((p+1)*clip.length/patches);
        const slope=(levels[(p+1)%patches]-levels[p])/(end-start);
        for (let i=start;i<end;i++) samples[i]=(Math.random()*2-1)*(levels[p]+(i-start)*slope);
      }
    }
    const source=ctx.createBufferSource();
    source.buffer=clip;source.loop=true;source.start();
    return source;
  }
  function noiseBand(source,type,hz,q) {
    const filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    filter.type=type;filter.frequency.value=hz;filter.Q.value=q;gain.gain.value=0;
    source.connect(filter);filter.connect(gain);gain.connect(master);
    return {frequency:filter.frequency,level:gain.gain};
  }
  const roadNoise=noiseLoop(1,2.5,36);
  const rolling=noiseBand(roadNoise,'bandpass',240,.83);
  const scrub=noiseBand(roadNoise,'bandpass',1150,2.4);
  const grass=noiseBand(roadNoise,'bandpass',710,.68);
  const windCut=ctx.createBiquadFilter();
  windCut.type='highpass';windCut.frequency.value=380;windCut.Q.value=-3;
  noiseLoop(2,5,9).connect(windCut);
  const wind=noiseBand(windCut,'lowpass',1250,-3);
  const bump=ctx.createBufferSource(),bumpGain=ctx.createGain(),pan=ctx.createStereoPanner();
  const beat=ctx.createBuffer(1,Math.round(ctx.sampleRate*.11),ctx.sampleRate),pcm=beat.getChannelData(0);
  const grit=roadNoise.buffer.getChannelData(0);
  for(let i=0;i<pcm.length;i++) {const t=i/ctx.sampleRate;pcm[i]=Math.exp(-t*86)*(Math.sin(t*680)*.78+.17*grit[i]);}
  bump.buffer=beat;bump.loop=true;bump.connect(bumpGain);bumpGain.gain.value=0;bumpGain.connect(pan);pan.connect(master);bump.start();
  let lastShift=0,playing=false;
  return {ready,resume:()=>ctx.resume().catch(()=>{}),update(car,active,cabin) {
    const now=ctx.currentTime,opening=active && !playing;
    if (active!==playing) {
      master.gain.setTargetAtTime(active?.72:0,now,active?.055:.025);
      playing=active;
    }
    if (!active) return;
    if (opening) lastShift=car.shiftSerial;
    // Fade in the current mix when resuming or starting a new grid.
    function smoothing(param,value,time=.045) {
      if (opening) param.setValueAtTime(value,now);
      else param.setTargetAtTime(value,now,time);
    }
    const rpm=Math.max(car.rpm,850),load=car.throttle,cut=car.shiftTime>.025?.48:1;
    const weights=layers.map(([,base])=>Math.exp(-.5*(Math.log(rpm/base)/.32)**2));
    const sum=Math.sqrt(weights.reduce((a,b)=>a+b*b,0))||1;
    engines.forEach(({source,gain,rpm:base},i)=>{
      smoothing(source.playbackRate,Math.max(.43,Math.min(1.6,rpm/base)),.025);
      smoothing(gain.gain,weights[i]/sum*(.31+.45*load)*cut,.035);
    });
    smoothing(exhaust.frequency,(cabin?1200:2300)+load*(cabin?2100:4200)+rpm*.13);
    // Road contact follows ground speed through gear changes and when coasting.
    const pace=Math.min(1,car.speed/65);
    const roll=Math.min(1,car.speed/7)*(.17+.70*pace);
    smoothing(roadNoise.playbackRate,.53+1.05*pace,.10);
    smoothing(rolling.frequency,(cabin?210:280)+290*pace+150*car.concreteLoad-90*car.grassLoad,.09);
    smoothing(rolling.level,roll*(1+.18*car.concreteLoad-.62*car.grassLoad)*(cabin?.90:1),.08);
    smoothing(grass.level,roll*car.grassLoad*.93,.07);
    smoothing(scrub.level,car.scrub*(1-.78*car.grassLoad)*(cabin?.38:.48));
    smoothing(scrub.frequency,990+car.scrub*820);

    const airflow=Math.min(1,Math.max(0,(car.speed-3)/67));
    smoothing(wind.frequency,(cabin?1050:1550)+(cabin?1350:2450)*airflow,.16);
    smoothing(wind.level,(cabin?.83:1.02)*airflow**1.35,.13);
    smoothing(bumpGain.gain,Math.min(.52,car.kerbLoad*1.1)*Math.min(1,car.speed/12),.018);
    smoothing(bump.playbackRate,Math.max(.25,car.speed*.11/.8),.025);smoothing(pan.pan,-car.kerbSide*.66);
    if (car.shiftSerial>lastShift) {
      const knock=ctx.createBufferSource(),g=ctx.createGain();knock.buffer=beat;knock.playbackRate.value=.83;
      g.gain.value=.15;knock.connect(g);g.connect(master);knock.onended=()=>{knock.disconnect();g.disconnect();};knock.start();
    }
    lastShift=car.shiftSerial;
  }};
}
