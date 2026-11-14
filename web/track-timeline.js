/* Pure timeline math: event cursor prevents duplicates and stale beat replay. */
(function(root){
  function lowerBound(items,time,key=x=>x){
    let lo=0,hi=items.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(key(items[mid])<time)lo=mid+1;else hi=mid;}
    return lo;
  }
  class Timeline{
    constructor(analysis,mode='beat',hold=100){
      this.analysis=analysis;this.hold=hold/1000;this.cursor=0;
      const hits=analysis.hits;
      if(['beat','techno','adaptive'].includes(mode)){
        this.events=[{time:0,hit:false},...hits.flatMap(time=>[{time,hit:true},{time:time+this.hold+.001,hit:false}])];
      }else{
        this.events=Array.from({length:Math.ceil(analysis.duration/.08)},(_,i)=>({time:i*.08,hit:false}));
        this.events.push(...hits.map(time=>({time,hit:true})));
      }
      this.events=this.events.filter(e=>e.time<analysis.duration).sort((a,b)=>a.time-b.time);
    }
    seek(time){this.cursor=lowerBound(this.events,time,e=>e.time);}
    take(from,to){
      const result=[];
      while(this.cursor<this.events.length&&this.events[this.cursor].time<=to){
        const event=this.events[this.cursor++];if(event.time>=from)result.push(event);
      }
      return result;
    }
    sample(time){
      const a=this.analysis,index=lowerBound(a.hits,time+1e-7),lastHit=index?a.hits[index-1]:-Infinity;
      const band=a.bands[Math.max(0,Math.min(a.bands.length-1,Math.floor(time/a.step)))]||[0,0,0,0];
      return {bass:band[0],mid:band[1],high:band[2],energy:band[3],beatIndex:index,lastHit,active:time-lastHit<this.hold};
    }
  }
  function outputTime(contextTime,context,now,fallbackMs,measuredMs=null){
    if(measuredMs!==null)return now+(contextTime-context.currentTime)*1000+measuredMs;
    const stamp=context.getOutputTimestamp?.();
    if(stamp&&stamp.performanceTime>0&&Number.isFinite(stamp.contextTime))return stamp.performanceTime+(contextTime-stamp.contextTime)*1000;
    const latency=context.outputLatency;
    return now+(contextTime-context.currentTime)*1000+(Number.isFinite(latency)&&latency>0?latency*1000:fallbackMs);
  }
  const api={Timeline,outputTime};root.TrackTimeline=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
