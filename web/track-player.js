/* Track playback owns the audio clock; lighting uses a bounded lookahead queue. */
let trackBuffer=null,trackAnalysis=null,trackName='',trackLoad=0,trackOffset=0;
let trackPlaying=false,trackStartedAt=0,trackTimeline=null,trackMeasuredMs=null,trackFinishTimer=null;
const trackClock=seconds=>`${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds)%60)).padStart(2,'0')}`;
function trackPosition(){
  if(!trackPlaying||!musicContext)return trackOffset;
  return Math.max(0,Math.min(trackBuffer.duration,trackOffset+musicContext.currentTime-trackStartedAt));
}
function trackStop(){
  if(trackPlaying)trackOffset=trackPosition();
  trackPlaying=false;clearTimeout(trackFinishTimer);trackFinishTimer=null;
  if(musicSource&&trackTimeline){musicSource.onended=null;try{musicSource.stop();}catch{}}
  trackTimeline=null;
  $('#track-play').disabled=!trackAnalysis;$('#track-play').textContent=trackOffset>0?'Resume with lights':'Play with lights';
  $('#track-pause').disabled=true;trackDraw();
}
function trackResetTimeline(){
  if(!trackPlaying)return;
  musicDelayTimers.forEach(clearTimeout);musicDelayTimers=[];musicLastVisualTime=-Infinity;
  trackTimeline=new TrackTimeline.Timeline(trackAnalysis,$('#music-mode').value,musicTempoProfile().hold);
  trackTimeline.seek(Math.max(0,trackPosition()));
}
function trackModeChanged(){trackResetTimeline();}
function trackTimingMeasured(delay){if(trackPlaying){trackMeasuredMs=delay;trackResetTimeline();}}
function trackDraw(){
  const canvas=$('#track-waveform'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);if(!trackAnalysis)return;
  const a=trackAnalysis;
  for(let x=0;x<w;x++){
    const band=a.bands[Math.min(a.bands.length-1,Math.floor(x/w*a.bands.length))];
    ['#ed9859','#b5dc87','#82bdf0'].forEach((color,i)=>{ctx.fillStyle=color;ctx.globalAlpha=.7;ctx.fillRect(x,h-(i+1)*h/3,1,band[i]*h/3);});
  }
  ctx.globalAlpha=.35;ctx.fillStyle='#ffffff';
  for(const beat of a.beats)ctx.fillRect(beat/a.duration*w,0,1,h);
  const position=trackPosition();ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.fillRect(position/a.duration*w,0,2,h);
  $('#track-position').value=position;$('#track-time').textContent=`${trackClock(position)} / ${trackClock(a.duration)}`;
}
async function trackUpload(pcm,signal){
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch('/api/music/analyze',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Wiz-Token':token},body:pcm.buffer,signal});
    if(response.status===403&&attempt===0){token=(await api('session')).token;continue;}
    const result=await response.json();if(!response.ok)throw Error(result.error||'Song analysis failed.');return result;
  }
}
let trackUploadController=null;
$('#track-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  stopMusic();const ticket=++trackLoad;
  trackUploadController?.abort();trackUploadController=new AbortController();
  trackBuffer=null;trackAnalysis=null;trackOffset=0;trackMeasuredMs=null;
  trackDraw();$('#track-position').value=0;$('#track-time').textContent='0:00 / 0:00';
  $('#track-play').disabled=true;$('#track-position').disabled=true;
  $('#track-status').textContent='Decoding audio…';
  let decoder;
  try{
    if(file.size>128*1024*1024)throw Error('Choose a file smaller than 128 MB.');
    decoder=new AudioContext();const buffer=await decoder.decodeAudioData(await file.arrayBuffer());
    await decoder.close();decoder=null;if(ticket!==trackLoad)return;
    if(buffer.duration<1||buffer.duration>900)throw Error('Choose a song between 1 second and 15 minutes long.');
    $('#track-status').textContent='Analysing the whole song · first run can take a minute…';
    const offline=new OfflineAudioContext(1,Math.ceil(buffer.duration*22050),22050);
    const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start();
    const mono=await offline.startRendering();if(ticket!==trackLoad)return;
    const result=await trackUpload(mono.getChannelData(0),trackUploadController.signal);
    if(ticket!==trackLoad)return;
    trackBuffer=buffer;trackAnalysis=result;trackName=file.name;
    $('#track-position').max=result.duration;$('#track-position').disabled=false;
    $('#track-play').disabled=false;$('#track-play').textContent='Play with lights';
    $('#track-status').textContent=`${file.name} · ${result.bpm?`≈ ${Math.round(result.bpm)} BPM`:'No steady beat'} · ${result.hits.length} drum attacks · analysed`;
    $('#music-bpm').textContent=result.bpm?`≈ ${Math.round(result.bpm)} BPM`:'No steady beat';trackDraw();
  }catch(error){if(ticket===trackLoad&&error.name!=='AbortError'){$('#track-status').textContent=error.message;toast(error.message,true);}}
  finally{if(decoder)await decoder.close();}
};
function trackTick(){
  if(!trackPlaying||!musicActive||!trackTimeline)return;
  const generation=musicGeneration,now=performance.now(),position=trackPosition();
  // Skip missed deadlines after suspension; never dump old flashes on resume.
  for(const event of trackTimeline.take(Math.max(0,position-.85),position+.25)){
    const contextTime=trackStartedAt+event.time-trackOffset;
    const audible=TrackTimeline.outputTime(contextTime,musicContext,now,BOSE_PRESET_MS,trackMeasuredMs);
    const due=audible-WIZ_ESTIMATED_REACTION_MS-musicDispatchMs;
    if(now-due>100)continue;
    const sample=trackTimeline.sample(event.time);
    musicBeatIndex=sample.beatIndex;musicLastBeat=sample.lastHit*1000;
    musicPulseUntil=sample.lastHit*1000+musicTempoProfile().hold;
    const colors=musicColors({...sample,now:event.time*1000});
    if(sample.energy<.001)colors.forEach(color=>color.on=false);
    scheduleMusicFrame(colors,Math.max(now,due),contextTime*1000,generation);
    if(event.hit){
      const timer=setTimeout(()=>{
        musicDelayTimers=musicDelayTimers.filter(t=>t!==timer);
        if(!trackPlaying||generation!==musicGeneration)return;
        $('#beat-indicator').classList.add('hit');clearTimeout(beatIndicatorTimer);
        beatIndicatorTimer=setTimeout(()=>$('#beat-indicator').classList.remove('hit'),80);
      },Math.max(0,audible-now));musicDelayTimers.push(timer);
    }
  }
  const sample=trackTimeline.sample(position);$('#music-level').value=sample.energy;
  trackDraw();
}
async function trackPlay(){
  if(!trackAnalysis||!trackBuffer)return;
  if(!activeLightIds().length)return toast('No room lights are available.',true);
  const resumeAt=trackOffset>=trackBuffer.duration-.05?0:trackOffset;
  if(syncActive)stopSync(false);if(handActive)stopHand();stopMusic();trackOffset=resumeAt;
  const generation=musicGeneration;$('#track-play').disabled=true;$('#track-status').textContent='Starting timed playback…';
  try{
    musicContext=new AudioContext({latencyHint:'playback'});
    await musicContext.resume();await musicContext.audioWorklet.addModule('/music-worklet.js');
    if(generation!==musicGeneration)return;
    musicNode=new AudioWorkletNode(musicContext,'music-detector',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1]});
    musicNode.connect(musicContext.destination);
    musicNode.port.onmessage=event=>{if(generation===musicGeneration&&musicCalibration){musicCalibration.ref.push(event.data.refEnvelope);musicCalibration.mic.push(event.data.micEnvelope);}};
    musicNode.onprocessorerror=()=>{if(generation===musicGeneration){stopMusic();toast('Audio processor stopped. Resume playback.',true);}};
    const result=await api('music/start',{});
    if(generation!==musicGeneration){api('music/stop',{session:result.session}).catch(()=>{});return;}
    musicSession=result.session;musicSequence=0;musicActive=true;musicDispatchMs=5;
    musicSpeakerDelay=BOSE_PRESET_MS;musicDetectedBpm=trackAnalysis.bpm;musicBeatPeriod=musicDetectedBpm?60000/musicDetectedBpm:0;
    musicLastVisualTime=-Infinity;musicLastBeat=-Infinity;
    musicSource=musicContext.createBufferSource();musicSource.buffer=trackBuffer;
    musicSource.connect(musicContext.destination);musicSource.connect(musicNode,0,0);
    trackStartedAt=musicContext.currentTime+.4;trackPlaying=true;
    trackTimeline=new TrackTimeline.Timeline(trackAnalysis,$('#music-mode').value,musicTempoProfile().hold);trackTimeline.seek(trackOffset);
    musicSource.onended=()=>{
      if(generation!==musicGeneration)return;
      const audibleEnd=TrackTimeline.outputTime(trackStartedAt+trackBuffer.duration-trackOffset,musicContext,performance.now(),BOSE_PRESET_MS,trackMeasuredMs);
      trackFinishTimer=setTimeout(()=>{if(generation===musicGeneration){stopMusic();trackOffset=0;trackDraw();$('#track-status').textContent=`${trackName} · finished`;$('#track-play').textContent='Play again with lights';}},Math.max(0,audibleEnd-performance.now()+120));
    };
    musicSource.start(trackStartedAt,trackOffset);musicTimer=setInterval(trackTick,25);trackTick();
    $('#track-pause').disabled=false;$('#music-stop').disabled=false;$('#music-calibrate').disabled=false;
    $('#music-status').textContent='Scheduled track sync';$('#music-bpm').textContent=trackAnalysis.bpm?`≈ ${Math.round(trackAnalysis.bpm)} BPM`:'No steady beat';
    $('#track-status').textContent=`${trackName} · scheduled drum hits and frequency bands`;
    $('#tempo-behavior').textContent='Whole-song analysis · flashes follow detected drum attacks';
    $('#music-timing').textContent=trackMeasuredMs===null?'Audio output clock · bulb response estimated at 45 ms. Measure speaker timing to refine.':`Measured speaker timing · approximately ${Math.round(trackMeasuredMs)} ms · bulb response estimated`;
  }catch(error){if(generation===musicGeneration){stopMusic();toast(error.message,true);}}
}
$('#track-play').onclick=trackPlay;
$('#track-pause').onclick=()=>{stopMusic();$('#track-status').textContent=`${trackName} · paused`;};
$('#track-position').onchange=()=>{const wasPlaying=trackPlaying,position=Number($('#track-position').value);stopMusic();trackOffset=position;trackDraw();if(wasPlaying)trackPlay();};
$('#music-source').onchange=()=>{
  stopMusic();const local=$('#music-source').value==='track';
  $('#track-panel').hidden=!local;$('#live-music-help').hidden=local;$('#music-start').hidden=local;
  if(local&&trackAnalysis){
    $('#track-status').textContent=`${trackName} · ready to resume`;
    $('#music-bpm').textContent=trackAnalysis.bpm?`≈ ${Math.round(trackAnalysis.bpm)} BPM`:'No steady beat';
  }
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&trackPlaying){stopMusic();$('#track-status').textContent=`${trackName} · paused while page hidden; resume for reliable timing`;}});
window.addEventListener('pagehide',()=>{trackUploadController?.abort();if(trackPlaying)stopMusic();});
