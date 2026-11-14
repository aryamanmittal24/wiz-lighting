const assert=require('node:assert/strict');
const {Detector,correlateDelay,commandDeadline}=require('./web/music-dsp.js');
let seed=912;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function synth(bpm,seconds=16,rate=48000,subdivisions=true){
  const d=new Detector(rate),hits=[],tempos=[];const period=60/bpm;
  for(let i=0;i<rate*seconds;i++){
    const t=i/rate,p=t%period,h=t%(period/2);
    const kick=p<.12?.45*Math.sin(2*Math.PI*(65*p-55*p*p))*Math.exp(-p*45):0;
    const snare=p<.06?.12*(random()*2-1)*Math.exp(-p*70):0;
    const hat=subdivisions&&h<.025?.025*(random()*2-1)*Math.exp(-h*180):0;
    const f=d.push(kick+snare+hat,t);if(f){if(f.hit!==null)hits.push(f.hit);if(t>seconds-2)tempos.push(f.bpm);}
  }
  return {d,hits,tempo:tempos.filter(Boolean).sort((a,b)=>a-b)[tempos.filter(Boolean).length>>1]};
}
for(const bpm of [75,90,100,120,140]){
 const {tempo,hits}=synth(bpm);console.log(bpm,tempo,hits.length);
 assert.ok(Math.abs(tempo-bpm)<4,`${bpm} BPM with subdivisions must not double to ${tempo}`);
 assert.ok(hits.length>=16*bpm/60*.7,'Must detect drum attacks');
}
const {d,hits}=synth(120,12,44100);assert.ok(hits.every(t=>Math.min(t%.5,.5-t%.5)<.06),'Hits follow attacks, not inferred metronome');
let silentHits=0;for(let i=0;i<44100*3;i++){const f=d.push(0,12+i/44100);if(f?.hit!==null&&f?.hit!==undefined)silentHits++;}assert.equal(silentHits,0);assert.equal(d.bpm,0,'Silence clears stale tempo');
const tone=new Detector();let toneHits=0;for(let i=0;i<48000*3;i++){const f=tone.push(.2*Math.sin(2*Math.PI*440*i/48000),i/48000);if(f?.hit!==null&&f?.hit!==undefined)toneHits++;}assert.ok(toneHits<3,'Sustained tone must not create rhythmic flashes');
const ref=Array.from({length:1000},()=>random()<.06?random():0),mic=ref.map((_,i)=>(ref[i-27]||0)*.4+random()*.002);
const result=correlateDelay(ref,mic);assert.ok(result&&Math.abs(result.delayMs-270)<=10,'Recover known Bluetooth-like delay');
assert.equal(correlateDelay(Array(1000).fill(0),Array(1000).fill(0)),null);
assert.equal(correlateDelay(ref,Array.from({length:1000},()=>random())),null,'Reject unrelated microphone sound');
const periodic=Array.from({length:1000},(_,i)=>i%20===0?1:0);assert.equal(correlateDelay(periodic,periodic),null,'Reject ambiguous periodic calibration');
assert.equal(commandDeadline(1000,270,45,1050),1225);
assert.equal(commandDeadline(1000,270,45,1400),null,'Drop stale beats');
assert.equal(commandDeadline(1000,0,45,1010),1010,'No negative wait');
console.log('Music DSP checks passed');
// Browser scheduling semantics without hardware: releases must not cut new hits,
// and queued timers must not survive Stop/restart or a blocked event loop.
const vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync(`${__dirname}/web/app.js`,'utf8'),pending=[],sent=[];
const ctx=vm.createContext({musicActive:true,musicGeneration:1,musicLastVisualTime:-Infinity,musicLastBeat:0,musicDelayTimers:[],performance:{now:()=>1000},setTimeout:f=>{pending.push(f);return pending.length;},sendMusicColors:(...args)=>sent.push(args)});
vm.runInContext(app.slice(app.indexOf('function scheduleMusicFrame('),app.indexOf('function musicTick(')),ctx);
ctx.scheduleMusicFrame([{on:true}],1050,900,1);ctx.musicGeneration=2;pending.shift()();assert.equal(sent.length,0,'Old generation never sends');
ctx.musicGeneration=1;ctx.musicLastBeat=950;ctx.scheduleMusicFrame([{on:false}],1050,1000,1,900);pending.shift()();assert.equal(sent.length,0,'Old release cannot cut a newer hit');
ctx.scheduleMusicFrame([{on:true}],800,700,1);pending.shift()();assert.equal(sent.length,0,'Late browser timer cannot replay stale hit');
ctx.scheduleMusicFrame([{on:true}],1050,1000,1);pending.shift()();assert.equal(sent.length,1,'Current frame dispatches');
console.log('Music scheduler lifecycle checks passed');
