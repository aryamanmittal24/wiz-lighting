/* Sample-clock DSP. Spectral novelty + autocorrelation, following Müller/FMP.
   No inferred beats are emitted: tempo is descriptive, onsets drive lights. */
(function(root) {
  const median = a => { const s=[...a].sort((x,y)=>x-y); return s.length?s[s.length>>1]:0; };
  class Detector {
    constructor(rate=48000) {
      this.rate=rate; this.size=1024; this.hop=Math.round(rate/100);
      this.ring=new Float32Array(this.size); this.real=new Float64Array(this.size);
      this.imag=new Float64Array(this.size); this.previous=new Float64Array(this.size/2);
      this.window=Float64Array.from({length:this.size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(this.size-1)));
      this.count=0; this.history=[]; this.novelty=[]; this.lastHit=-100; this.bpm=0;
      this.confidence=0; this.lastSound=0; this.lastTempo=0; this.prev=null; this.before=0;
    }
    fft() {
      const n=this.size, re=this.real, im=this.imag;
      for(let i=0;i<n;i++){re[i]=this.ring[(this.count+i)%n]*this.window[i];im[i]=0;}
      for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
      for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len, cr=Math.cos(angle),ci=Math.sin(angle);
        for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){
          const a=i+j,b=a+len/2,tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];
          re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
          const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
        }}
      }
    }
    push(sample, time) {
      this.ring[this.count%this.size]=sample;this.count++;
      if(this.count<this.size||this.count%this.hop)return null;
      this.fft();
      let sum=0;for(const v of this.ring)sum+=v*v;const rms=Math.sqrt(sum/this.size);
      const flux=[0,0,0],energy=[0,0,0],counts=[0,0,0];
      for(let k=1;k<this.size/2;k++){
        const hz=k*this.rate/this.size;if(hz>9000)break;
        const band=hz<220?0:hz<2200?1:2;
        const mag=Math.hypot(this.real[k],this.imag[k])*2/this.size;
        const log=Math.log1p(40*mag);
        flux[band]+=Math.max(0,log-this.previous[k]);energy[band]+=mag*mag;counts[band]++;
        this.previous[k]=log;
      }
      const bands=energy.map(v=>Math.min(1,Math.sqrt(v)*4));
      const novelty=flux[0]/Math.max(1,counts[0])*.65+flux[1]/Math.max(1,counts[1])*.30+flux[2]/Math.max(1,counts[2])*.05;
      const baseline=median(this.history),mad=median(this.history.map(v=>Math.abs(v-baseline)));
      const mean=this.history.reduce((a,b)=>a+b,0)/Math.max(1,this.history.length);
      const threshold=Math.max(.006,baseline+3*mad,mean*1.4);
      // Timestamp the analysis window's centre, not JS delivery or FFT completion.
      const frame={time:time-this.size/(2*this.rate),novelty,threshold,rms,bass:bands[0],mid:bands[1],high:bands[2]};
      let hit=null;
      if(this.prev&&this.history.length>15&&this.prev.novelty>this.prev.threshold&&this.prev.novelty>=novelty&&this.prev.novelty>this.before&&this.prev.rms>.0015&&this.prev.time-this.lastHit>.12){
        hit=this.prev.time;this.lastHit=hit;
      }
      this.before=this.prev?.novelty||0;this.prev=frame;
      this.history.push(novelty);if(this.history.length>100)this.history.shift();
      this.novelty.push(Math.max(0,novelty-baseline));if(this.novelty.length>1000)this.novelty.shift();
      if(rms>.0015)this.lastSound=time;
      if(time-this.lastSound>1.2){this.bpm=0;this.confidence=0;this.novelty=[];}
      else if(time-this.lastTempo>.5&&this.novelty.length>=400){this.estimate();this.lastTempo=time;}
      return {...frame,hit,bpm:this.bpm,confidence:this.confidence};
    }
    estimate() {
      const x=this.novelty, n=x.length, hz=this.rate/this.hop;
      const mean=x.reduce((a,b)=>a+b,0)/n;
      const corr=lag=>{lag=Math.round(lag);if(lag>=n/2)return 0;let xy=0,xx=0,yy=0;
        for(let i=lag;i<n;i++){const a=x[i]-mean,b=x[i-lag]-mean;xy+=a*b;xx+=a*a;yy+=b*b;}
        return Math.max(0,xy/Math.sqrt(xx*yy||1));};
      const candidates=[];
      for(let bpm=60;bpm<=200;bpm++){
        const lag=60*hz/bpm,c=corr(lag);
        const prior=Math.exp(-.5*(Math.log2(bpm/110)/.65)**2);
        // Prefer the established metrical level, but allow sustained tempo changes.
        const continuity=this.bpm?Math.exp(-.5*(Math.log2(bpm/this.bpm)/.16)**2):0;
        const score=(c+.35*corr(2*lag)+.15*corr(3*lag))*(.75+.25*prior)*(.9+.1*continuity);
        candidates.push({bpm,score,c});
      }
      candidates.sort((a,b)=>b.score-a.score);const best=candidates[0];
      this.confidence=best.c;
      if(best.c<.28){this.bpm=0;return;}
      const near=candidates.filter(c=>Math.abs(c.bpm-best.bpm)<=2);
      const estimate=near.reduce((v,c)=>v+c.bpm*c.score,0)/near.reduce((v,c)=>v+c.score,0);
      if(this.bpm&&Math.abs(estimate-this.bpm)>8){
        if(this.candidate&&Math.abs(this.candidate-estimate)<4)this.votes++;else this.votes=1;
        this.candidate=estimate;if(this.votes<4)return;
      }
      this.bpm=this.bpm&&Math.abs(estimate-this.bpm)<8?this.bpm*.7+estimate*.3:estimate;
    }
  }
  // Normalized envelope correlation. Two independent halves must agree to avoid
  // mistaking a beat-period offset, room noise, or periodic ambiguity for latency.
  function correlateDelay(reference,microphone,step=.01) {
    const n=Math.min(reference.length,microphone.length);if(n<600)return null;
    const derivative=a=>a.map((v,i)=>i?Math.max(0,Math.log1p(v*100)-Math.log1p(a[i-1]*100)):0);
    const x=derivative(reference),y=derivative(microphone);
    function find(start,end){const scores=[];
      for(let lag=0;lag<=Math.round(.75/step);lag++){
        let xy=0,xx=0,yy=0,sx=0,sy=0,count=0;
        for(let i=start;i<end-lag;i++){const a=x[i],b=y[i+lag];xy+=a*b;xx+=a*a;yy+=b*b;sx+=a;sy+=b;count++;}
        const score=(xy-sx*sy/count)/Math.sqrt((xx-sx*sx/count)*(yy-sy*sy/count)||1);
        scores.push({lag,score});
      }
      scores.sort((a,b)=>b.score-a.score);const best=scores[0],runner=scores.find(s=>Math.abs(s.lag-best.lag)>4);
      if(best.score<.45||best.score-(runner?.score||0)<.08)return null;return best;
    }
    const a=find(0,n>>1),b=find(n>>1,n),all=find(0,n);
    if(!a||!b||!all||Math.abs(a.lag-b.lag)>3)return null;
    return {delayMs:all.lag*step*1000,confidence:all.score};
  }
  function commandDeadline(capturedAt,speakerDelayMs,lightLeadMs,now){
    const deadline=capturedAt+speakerDelayMs-lightLeadMs;
    return now-deadline>100?null:Math.max(now,deadline);
  }
  const api={Detector,correlateDelay,commandDeadline};root.MusicDSP=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
