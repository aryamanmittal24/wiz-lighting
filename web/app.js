const $=s=>document.querySelector(s);
let token='', data={lights:[],screen_order:[],scenes:[]}, selected=new Set(), busy=false, dialogAction=null, toastTimer, refreshFailures=0, lastView='', actionQueue=Promise.resolve(), draggingLightControl=false;
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function activeLightIds(limit=Infinity){const known=new Set(data.lights.filter(light=>!light.excluded).map(light=>light.id)),ordered=(data.screen_order||[]).filter(id=>known.has(id));for(const light of data.lights)if(known.has(light.id)&&!ordered.includes(light.id))ordered.push(light.id);return ordered.slice(0,limit)}
function orderedSelectedIds(limit=Infinity){return activeLightIds(limit)}
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',5000)}
async function api(path,body,retry=true){const response=await fetch('/api/'+path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Wiz-Token':token},body:JSON.stringify(body)}:{});const result=await response.json();if(response.status===403&&body&&retry){token=(await api('session')).token;return api(path,body,false)}if(!response.ok)throw Error(result.error||'Could not complete request');return result}
function lightColor(s){return s.state?(s.r!==undefined?`rgb(${s.r},${s.g},${s.b})`:s.temp?'#f3d5a4':'#c6b0ef'):'#7b817a'}
function stateHex(s){if(s.r!==undefined)return '#'+[s.r,s.g,s.b].map(v=>Math.max(0,Math.min(255,v||0)).toString(16).padStart(2,'0')).join('');if((s.temp||4000)<=3200)return '#ffb56b';if((s.temp||4000)>=5500)return '#cae8ff';return '#fff0ce'}
function render(){
 selected=new Set(activeLightIds());
 $('#pattern-status').textContent=data.pattern?.running?`Playing · ${data.pattern.name||'Thunder'}`:data.pattern?.error||'Stopped';
 $('#start-thunder').disabled=!!data.pattern?.running;
 if(typeof paintPatternState==='function')paintPatternState();
 $('#stop-thunder').disabled=!data.pattern?.running;
 const identify=data.identify||{}, identifiedLight=data.lights.find(l=>l.id===identify.current);
 $('#identify').disabled=!!data.pattern?.running||!!identify.running;
 $('#identify').textContent=identify.running?`Checking ${identifiedLight?.name||'light'}…`:'Identify lights';
 const online=data.lights.filter(l=>l.online).length;
 $('#connection').textContent=`● Local UDP · ${online} of ${data.lights.length} lights connected`;
 $('#count').textContent=data.lights.length;
 const view=JSON.stringify([data.lights.map(({seen,misses,state,...l})=>({...l,state:Object.fromEntries(Object.entries(state||{}).filter(([k])=>!['sigTs','rssi'].includes(k)))})),data.scenes,data.screen_order]);
 if(view===lastView)return; lastView=view;
 const positions=['LEFT','MID · LEFT','MID · RIGHT','RIGHT'];
 const order=activeLightIds();
 $('#lights-grid').innerHTML=data.lights.length?data.lights.map(l=>{const s=l.state||{},position=Math.max(0,order.indexOf(l.id)),dim=s.dimming??50,status=!l.online?'OFFLINE · RESCAN':l.stale?'RECONNECTING':l.control_error?'RETRYING LOCAL LINK':s.state?'LIVE CHANNEL':'STANDBY';return `<article class="light light-module ${s.state?'is-on':''}" style="--light-color:${lightColor(s)}"><div class="module-head"><span class="channel-code">CH ${String(position+1).padStart(2,'0')} · ${positions[position]||'ROOM'}</span><span class="signal ${l.online?'online':''}">${status}</span></div><div class="module-title"><span class="bulb" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/></svg></span><div><h3>${escapeHTML(l.name)}</h3><button class="rename" data-id="${l.id}">Rename channel ↗</button></div><button class="toggle ${s.state?'on':''}" data-id="${l.id}" aria-label="${s.state?'Turn off':'Turn on'} ${escapeHTML(l.name)}" ${!l.online?'disabled':''}></button></div><div class="module-controls"><div class="module-label"><label for="brightness-${l.id}">Brightness</label><output class="light-brightness-value">${dim}%</output></div><input class="light-brightness" id="brightness-${l.id}" data-id="${l.id}" type="range" min="1" max="100" value="${dim}" ${!l.online?'disabled':''}><div class="tone-row"><label class="color-well" title="Choose any color"><input class="light-color" data-id="${l.id}" type="color" value="${stateHex(s)}" ${!l.online?'disabled':''}><span>COLOR</span></label><div class="temp-chips" aria-label="White temperature"><button class="temp-chip" data-id="${l.id}" data-temp="2700" ${!l.online?'disabled':''}>WARM</button><button class="temp-chip" data-id="${l.id}" data-temp="4000" ${!l.online?'disabled':''}>SOFT</button><button class="temp-chip" data-id="${l.id}" data-temp="6500" ${!l.online?'disabled':''}>COOL</button></div></div></div></article>`}).join(''):'<p class="empty">No lights found. Check Wi-Fi and enable “Allow local communication” in WiZ, then rescan.</p>';
 document.querySelectorAll('.sample-point').forEach((point,index)=>{const light=data.lights.find(item=>item.id===order[index]);if(light){point.querySelector('.point-name').textContent=light.name;point.setAttribute('aria-label',`Move sampling point for ${light.name}`)}});
 $('#saved-looks').innerHTML=data.scenes.length?data.scenes.map(s=>`<div class="saved-card"><button class="run-scene" data-id="${s.id}">▶ &nbsp; ${escapeHTML(s.name)}</button><button class="delete-scene" data-id="${s.id}" aria-label="Delete ${escapeHTML(s.name)}">×</button></div>`).join(''):'<p class="empty">Nothing saved yet. Set your lights, then save your first look.</p>';
}
async function refresh(){data=await api('state');refreshFailures=0;render()}
function action(work){
 actionQueue=actionQueue.then(async()=>{busy=true;document.body.setAttribute('aria-busy','true');try{await work();await refresh()}catch(e){toast(e.message,true)}finally{busy=false;document.body.removeAttribute('aria-busy')}});
 return actionQueue;
}
function report(result,message){const failed=result.results.filter(r=>!r.ok);if(failed.length){const errors=[...new Set(failed.map(r=>r.error))];toast(`${failed.length} light${failed.length===1?'':'s'} could not update. ${errors.join('; ')}`,true)}else toast(message)}
function control(params,ids=activeLightIds()){if(!ids.length)return toast('No room lights are available.',true);if(typeof syncActive!=='undefined'&&syncActive)stopSync(false);if(typeof musicActive!=='undefined'&&musicActive)stopMusic(false);return action(async()=>report(await api('control',{ids,params:{fadeIn:0,fadeOut:0,...params}}),'Lights updated'))}
$('#rescan').onclick=()=>action(async()=>{$('#rescan').textContent='Scanning…';try{await api('discover',{});toast('Scan complete')}finally{$('#rescan').textContent='↻ Rescan'}});
const thunderDescriptions={classic:'One light at a time. Random order. Pure white strike, then a very fast in-bulb fade.',storm:'Two random lights strike together. One hits full white while the second adds a dimmer flash. Faster fades and tighter timing.'};
$('#thunder-mode').onchange=e=>$('#thunder-description').textContent=thunderDescriptions[e.target.value];
$('#start-thunder').onclick=()=>action(async()=>{if(typeof handActive!=='undefined'&&handActive)stopHand();const mode=$('#thunder-mode').value;await api('pattern/start',{ids:orderedSelectedIds(),mode});toast(mode==='storm'?'Thunderstorm started':'Thunder Classic started')});
$('#stop-thunder').onclick=()=>action(async()=>{await api('pattern/stop',{});toast('Thunder stopped; previous look restored')});
$('#identify').onclick=()=>action(async()=>{const result=await api('identify/start',{ids:[...data.lights.filter(l=>!l.excluded).map(l=>l.id)]});const current=result.identify?.current;toast(`Check ${data.lights.find(l=>l.id===current)?.name||'the highlighted light'} now; answer yes or no in chat.`)});
const rgb=hex=>({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)});
function stopLiveModes(){if(typeof syncActive!=='undefined'&&syncActive)stopSync(false);if(typeof musicActive!=='undefined'&&musicActive)stopMusic(false);if(typeof handActive!=='undefined'&&handActive)stopHand()}
const lightPending=new Map(),lightTimers=new Map(),lightSending=new Set();
function queueLightControl(id,params,immediate=false){stopLiveModes();lightPending.set(id,{...(lightPending.get(id)||{}),...params});clearTimeout(lightTimers.get(id));if(immediate)drainLightControl(id);else lightTimers.set(id,setTimeout(()=>drainLightControl(id),55))}
async function drainLightControl(id){if(lightSending.has(id)||!lightPending.has(id))return;lightSending.add(id);const params=lightPending.get(id);lightPending.delete(id);try{const result=await api('control',{ids:[id],params:{state:true,fadeIn:0,fadeOut:0,...params}});if(result.results.some(item=>!item.ok))report(result,'')}catch(error){toast(error.message,true)}finally{lightSending.delete(id);if(lightPending.has(id))drainLightControl(id)}}
$('#lights-grid').addEventListener('pointerdown',event=>{if(event.target.matches('.light-brightness,.light-color'))draggingLightControl=true});
window.addEventListener('pointerup',()=>{draggingLightControl=false;for(const id of lightPending.keys())drainLightControl(id)});
$('#lights-grid').addEventListener('input',event=>{const target=event.target,id=target.dataset.id;if(target.matches('.light-brightness')){target.closest('.module-controls').querySelector('.light-brightness-value').textContent=target.value+'%';queueLightControl(id,{dimming:Number(target.value)})}if(target.matches('.light-color'))queueLightControl(id,{...rgb(target.value),w:0,c:0})});
$('#lights-grid').addEventListener('change',event=>{const target=event.target;if(target.matches('.light-brightness,.light-color'))queueLightControl(target.dataset.id,target.matches('.light-brightness')?{dimming:Number(target.value)}:{...rgb(target.value),w:0,c:0},true)});
$('#lights-grid').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const light=data.lights.find(item=>item.id===button.dataset.id);if(!light)return;if(button.matches('.toggle'))control({state:!light.state?.state},[light.id]);if(button.matches('.rename'))nameDialog('Name your light',light.name,name=>api('rename',{id:light.id,name}));if(button.matches('.temp-chip'))control({state:true,temp:Number(button.dataset.temp)},[light.id])});
const presets=Object.fromEntries(StudioScenes.map(({id,colors,dimming,temp})=>[id,colors?{colors,dimming}:{temp,dimming}]));
function applyPreset(p){if(!p.colors)return control({state:true,...('r'in p?{w:0,c:0}:{}),...p});const ids=activeLightIds();if(!ids.length)return toast('No room lights are available.',true);stopLiveModes();return action(async()=>{const batches=await Promise.all(ids.map((id,i)=>api('control',{ids:[id],params:{state:true,...rgb(p.colors[i%p.colors.length]),w:0,c:0,dimming:p.dimming,fadeIn:0,fadeOut:0}})));report({results:batches.flatMap(batch=>batch.results)},'Ambient look applied')})}
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(presets[b.dataset.preset]));
function nameDialog(title,value,callback){$('#dialog-title').textContent=title;$('#name-input').value=value;dialogAction=callback;$('#name-dialog').showModal();$('#name-input').focus();$('#name-input').select()}
$('#cancel-dialog').onclick=()=>$('#name-dialog').close();
$('#name-form').onsubmit=e=>{e.preventDefault();const name=$('#name-input').value.trim();if(!name)return;const callback=dialogAction;$('#name-dialog').close();action(async()=>{await callback(name);toast('Saved')})};
$('#save-look').onclick=()=>{const ids=activeLightIds();if(!ids.length)return toast('No room lights are available.',true);nameDialog('Save current look','',name=>api('scenes/save',{name,ids}))};
$('#saved-looks').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.matches('.run-scene')){stopLiveModes();action(async()=>report(await api('scenes/run',{id:b.dataset.id}),'Look applied'));}if(b.matches('.delete-scene')&&confirm('Delete this saved look?'))action(()=>api('scenes/delete',{id:b.dataset.id}))};
const defaultScreenPoints=[{x:.12,y:.5},{x:.38,y:.5},{x:.62,y:.5},{x:.88,y:.5}];
function loadScreenPoints(){try{const saved=JSON.parse(localStorage.getItem('wiz-screen-points'));if(Array.isArray(saved)&&saved.length===4&&saved.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)))return saved.map(point=>({x:Math.max(.04,Math.min(.96,point.x)),y:Math.max(.08,Math.min(.92,point.y))}))}catch{}return defaultScreenPoints.map(point=>({...point}))}
let screenPoints=loadScreenPoints(),draggedScreenPoint=-1,syncTimer=null,syncActive=false,screenStream=null,screenVideo=null,screenCanvas=null,screenCtx=null,lastScreenColors=[];
let musicStream=null,musicContext=null,musicTimer=null,musicActive=false,musicInFlight=false,musicPending=null,musicLastColors=[],musicLevel=0,musicLastBeat=0,musicDetectedBpm=0,musicBeatPeriod=0,musicPulseUntil=0,musicBeatIndex=0,beatIndicatorTimer=null,musicDelayTimers=[];
function sampleScreenPoint(point){const w=screenVideo.videoWidth,h=screenVideo.videoHeight;if(!w||!h)return[0,0,0];const sourceW=Math.max(12,Math.round(w*.1)),sourceH=Math.max(12,Math.round(h*.15)),x=Math.max(0,Math.min(w-sourceW,Math.round(w*point.x-sourceW/2))),y=Math.max(0,Math.min(h-sourceH,Math.round(h*point.y-sourceH/2)));screenCanvas.width=32;screenCanvas.height=32;screenCtx.drawImage(screenVideo,x,y,sourceW,sourceH,0,0,32,32);const pixels=screenCtx.getImageData(0,0,32,32).data;let r=0,g=0,b=0,weight=0;for(let i=0;i<pixels.length;i+=4){const chroma=Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2]),wgt=1+chroma/80;r+=pixels[i]*wgt;g+=pixels[i+1]*wgt;b+=pixels[i+2]*wgt;weight+=wgt}return weight?[Math.round(r/weight),Math.round(g/weight),Math.round(b/weight)]:[0,0,0]}
function vividColor(rgb){const [r,g,b]=rgb.map(v=>v/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(max===0)return[0,0,0];let h=0;if(d){if(max===r)h=((g-b)/d+(g<b?6:0))/6;else if(max===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6}const s=Math.min(1,(d/max)*1.65+.04),v=1,c=v*s,x=c*(1-Math.abs((h*6)%2-1)),m=v-c;let rr=0,gg=0,bb=0;if(h<1/6)[rr,gg,bb]=[c,x,0];else if(h<2/6)[rr,gg,bb]=[x,c,0];else if(h<3/6)[rr,gg,bb]=[0,c,x];else if(h<4/6)[rr,gg,bb]=[0,x,c];else if(h<5/6)[rr,gg,bb]=[x,0,c];else[rr,gg,bb]=[c,0,x];return[Math.round((rr+m)*255),Math.round((gg+m)*255),Math.round((bb+m)*255)]}
function isScreenBlack(color){return Math.max(...color)<=8}
function colorsChanged(colors){return colors.some((c,i)=>{const p=lastScreenColors[i];if(!p||isScreenBlack(c)!==isScreenBlack(p))return true;return Math.max(Math.abs(c[0]-p[0]),Math.abs(c[1]-p[1]),Math.abs(c[2]-p[2]))>8})}
function sendScreenColors(){if(!syncActive||!screenVideo||screenVideo.readyState<2||!selected.size)return;const ids=orderedSelectedIds(4).filter(id=>data.lights.some(light=>light.id===id&&!light.excluded));if(!ids.length)return;const colors=ids.map((_,i)=>sampleScreenPoint(screenPoints[i]||defaultScreenPoints[i]));colors.forEach((color,index)=>document.querySelector(`.sample-point[data-index="${index}"]`)?.style.setProperty('--point-color',`rgb(${color.join(',')})`));if(!colorsChanged(colors))return;lastScreenColors=colors;const scale=Number($('#sync-brightness').value)/100;Promise.all(ids.map((id,i)=>{const raw=colors[i];if(isScreenBlack(raw))return api('control',{ids:[id],params:{state:false,fadeIn:0,fadeOut:0}});const [r,g,b]=vividColor(raw),lum=Math.max(1,Math.min(100,Math.round((.2126*raw[0]+.7152*raw[1]+.0722*raw[2])*.42*scale)));return api('control',{ids:[id],params:{state:true,r,g,b,w:0,c:0,dimming:lum,fadeIn:0,fadeOut:0}})})).catch(e=>toast(e.message,true))}
function startSyncLoop(){clearInterval(syncTimer);syncTimer=setInterval(sendScreenColors,220);sendScreenColors()}
function stopSync(_unused=false,status='Ready'){syncActive=false;clearInterval(syncTimer);syncTimer=null;if(screenStream){screenStream.getTracks().forEach(track=>track.stop());screenStream=null}if(screenVideo){screenVideo.pause();screenVideo.srcObject=null;screenVideo=null}lastScreenColors=[];$('#sync-stop').disabled=true;$('#sync-start').disabled=false;$('#sync-status').textContent=status}
$('#sync-brightness').oninput=e=>{ $('#sync-brightness-value').textContent=e.target.value+'%';lastScreenColors=[];if(syncActive)sendScreenColors() };
function paintScreenPoints(){document.querySelectorAll('.sample-point').forEach((element,index)=>{const point=screenPoints[index]||defaultScreenPoints[index];element.style.left=`${point.x*100}%`;element.style.top=`${point.y*100}%`})}
function positionScreenPoint(index,event){const rect=$('#sync-map').getBoundingClientRect();screenPoints[index]={x:Math.max(.04,Math.min(.96,(event.clientX-rect.left)/rect.width)),y:Math.max(.08,Math.min(.92,(event.clientY-rect.top)/rect.height))};paintScreenPoints();if(syncActive)sendScreenColors()}
$('#sync-map').addEventListener('pointerdown',event=>{const point=event.target.closest('.sample-point');if(!point)return;draggedScreenPoint=Number(point.dataset.index);point.setPointerCapture(event.pointerId);positionScreenPoint(draggedScreenPoint,event)});
$('#sync-map').addEventListener('pointermove',event=>{if(draggedScreenPoint>=0)positionScreenPoint(draggedScreenPoint,event)});
$('#sync-map').addEventListener('pointerup',event=>{if(draggedScreenPoint<0)return;event.target.closest('.sample-point')?.releasePointerCapture?.(event.pointerId);draggedScreenPoint=-1;localStorage.setItem('wiz-screen-points',JSON.stringify(screenPoints))});
$('#sync-map').addEventListener('pointercancel',()=>{draggedScreenPoint=-1;localStorage.setItem('wiz-screen-points',JSON.stringify(screenPoints))});
$('#sync-map').addEventListener('keydown',event=>{const element=event.target.closest('.sample-point');if(!element||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const index=Number(element.dataset.index),step=event.shiftKey ? .05 : .01,point=screenPoints[index];if(event.key==='ArrowLeft')point.x-=step;if(event.key==='ArrowRight')point.x+=step;if(event.key==='ArrowUp')point.y-=step;if(event.key==='ArrowDown')point.y+=step;point.x=Math.max(.04,Math.min(.96,point.x));point.y=Math.max(.08,Math.min(.92,point.y));paintScreenPoints();localStorage.setItem('wiz-screen-points',JSON.stringify(screenPoints));if(syncActive)sendScreenColors()});
$('#reset-sync-points').onclick=()=>{screenPoints=defaultScreenPoints.map(point=>({...point}));localStorage.setItem('wiz-screen-points',JSON.stringify(screenPoints));paintScreenPoints();if(syncActive)sendScreenColors();toast('Screen markers reset')};
paintScreenPoints();
$('#sync-start').onclick=async()=>{if(!activeLightIds().length)return toast('No room lights are available.',true);try{if(typeof navigator.mediaDevices?.getDisplayMedia!=='function')throw Error('This browser cannot capture a screen. Open the panel in Chrome at http://127.0.0.1:8765');screenStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:10,max:15}},audio:false,selfBrowserSurface:'include',surfaceSwitching:'include'});const videoTrack=screenStream.getVideoTracks()[0];screenVideo=document.createElement('video');screenVideo.autoplay=true;screenVideo.muted=true;screenVideo.playsInline=true;screenVideo.srcObject=screenStream;await screenVideo.play();screenCanvas=document.createElement('canvas');screenCanvas.width=160;screenCanvas.height=90;screenCtx=screenCanvas.getContext('2d',{willReadFrequently:true});videoTrack.onended=()=>stopSync(false,'Share ended · click Start again');const surface=videoTrack.getSettings?.().displaySurface||'screen';syncActive=true;$('#sync-stop').disabled=false;$('#sync-start').disabled=true;$('#sync-status').textContent=`Live · ${surface}`;startSyncLoop()}catch(e){stopSync(false,'Capture unavailable');toast(e.message||'Screen sharing was cancelled. Choose a tab, window, or entire screen.',true)}};
$('#sync-stop').onclick=()=>stopSync(false);
function hsv(h,s,v){h=((h%360)+360)%360;const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]}
// Fixed Bose fallback is an estimate, not a manufacturer latency specification.
const BOSE_PRESET_MS=270, WIZ_ESTIMATED_REACTION_MS=45;
let musicNode=null,musicSource=null,musicGeneration=0,musicSession=null,musicSequence=0;
let musicSpeakerDelay=BOSE_PRESET_MS,musicDispatchMs=5,musicLastAmbient=0;
let musicMic=null,musicMicSource=null,musicCalibration=null,musicCalibrationTimer=null;
let musicLatest=null,musicLastVisualTime=-Infinity,musicLastStatus=0;
function musicTempoProfile(){const bpm=musicDetectedBpm||110;if(bpm<85)return{kind:'slow',hold:180,fade:0,label:'Slow groove · detected hits'};if(bpm<135)return{kind:'pulse',hold:100,fade:0,label:'Steady groove · detected hits'};return{kind:'strobe',hold:75,fade:0,label:'Fast groove · detected hits'}}
function musicBrightness(a,active,decay){return Math.max(.16,Math.min(1,.22+Math.sqrt(Math.min(1,a.energy*3))*.38+(active?decay*.34:0)))}
function musicColors(a){const mode=$('#music-mode').value,active=a.now<musicPulseUntil,step=musicBeatIndex,period=musicBeatPeriod||1000,decay=Math.max(.08,1-(a.now-musicLastBeat)/Math.max(120,period*.78)),palette=[hsv(325,1,1),hsv(190,1,1),hsv(45,1,1),hsv(265,.92,1)],profile=musicTempoProfile(),brightness=musicBrightness(a,active,decay);let colors=[],levels=[],on=[];if(mode==='adaptive'){colors=[0,1,2,3].map(i=>palette[(i+step)%4]);if(profile.kind==='slow'){levels=[1,.88,.76,.66].map((value,i)=>Math.max(.3,value*(.48+decay*.52)+(i===step%4 ? .08 : 0)));on=[true,true,true,true]}else if(profile.kind==='pulse'){const dark=(step+3)%4;levels=[0,1,2,3].map(i=>i===dark ? .1 : Math.max(.12,decay*(i===step%4 ? 1 : .62)));on=[true,true,true,true]}else{const primary=step%4,secondary=(step+1+(step%2))%4;levels=[0,1,2,3].map(i=>i===primary ? 1 : i===secondary ? .58 : .04);on=[0,1,2,3].map(i=>active&&(i===primary||i===secondary))}}else if(mode==='techno'){const primary=step%4,secondary=(step+1+(step%2))%4;for(let i=0;i<4;i++){colors[i]=palette[(i+step)%palette.length];levels[i]=i===primary ? 1 : i===secondary ? .52 : .05;on[i]=active&&(i===primary||i===secondary)}}else if(mode==='single'){const color=hsv(252,.88,1);colors=[color,color,color,color];levels=[a.energy,a.energy,a.energy,a.energy].map(value=>.16+value*.84);on=[true,true,true,true]}else if(mode==='party'){colors=[0,1,2,3].map(i=>palette[(i+step)%4]);levels=[a.bass,a.mid,a.high,(a.bass+a.mid)/2].map(value=>Math.max(.16,decay*(.45+value*.55)));on=[true,true,true,true]}else if(mode==='spectrum'){colors=[hsv(8,1,1),hsv(50,1,1),hsv(135,.95,1),hsv(220,1,1)];levels=[a.bass,(a.bass+a.mid)/2,a.mid,a.high];on=[true,true,true,true]}else if(mode==='beat'){colors=[hsv(0,.08,1),hsv(35,.9,1),hsv(0,.08,1),hsv(35,.9,1)];levels=[1,1,1,1];on=[active,active,active,active]}else if(mode==='flow'){const base=a.now*.045+a.energy*90+(musicDetectedBpm||120);colors=[0,42,84,126].map(offset=>hsv(base+offset,.94,1));levels=[a.bass,a.mid,a.high,a.energy].map(value=>.28+value*.72);on=[true,true,true,true]}else{const base=200+a.energy*100;colors=[0,24,48,72].map(offset=>hsv(base+offset,.72,1));levels=[a.bass,a.mid,a.high,a.energy].map(value=>.12+value*.75);on=[true,true,true,true]}return colors.map((color,i)=>({color,dim:Math.max(10,Math.min(100,Math.round(levels[i]*(mode==='beat'?1:brightness)*100))),on:on[i]}))}
function musicChanged(next){return next.some((item,i)=>{const p=musicLastColors[i];return !p||item.on!==p.on||Math.abs(item.dim-p.dim)>4||item.color.some((v,j)=>Math.abs(v-p.color[j])>10)})}
function sendMusicColors(next,due=performance.now(),generation=musicGeneration){
  if(!musicActive||generation!==musicGeneration||!musicSession||performance.now()-due>100)return;
  musicPending={next,due,generation};if(musicInFlight)return;
  const batch=musicPending;musicPending=null;musicInFlight=true;
  const ids=orderedSelectedIds(4).filter(id=>data.lights.some(l=>l.id===id&&!l.excluded&&l.online));
  if(!ids.length){musicInFlight=false;return;}
  const frames=ids.map((id,i)=>{const {color:[r,g,b],dim,on}=batch.next[i%batch.next.length];return{id,params:on?{state:true,r,g,b,w:0,c:0,dimming:Math.max(10,dim),fadeIn:0,fadeOut:0}:{state:false,fadeIn:0,fadeOut:0}}});
  const began=performance.now();
  api('music/frame',{session:musicSession,sequence:++musicSequence,frames,expiresAt:Date.now()+Math.max(0,batch.due+100-began)})
    .then(result=>{if(generation!==musicGeneration)return;if(result.dropped){stopMusic();toast('Music sync stopped by another light control. Start it again to resume.');return;}musicDispatchMs=musicDispatchMs*.85+Math.min(50,(performance.now()-began)/2)*.15;})
    .catch(e=>{if(generation===musicGeneration){stopMusic();toast(e.message,true);}})
    .finally(()=>{if(generation!==musicGeneration)return;musicInFlight=false;if(musicPending){const p=musicPending;musicPending=null;sendMusicColors(p.next,p.due,p.generation);}});
}
function scheduleMusicFrame(next,due,at,generation,releaseFor=null){
  if(due===null)return;
  const timer=setTimeout(()=>{
    musicDelayTimers=musicDelayTimers.filter(t=>t!==timer);
    if(!musicActive||generation!==musicGeneration||at<musicLastVisualTime||performance.now()-due>100)return;
    if(releaseFor!==null&&musicLastBeat>releaseFor)return;
    musicLastVisualTime=at;sendMusicColors(next,due,generation);
  },Math.max(0,due-performance.now()));musicDelayTimers.push(timer);
}
function musicTick(frame){
  if(!musicActive)return;
  const now=performance.now(),context=musicContext,generation=musicGeneration;
  // This context analyzes a captured tab: outputLatency describes THIS context,
  // not the other tab's Bluetooth playback, so do not add it as a magic correction.
  const capturedAt=now-(context.currentTime-frame.time)*1000;
  const hitAt=frame.hit===null?null:now-(context.currentTime-frame.hit)*1000;
  const energy=frame.bass*.5+frame.mid*.32+frame.high*.18;
  musicLevel=musicLevel*.65+Math.min(1,frame.rms*5)*.35;
  musicDetectedBpm=frame.bpm;musicBeatPeriod=frame.bpm?60000/frame.bpm:0;
  musicLatest={bass:frame.bass,mid:frame.mid,high:frame.high,energy,now:capturedAt,beat:hitAt!==null};
  if(musicCalibration){musicCalibration.ref.push(frame.refEnvelope);musicCalibration.mic.push(frame.micEnvelope);}
  if(now-musicLastStatus>150){
    musicLastStatus=now;$('#music-level').value=musicLevel;
    $('#music-bpm').textContent=frame.bpm?`≈ ${Math.round(frame.bpm)} BPM`:'Finding tempo…';
    $('#music-status').textContent=frame.rms<.0015?'Listening · quiet':frame.bpm?'Following hits':'Following hits · finding tempo';
    $('#tempo-behavior').textContent=$('#music-mode').value==='adaptive'?musicTempoProfile().label:'Flashes follow detected attacks';
  }
  const mode=$('#music-mode').value,pulseMode=['beat','techno','adaptive'].includes(mode);
  if(hitAt!==null){
    musicLastBeat=hitAt;musicBeatIndex++;musicPulseUntil=hitAt+musicTempoProfile().hold;
    const a={...musicLatest,now:hitAt},next=musicColors(a);
    const due=MusicDSP.commandDeadline(hitAt,musicSpeakerDelay,WIZ_ESTIMATED_REACTION_MS+musicDispatchMs,now);
    scheduleMusicFrame(next,due,hitAt,generation);musicLastColors=next;
    if(pulseMode){
      const end=hitAt+musicTempoProfile().hold;
      const off=musicColors({...a,now:end+1});
      // Beat/techno/adaptive all get explicit release; no polling needed to end a flash.
      const released=off.map(item=>({...item,on:false}));
      scheduleMusicFrame(released,MusicDSP.commandDeadline(end,musicSpeakerDelay,WIZ_ESTIMATED_REACTION_MS+musicDispatchMs,now),end,generation,hitAt);
    }
    const indicatorTimer=setTimeout(()=>{musicDelayTimers=musicDelayTimers.filter(t=>t!==indicatorTimer);if(!musicActive||generation!==musicGeneration)return;$('#beat-indicator').classList.add('hit');clearTimeout(beatIndicatorTimer);beatIndicatorTimer=setTimeout(()=>$('#beat-indicator').classList.remove('hit'),80);},Math.max(0,hitAt+musicSpeakerDelay-now));musicDelayTimers.push(indicatorTimer);
  }else if(!pulseMode&&now-musicLastAmbient>80){
    musicLastAmbient=now;const next=musicColors(musicLatest);if(frame.rms<.0015)next.forEach(item=>item.on=false);
    if(musicChanged(next)){musicLastColors=next;scheduleMusicFrame(next,MusicDSP.commandDeadline(capturedAt,musicSpeakerDelay,WIZ_ESTIMATED_REACTION_MS+musicDispatchMs,now),capturedAt,generation);}
  }
}
function endCalibration(){
  clearTimeout(musicCalibrationTimer);musicCalibrationTimer=null;
  if(musicMicSource){musicMicSource.disconnect();musicMicSource=null;}
  if(musicMic){musicMic.getTracks().forEach(t=>t.stop());musicMic=null;}
  musicCalibration=null;$('#music-calibrate').disabled=!musicActive;
}
async function calibrateMusic(){
  if(!musicActive||musicCalibration)return;
  const generation=musicGeneration;$('#music-calibrate').disabled=true;
  $('#music-timing').textContent='Allow your Mac microphone; keep music playing near it…';
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    if(!musicActive||generation!==musicGeneration){stream.getTracks().forEach(t=>t.stop());return;}
    const track=stream.getAudioTracks()[0];
    // A Bluetooth microphone may switch the speaker into a different audio mode.
    if(!/macbook|built.?in|internal|mac studio|imac/i.test(track.label))throw Error('Choose the Mac’s built-in microphone in browser microphone settings, then measure again.');
    musicMic=stream;musicMicSource=musicContext.createMediaStreamSource(stream);musicMicSource.connect(musicNode,0,1);
    const measuredInputLatency=track.getSettings().latency;
    musicCalibration={ref:[],mic:[]};$('#music-timing').textContent='Measuring Bose timing · keep music playing for 10 seconds…';
    musicCalibrationTimer=setTimeout(()=>{
      if(generation!==musicGeneration||!musicCalibration)return;
      const result=MusicDSP.correlateDelay(musicCalibration.ref,musicCalibration.mic,Math.round(musicContext.sampleRate/100)/musicContext.sampleRate);
      endCalibration();
      if(result){
        // Subtract reported microphone input latency; unreported input buffering
        // remains an uncertainty. Never call this a measured bulb response time.
        musicSpeakerDelay=Math.max(0,result.delayMs-(Number.isFinite(measuredInputLatency)?measuredInputLatency*1000:0));
        if(typeof trackTimingMeasured==='function')trackTimingMeasured(musicSpeakerDelay);
        $('#music-timing').textContent=`Bose timing measured · approximately ${Math.round(musicSpeakerDelay)} ms${Number.isFinite(measuredInputLatency)?'':' · microphone latency unreported'}`;
      }else $('#music-timing').textContent='Timing measurement unclear · previous timing kept. Try a louder, varied section.';
    },10000);
  }catch(e){if(stream)stream.getTracks().forEach(t=>t.stop());if(generation!==musicGeneration)return;endCalibration();$('#music-timing').textContent=`Previous timing kept · approximately ${Math.round(musicSpeakerDelay)} ms`;toast(e.message||'Microphone unavailable. Previous timing kept.',true);}
}
function stopMusic(){
  if(typeof trackStop==='function')trackStop();
  const session=musicSession;musicSession=null;musicActive=false;musicGeneration++;
  clearInterval(musicTimer);musicTimer=null;clearTimeout(beatIndicatorTimer);
  musicDelayTimers.forEach(clearTimeout);musicDelayTimers=[];endCalibration();
  if(musicNode){musicNode.port.onmessage=null;musicNode.port.close();musicNode.disconnect();musicNode=null;}
  if(musicSource){musicSource.disconnect();musicSource=null;}
  if(musicStream){musicStream.getTracks().forEach(t=>t.stop());musicStream=null;}
  if(musicContext){musicContext.close().catch(()=>{});musicContext=null;}
  musicPending=null;musicInFlight=false;musicLastColors=[];musicDetectedBpm=0;musicBeatPeriod=0;musicPulseUntil=0;
  $('#beat-indicator').classList.remove('hit');$('#music-bpm').textContent='Listening…';$('#music-level').value=0;
  $('#music-stop').disabled=true;$('#music-start').disabled=false;$('#music-status').textContent='Ready';
  if(session)api('music/stop',{session}).catch(()=>{});
}
$('#music-calibrate').onclick=calibrateMusic;
$('#music-mode').onchange=()=>{musicDelayTimers.forEach(clearTimeout);musicDelayTimers=[];musicLastColors=[];if(typeof trackModeChanged==='function')trackModeChanged();};
$('#music-start').onclick=async()=>{
  if(!activeLightIds().length)return toast('No room lights are available.',true);
  if(syncActive)stopSync(false);stopMusic();const generation=musicGeneration;
  $('#music-start').disabled=true;$('#music-status').textContent='Choose music tab + Share audio…';
  let stream=null;
  try{
    if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Open this panel in Chrome to share tab audio.');
    stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{suppressLocalAudioPlayback:false},selfBrowserSurface:'include',surfaceSwitching:'exclude'});
    if(generation!==musicGeneration){stream.getTracks().forEach(t=>t.stop());return;}
    musicStream=stream;const tracks=stream.getAudioTracks();if(!tracks.length)throw Error('Choose the music tab and enable Share audio.');
    musicContext=new AudioContext({latencyHint:'interactive'});await musicContext.audioWorklet.addModule('/music-worklet.js');
    if(generation!==musicGeneration)return;
    musicSource=musicContext.createMediaStreamSource(new MediaStream(tracks));
    musicNode=new AudioWorkletNode(musicContext,'music-detector',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[1]});
    musicSource.connect(musicNode,0,0);musicNode.connect(musicContext.destination);await musicContext.resume();
    const result=await api('music/start',{});
    if(generation!==musicGeneration){api('music/stop',{session:result.session}).catch(()=>{});return;}
    musicSession=result.session;musicSequence=0;musicActive=true;musicSpeakerDelay=BOSE_PRESET_MS;musicDispatchMs=5;
    musicLastVisualTime=-Infinity;musicLastBeat=-Infinity;musicBeatIndex=0;musicLastAmbient=0;musicLevel=0;
    musicNode.port.onmessage=event=>{if(generation===musicGeneration)musicTick(event.data);};
    musicNode.onprocessorerror=()=>{if(generation===musicGeneration){stopMusic();toast('Audio analysis stopped. Start music sync again.',true);}};
    stream.getTracks().forEach(t=>t.onended=()=>{if(generation===musicGeneration)stopMusic();});
    $('#music-stop').disabled=false;$('#music-calibrate').disabled=false;$('#music-status').textContent='Following hits';
    $('#music-timing').textContent='Bose preset · estimated 270 ms. Measure once for this playback session.';
  }catch(e){if(stream&&generation!==musicGeneration)stream.getTracks().forEach(t=>t.stop());if(generation===musicGeneration){stopMusic();toast(e.message||'Audio sharing cancelled.',true);}}
};
$('#music-stop').onclick=()=>stopMusic();
let handActive=false,handStream=null,handLandmarker=null,handFrame=0,handLastVideoTime=-1,handLastZone='',handLastBrightness=0,handLastCommand=0,handInFlight=false,handPending=null,handSmoothing=[{x:.5,y:.5},{x:.5,y:.5}];
const handZones=[{limit:.13,label:'Left edge · Lamp',indexes:[0]},{limit:.37,label:'Left zone · Lamp + Left Bulb',indexes:[0,1]},{limit:.63,label:'Middle zone · Left Bulb + Right Bulb',indexes:[1,2]},{limit:.87,label:'Right zone · Right Bulb + Table lamp',indexes:[2,3]},{limit:1,label:'Right edge · Table lamp',indexes:[3]}];
function handZoneAt(x){return handZones.find(zone=>x<zone.limit)||handZones[handZones.length-1]}
function drawHands(points){const video=$('#hand-video'),canvas=$('#hand-overlay'),ctx=canvas.getContext('2d');if(canvas.width!==video.videoWidth||canvas.height!==video.videoHeight){canvas.width=video.videoWidth;canvas.height=video.videoHeight}ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#d7ef91';ctx.strokeStyle='#d7ef91';ctx.lineWidth=4;for(const {x,y} of points){ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,15,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.55;ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,34,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1}}
function queueHandControl(groups,offIds){handPending={groups,offIds};if(handInFlight)return;handInFlight=true;const send=()=>{const next=handPending;handPending=null;if(!next){handInFlight=false;return}const commands=next.groups.map(group=>api('control',{ids:group.ids,params:{state:true,dimming:group.dimming,fadeIn:0,fadeOut:0}}));if(next.offIds.length)commands.push(api('control',{ids:next.offIds,params:{state:false,fadeIn:0,fadeOut:0}}));Promise.all(commands).catch(error=>toast(error.message,true)).finally(()=>{if(handPending)send();else handInFlight=false})};send()}
function handleHand(result){const hands=(result.landmarks||[]).slice(0,2);if(!hands.length){$('#hand-status').textContent='Looking for hand';$('#hand-zone').textContent='Show one or two hands to begin.';return}const allIds=activeLightIds(4),byId=new Map(),points=[],labels=[],brightnesses=[];hands.forEach((landmarks,index)=>{const pointer=landmarks[8],palm=(landmarks[0].y+landmarks[9].y)/2,smooth=handSmoothing[index]||(handSmoothing[index]={x:.5,y:.5});smooth.x=smooth.x*.45+(1-pointer.x)*.55;smooth.y=smooth.y*.45+palm*.55;const zone=handZoneAt(smooth.x),height=Math.max(0,Math.min(1,(1-smooth.y-.12)/.72)),brightness=Math.max(1,Math.min(100,Math.round(1+99*Math.pow(height,2.2))));zone.indexes.forEach(i=>{const id=allIds[i];if(id)byId.set(id,Math.max(byId.get(id)||0,brightness))});points.push(smooth);labels.push(zone.label);brightnesses.push(brightness)});const groups=[...byId.entries()].reduce((result,[id,dimming])=>{const group=result.find(item=>item.dimming===dimming);if(group)group.ids.push(id);else result.push({ids:[id],dimming});return result},[]),onIds=[...byId.keys()],offIds=allIds.filter(id=>!byId.has(id)),signature=groups.map(group=>`${group.ids.join(',')}:${group.dimming}`).join('|'),zoneChanged=signature!==handLastZone;drawHands(points);$('#hand-status').textContent=`Tracking ${hands.length} hand${hands.length===1?'':'s'}`;$('#hand-zone').textContent=labels.join(' + ');$('#hand-brightness').textContent=`Hand brightness · ${brightnesses.map(value=>`${value}%`).join(' / ')}`;const now=performance.now(),brightness=Math.max(...brightnesses),changed=zoneChanged||Math.abs(brightness-handLastBrightness)>=4;if(changed&&now-handLastCommand>100&&onIds.length){handLastZone=signature;handLastBrightness=brightness;handLastCommand=now;queueHandControl(groups,offIds)}}
function handLoop(){if(!handActive)return;const video=$('#hand-video');if(video.readyState>=2&&video.currentTime!==handLastVideoTime){handLastVideoTime=video.currentTime;try{handleHand(handLandmarker.detectForVideo(video,performance.now()))}catch(error){stopHand();toast('Hand tracking stopped: '+error.message,true);return}}handFrame=requestAnimationFrame(handLoop)}
async function startHand(){if(!activeLightIds(4).length)return toast('No room lights are available.',true);if(syncActive)stopSync(false);if(musicActive)stopMusic(false);try{$('#hand-status').textContent='Opening camera…';$('#hand-start').disabled=true;const packageUrl='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';const {FilesetResolver,HandLandmarker}=await import(`${packageUrl}/vision_bundle.mjs`);const vision=await FilesetResolver.forVisionTasks(`${packageUrl}/wasm`);handLandmarker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.65,minTrackingConfidence:.65});handStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});const video=$('#hand-video');video.srcObject=handStream;await video.play();handActive=true;handLastVideoTime=-1;handLastZone='';handLastBrightness=0;handSmoothing=[{x:.5,y:.5},{x:.5,y:.5}];$('#hand-stop').disabled=false;$('#hand-status').textContent='Show one or two hands';handFrame=requestAnimationFrame(handLoop)}catch(error){const message=error?.message||'Camera access was not granted.';stopHand(`Camera unavailable · ${message}`);toast(message,true)}}
function stopHand(status='Camera off'){handActive=false;cancelAnimationFrame(handFrame);handFrame=0;handPending=null;if(handStream){handStream.getTracks().forEach(track=>track.stop());handStream=null}if(handLandmarker){handLandmarker.close();handLandmarker=null}const video=$('#hand-video'),canvas=$('#hand-overlay');if(video){video.pause();video.srcObject=null}if(canvas)canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);$('#hand-stop').disabled=true;$('#hand-start').disabled=false;$('#hand-status').textContent=status;$('#hand-zone').textContent='Show one or two hands to begin.';$('#hand-brightness').textContent='Your hand height will set brightness.'}
$('#hand-start').onclick=startHand;
$('#hand-stop').onclick=stopHand;
const startScreenSync=$('#sync-start').onclick,startMusicSync=$('#music-start').onclick;
$('#sync-start').onclick=async(...args)=>{if(handActive)stopHand();return startScreenSync(...args)};
$('#music-start').onclick=async(...args)=>{if(handActive)stopHand();return startMusicSync(...args)};
(async()=>{try{token=(await api('session')).token;await refresh()}catch(e){$('#connection').textContent='Panel disconnected';toast(e.message,true)}})();
async function pollPanel(){
 if(!busy&&!draggingLightControl&&!$('#name-dialog').open){try{await refresh()}catch{refreshFailures++;$('#connection').textContent=refreshFailures<3?'Reconnecting to panel…':'Panel disconnected — reopen Start.command'}}
 setTimeout(pollPanel,2500);
}
setTimeout(pollPanel,2500);
