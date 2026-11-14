import * as THREE from 'three';
import { OrbitControls } from '/vendor/OrbitControls.js';

const $ = s => document.querySelector(s);
const fixtures = [
  {key:'floor', name:'Floor Lamp', match:'floor lamp', location:'Beside the window, behind the side table', p:[-1.22,1.35,-1.37]},
  {key:'left', name:'Left bed light', match:'left bulb', location:'Above the bed · left side of the wall fitting', p:[-.30,2.12,-1.54]},
  {key:'right', name:'Right bed light', match:'right bulb', location:'Above the bed · right side of the wall fitting', p:[.10,2.12,-1.54]},
  {key:'table', name:'Table lamp', match:'table lamp', location:'Desk corner beside the Mac, right of the bed', p:[1.26,1.24,-1.27]},
];
let data={lights:[]}, token='', selected=0, reachable=false, sending=false, labels=true, noticeTimer;
let preview=true, night=true, ambientLight, daylight;
let previewStates=fixtures.map(()=>({state:true,temp:2700,dimming:60}));
let savedLooks=[];
try {const stored=JSON.parse(localStorage.getItem('wiz-studio-looks')||'[]');if(Array.isArray(stored))savedLooks=stored.filter(x=>typeof x.name==='string' && Array.isArray(x.states) && x.states.length===4 && x.states.every(s=>s && typeof s==='object'));}catch{}
function stateFor(f){return preview ? previewStates[fixtures.indexOf(f)] : bulb(f)?.state || {};}
function scopeIndexes(){return ({all:[0,1,2,3],bed:[1,2],lamps:[0,3]})[$('#scope').value] || [selected];}
function mergeState(old,params){const next={...old,...params};if('temp' in params){delete next.r;delete next.g;delete next.b;}if('r' in params)delete next.temp;return next;}
let bindings={};
try { bindings=JSON.parse(localStorage.getItem('wiz-room-bindings') || '{}') || {}; } catch {}
if(typeof bindings !== 'object' || Array.isArray(bindings)) bindings={};
function bulb(f){ return data.lights.find(l=> !l.excluded && l.id === bindings[f.key]); }
function notify(message,error=false){const el=$('#notice');el.textContent=message;el.classList.toggle('error',error);el.style.display='block';clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>el.style.display='none',5500);}
async function api(path,body,retry=true){
  const response=await fetch('/api/'+path,body ? {method:'POST',headers:{'Content-Type':'application/json','X-Wiz-Token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)} : {signal:AbortSignal.timeout(15000)});
  if(response.status===403 && body && retry){token=(await api('session')).token;return api(path,body,false);}
  const result=await response.json();if(!response.ok)throw Error(result.error || 'WiZ connection failed');return result;
}
function colorOf(s={}){
  if(s.temp) return new THREE.Color(s.temp<=3200 ? '#ffc38b' : s.temp>=5500 ? '#dceaff' : '#fff0d2');
  if(Number.isFinite(s.r)) return new THREE.Color(`rgb(${s.r},${s.g||0},${s.b||0})`);
  return new THREE.Color('#ffe0b1');
}

// Read-only discovery by the existing server; opening this page sends no light commands.
async function refresh(){
  try{
    data=await api('state');reachable=true;
    for(const f of fixtures) if(!Object.hasOwn(bindings,f.key)){
      const found=data.lights.find(l=>!l.excluded && l.name.toLowerCase()===f.match);
      if(found) bindings[f.key]=found.id;
    }
    $('#connection').textContent=`${fixtures.filter(f=>bulb(f)?.online && !bulb(f)?.stale).length} / 4 fixtures connected`;
    $('#updated').textContent='Updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }catch{reachable=false;$('#connection').textContent='Dashboard disconnected';$('#updated').textContent='States unavailable · Start the WiZ server';}
  renderState();
}
async function sendStates(entries,label){
  if(sending)return;
  if(preview){for(const [i,params] of entries)previewStates[i]=mergeState(previewStates[i],params);renderState();notify(label+' · preview');return;}
  const targets=entries.map(([i,params])=>({light:bulb(fixtures[i]),params,name:fixtures[i].name}));
  if(!reachable || targets.some(t=>!t.light?.online || t.light.stale)){notify('All targeted fixtures must be connected. Check fixture assignments or use Preview.',true);return;}
  sending=true;renderState();
  let failures=[];
  try{
    for(const t of targets){
      try{const result=await api('control',{ids:[t.light.id],params:{fadeIn:500,fadeOut:500,...t.params}});
      if(!result.results?.length || result.results.some(r=>!r.ok))failures.push(t.name);
      }catch{failures.push(t.name);}
    }
    notify(failures.length?'Not confirmed: '+failures.join(', '):label+' applied',!!failures.length);
  }finally{sending=false;await refresh();}
}
async function command(params){return sendStates(scopeIndexes().map(i=>[i,params]),'Lighting');}
function select(index){selected=index;renderState();}
for(const [i,f] of fixtures.entries()){
  const card=document.createElement('button');card.className='fixture';
  card.innerHTML=`<span class="orb"></span><span><strong>${f.name}</strong><small>Waiting…</small></span><span class="index">0${i+1}</span>`;
  card.onclick=()=>select(i);$('#fixtures').append(card);f.card=card;
  const marker=document.createElement('button');marker.className='marker';marker.innerHTML=`<b>0${i+1}</b><span>${f.name}</span>`;marker.setAttribute('aria-label','Select '+f.name);marker.onclick=()=>select(i);$('#markers').append(marker);f.marker=marker;
}
function renderState(){
  document.querySelectorAll('.mood,#preview-mode,#live-mode,#apply-preview,#scope,#binding,#save-look button,.saved-look button').forEach(el=>el.disabled=sending);

  const f=fixtures[selected],l=bulb(f),s=stateFor(f),available=preview || (reachable && scopeIndexes().every(i=>bulb(fixtures[i])?.online && !bulb(fixtures[i])?.stale));
  $('#name').textContent=f.name;$('#location').textContent=f.location;$('#number').textContent='0'+(selected+1);
  $('#status').textContent=sending?'Sending…':preview?'Preview · no bulb commands':!reachable?'No connection':!l?'Assign a bulb below':!l.online?'Bulb offline':l.stale?'Reconnecting…':s.state?'Light is on':'Light is off';
  $('#power').disabled=!available||sending;$('#controls').disabled=!available||sending;
  $('#power').textContent=available?(s.state?'On':'Off'):'—';$('#power').setAttribute('aria-pressed',String(!!(available&&s.state)));
  if(document.activeElement!==$('#brightness')){$('#brightness').value=s.dimming ?? 50;$('#brightness-value').textContent=preview||l?`${s.dimming ?? 50}%`:'—';}
  if(document.activeElement!==$('#color')) $('#color').value='#'+colorOf(s).getHexString();
  const selectEl=$('#binding');
  if(document.activeElement!==selectEl){
    selectEl.replaceChildren(new Option('Not assigned',''));
    for(const item of data.lights.filter(l=>!l.excluded)){
      const option=new Option(item.name,item.id);option.disabled=fixtures.some(other=>other!==f && bindings[other.key]===item.id);selectEl.add(option);
    }
    selectEl.value=l?.id || '';
  }
  fixtures.forEach((item,index)=>{
    const b=bulb(item),state=stateFor(item),online=preview || (reachable && b?.online && !b.stale),on=online&&state.state;
    const color=colorOf(state),hex='#'+color.getHexString();
    item.card.classList.toggle('selected',index===selected);item.card.setAttribute('aria-pressed',String(index===selected));
    item.marker.classList.toggle('selected',index===selected);item.marker.setAttribute('aria-pressed',String(index===selected));
    item.card.style.setProperty('--bulb',on?hex:'#525e55');item.card.style.setProperty('--glow',on?hex+'50':'transparent');
    item.card.querySelector('small').textContent=preview?`Preview · ${on?(state.dimming ?? 50)+'%':'Off'}`:!b?'Not assigned':!online?'Unavailable':on?`On · ${state.dimming ?? 50}%`:'Off';
    if(item.halo){item.halo.visible=index===selected;item.halo.material.color.copy(color);}
    if(item.light){item.light.color.copy(color);item.light.intensity=on?(.15+5*(state.dimming ?? 50)/100):0;item.shade.material.emissive.copy(color);item.shade.material.emissiveIntensity=on?.25+.65*(state.dimming ?? 50)/100:0;}
  });
}
$('#binding').onchange=e=>{bindings[fixtures[selected].key]=e.target.value;try{localStorage.setItem('wiz-room-bindings',JSON.stringify(bindings));notify('Fixture connection saved');}catch{notify('Mapping changed for this session only',true);}renderState();};
$('#power').onclick=()=>command({state:!stateFor(fixtures[selected]).state});
$('#brightness').oninput=e=>$('#brightness-value').textContent=e.target.value+'%';
$('#brightness').onchange=e=>command({state:true,dimming:Number(e.target.value)});
function setColor(hex){return command({state:true,r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16),w:0,c:0});}
$('#color').onchange=e=>setColor(e.target.value);
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>setColor(b.dataset.color));
document.querySelectorAll('[data-temp]').forEach(b=>b.onclick=()=>command({state:true,temp:Number(b.dataset.temp)}));
$('#labels').onclick=()=>{labels=!labels;$('#labels').textContent=labels?'Labels on':'Labels off';$('#labels').setAttribute('aria-pressed',String(labels));};


$('#scope').onchange=()=>{selected=scopeIndexes()[0];renderState();};
$('#apply-preview').onclick=async()=>{if(!preview||sending)return;const states=previewStates.map(s=>cleanState(s));setMode(false);await sendStates(states.map((s,i)=>[i,s]),'Preview look');};
function setMode(value){
  if(sending)return;
  if(value && !preview)previewStates=fixtures.map(f=>({...bulb(f)?.state}));
  preview=value;
  $('#preview-mode').setAttribute('aria-pressed',String(preview));$('#live-mode').setAttribute('aria-pressed',String(!preview));
  $('#mode-description').textContent=preview?'Explore looks in 3D · bulbs stay unchanged':'LIVE · controls change your physical lights';
  $('#control-hint').textContent=preview?'Preview changes only the model. Switch to Live control to change your bulbs. Rendered lighting is approximate.':'Changes apply to your selected control scope. Mood cards set all four fixtures. Rendered lighting is approximate.';
  document.body.classList.toggle('live-mode',!preview);$('#apply-preview').hidden=!preview;renderState();
}
$('#preview-mode').onclick=()=>setMode(true);$('#live-mode').onclick=()=>setMode(false);
$('#night-view').onclick=()=>{night=!night;$('#night-view').setAttribute('aria-pressed',String(night));$('#night-view').textContent=night?'☾ Night view':'☀ Day view';if(ambientLight)ambientLight.intensity=night?.42:1.3;if(daylight)daylight.intensity=night?.35:2;};
const rgb=(hex,dimming)=>({state:true,dimming,r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16),w:0,c:0});
const white=(temp,dimming)=>({state:true,temp,dimming});
const moods=[
 {name:'Golden hour',tag:'A softer landing',colors:['#ffb05e','#ff795c'],states:[white(2700,65),rgb('#ff9550',45),rgb('#ffbf6b',45),white(2700,35)]},
 {name:'Aurora',tag:'Mint meets violet',colors:['#49dec3','#9e74ff'],states:[rgb('#46d6bb',55),rgb('#6556ff',70),rgb('#ca69ff',65),rgb('#83e4cc',35)]},
 {name:'Deep focus',tag:'Clear desk, quiet room',colors:['#c8e8ff','#fff0cc'],states:[white(4000,45),white(4000,30),white(4000,30),white(5500,100)]},
 {name:'Cinema',tag:'Low light, big atmosphere',colors:['#414cc9','#f1856b'],states:[rgb('#4861ed',15),rgb('#6350dd',20),rgb('#d76568',20),{state:false}]},
 {name:'Rose lounge',tag:'Warm, mellow, unhurried',colors:['#fa7d9b','#c787ed'],states:[rgb('#ff906e',40),rgb('#fa658c',55),rgb('#a26ce6',45),white(2700,25)]},
 {name:'Goodnight',tag:'Just a little amber',colors:['#a06739','#362637'],states:[white(2200,10),{state:false},{state:false},{state:false}]}
];
for(const mood of moods){const button=document.createElement('button');button.className='mood';button.style.setProperty('--mood-a',mood.colors[0]);button.style.setProperty('--mood-b',mood.colors[1]);const title=document.createElement('strong');title.textContent=mood.name;const sub=document.createElement('small');sub.textContent=mood.tag;button.append(title,sub);button.onclick=()=>sendStates(mood.states.map((s,i)=>[i,s]),mood.name);$('#moods').append(button);}
function cleanState(s){if(!s.state)return {state:false};const dimming=Math.max(1,Math.min(100,Math.round(s.dimming||50)));if(s.temp)return white(Math.max(2200,Math.min(6500,s.temp)),dimming);if(Number.isFinite(s.r))return {state:true,dimming,r:s.r,g:s.g||0,b:s.b||0,w:0,c:0};return white(2700,dimming);}
function saveLocal(){try{localStorage.setItem('wiz-studio-looks',JSON.stringify(savedLooks));return true;}catch{notify('Browser storage unavailable; look kept for this session.',true);return false;}}
function renderLooks(){const list=$('#saved-looks');list.replaceChildren();if(!savedLooks.length){const empty=document.createElement('p');empty.textContent='Your next favorite atmosphere starts here.';list.append(empty);}
 savedLooks.forEach((look,index)=>{const row=document.createElement('div');row.className='saved-look';const run=document.createElement('button');run.textContent='◈ '+look.name;run.onclick=()=>sendStates(look.states.map((s,i)=>[i,cleanState(s)]),look.name);const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','Delete '+look.name);remove.onclick=()=>{savedLooks.splice(index,1);saveLocal();renderLooks();};row.append(run,remove);list.append(row);});}
$('#save-look').onsubmit=e=>{e.preventDefault();if(sending)return;const name=$('#look-name').value.trim();if(!name)return;
 if(!preview && (!reachable || fixtures.some(f=>!bulb(f)?.online || bulb(f)?.stale))){notify('Connect all four fixtures before saving a live look.',true);return;}
 savedLooks.push({name,states:fixtures.map(f=>cleanState(stateFor(f)))});const persisted=saveLocal();renderLooks();$('#look-name').value='';if(persisted)notify('Look saved in this browser');};
renderLooks();

function buildRoom(){
  const viewport=$('#viewport'),renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  viewport.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-label','3D bedroom; drag to rotate and scroll to zoom. Use fixture buttons to select lights.');
  const scene=new THREE.Scene();scene.background=new THREE.Color('#151c22');
  const camera=new THREE.PerspectiveCamera(39,1,.05,50);camera.position.set(-4.4,4.4,5.3);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,.65,0);orbit.enableDamping=true;orbit.minDistance=3;orbit.maxDistance=11;orbit.maxPolarAngle=Math.PI*.48;orbit.enablePan=false;
  ambientLight=new THREE.HemisphereLight('#dce8ff','#5c6857',.42);scene.add(ambientLight);
  const sun=new THREE.DirectionalLight('#fff1d8',.35);daylight=sun;sun.position.set(-3,6,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.normalBias=.025;scene.add(sun);
  const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,...extra});
  const wood=mat('#754c31'),dark=mat('#282b27'),cream=mat('#d5cbb2'),sage=mat('#9da996'),tile=mat('#b9b5a3'),oak=mat('#b39b75');
  function mesh(geometry,material,x,y,z,parent=scene){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  const box=(x,y,z,w,h,d,material,parent)=>mesh(new THREE.BoxGeometry(w,h,d),material,x,y,z,parent);
  const cylinder=(x,y,z,rt,rb,h,material,parent)=>mesh(new THREE.CylinderGeometry(rt,rb,h,24),material,x,y,z,parent);
  // Dimensions in metres: 10 ft × 11 ft. Back wall contains the window and headboard.
  box(0,-.10,0,3.15,.18,3.45,mat('#454c40'));
  box(0,0,0,3.05,.03,3.35,tile);
  for(let x=-1.525;x<1.53;x+=.50)box(x,.018,0,.006,.003,3.35,mat('#8f917f'));
  for(let z=-1.675;z<1.68;z+=.50)box(0,.018,z,3.05,.003,.006,mat('#8f917f'));
  const walls=[];
  const back=new THREE.Group();scene.add(back);walls.push({group:back,side:'back'});
  box(0,1.28,-1.72,3.15,2.56,.08,cream,back);box(0,.08,-1.66,3.05,.13,.035,oak,back);
  const right=new THREE.Group();scene.add(right);walls.push({group:right,side:'right'});
  box(1.57,1.28,0,.08,2.56,3.35,cream,right);
  // Cutaway left wall exposes two door positions, as seen in the photos.
  box(-1.57,.16,0,.08,.32,3.35,cream);
  for(const z of [.55,1.28]){box(-1.51,.035,z,.03,.012,.62,wood);box(-1.48,.14,z-.32,.055,.27,.035,oak);box(-1.48,.14,z+.32,.055,.27,.035,oak);}
  // Window, pleated blue curtains and wall fitting.
  box(-.25,1.25,-1.66,1.78,1.7,.045,mat('#dad7c9'),back);
  for(let i=0;i<32;i++) {const c=box(-1.1+i*.054,1.14,-1.60+Math.sin(i)*.025,.058,1.79,.055,mat(i%3?'#294b6a':'#557283'),back);c.castShadow=false;}
  box(-.24,2.08,-1.55,1.92,.025,.025,dark,back);
  box(-.1,2.1,-1.62,.69,.12,.04,mat('#b4b1a3'),back);
  // King mattress 1.83 × 1.98 m, carved wooden headboard, pillows and coverlet.
  box(-.22,.20,-.57,1.91,.38,2.10,wood);box(-.22,.43,-.57,1.83,.20,1.98,sage);
  box(-.22,.68,-1.58,1.99,.90,.10,wood);
  for(let row=0;row<3;row++)for(let col=0;col<10;col++)box(-1.09+col*.191,.50+row*.20,-1.514,.085,.095,.018,mat('#ab8450'));
  box(-.72,.565,-1.20,.61,.10,.36,mat('#ece4d0'));box(.24,.565,-1.20,.61,.10,.36,mat('#d4cfcc'));
  box(-.22,.55,-.12,1.84,.025,.70,mat('#72877c'));
  for(let i=0;i<13;i++)box(-1.10+i*.144,.548,-.63,.008,.005,.63,mat('#c4cdbb'));
  // Small dark table left of bed, near floor lamp.
  box(-1.29,.65,-.78,.40,.06,.73,wood);
  for(const x of [-1.44,-1.14])for(const z of [-1.07,-.49])box(x,.31,z,.035,.62,.035,dark);
  // Desk nook in the back-right corner; Mac, chair and wall shelves.
  box(1.22,.73,-1.17,.52,.055,.92,oak);
  for(const z of [-1.56,-.78])box(1.35,.36,z,.035,.72,.035,dark);
  box(1.15,.77,-1.02,.28,.025,.23,mat('#414947'));
  box(1.15,.87,-1.13,.28,.19,.016,mat('#1d292e'));
  box(1.15,.875,-1.118,.25,.16,.008,mat('#416e78',{emissive:'#274655',emissiveIntensity:.3}));
  box(1.10,.43,-.48,.34,.09,.36,dark);box(1.10,.70,-.31,.34,.49,.065,dark);cylinder(1.1,.20,-.48,.025,.025,.4,dark);
  box(1.26,1.75,-1.54,.45,.035,.23,wood);box(1.25,2.33,-1.33,.52,.43,.62,oak,right);
  // Wardrobe extends along the right wall, mirror and drawers facing into room.
  box(1.30,1.12,.58,.44,2.24,2.04,oak,right);
  for(const z of [-.37,.08,.53,.98,1.43])box(1.07,1.11,z,.012,2.10,.012,wood,right);
  box(1.066,1.31,.58,.016,1.38,.42,mat('#abc0b9',{metalness:.72,roughness:.24}),right);
  box(1.055,.37,.58,.025,.31,.43,wood,right);
  for(const z of [-.15,1.13])box(1.04,1.10,z,.035,.21,.017,dark,right);
  // Ottoman against the wall beyond the foot of the bed.
  box(-.45,.23,1.38,.72,.43,.42,mat('#8e9180'));box(-.45,.455,1.38,.74,.04,.44,mat('#cbc3ac'));
  // Ceiling fan is represented above the room; it is decorative, not a control.
  const fanMat=mat('#777e70',{transparent:true,opacity:.38});cylinder(-.2,2.35,-.15,.10,.10,.10,fanMat);
  for(let i=0;i<3;i++){const blade=box(-.2,2.39,-.15,.10,.025,.83,fanMat);blade.geometry.translate(0,0,.27);blade.rotation.y=i*Math.PI*2/3;}
  // Four individually selectable light fixtures and physical point-light sources.
  const pickables=[];
  fixtures.forEach((f,index)=>{
    const [x,y,z]=f.p,shadeMat=mat('#eee4cb',{emissive:'#ffd5a1',emissiveIntensity:0,side:THREE.DoubleSide});
    if(index===0){
      cylinder(x,.68,z,.018,.018,1.28,dark);
      for(let j=0;j<3;j++){const leg=cylinder(x,.37,z,.015,.015,.80,wood);leg.rotation.z=.20*Math.cos(j*2.094);leg.rotation.x=.20*Math.sin(j*2.094);}
      f.shade=mesh(new THREE.CylinderGeometry(.14,.20,.30,32,1,true),shadeMat,x,y,z);
    }else if(index===3){cylinder(x,1.03,z,.018,.018,.35,dark);cylinder(x,.84,z,.10,.10,.02,dark);f.shade=mesh(new THREE.CylinderGeometry(.09,.12,.29,32,1,true),shadeMat,x,y,z);}
    else{f.shade=mesh(new THREE.CapsuleGeometry(.047,.14,6,12),shadeMat,x,y,z);cylinder(x,y-.13,z,.035,.035,.08,dark);}
    f.shade.userData.fixture=index;pickables.push(f.shade);
    f.light=new THREE.PointLight('#ffe1b5',0,4,2);f.light.position.set(x,y,z+.07);scene.add(f.light);
    f.anchor=new THREE.Vector3(x,y+.2,z);
    f.halo=mesh(new THREE.TorusGeometry(.23,.006,8,48),new THREE.MeshBasicMaterial({color:'#d7edb1',transparent:true,opacity:.8}),x,y,z);f.halo.rotation.x=Math.PI/2;f.halo.visible=index===selected;
  });
  // Pointer motion rotates the camera; a short click on a fixture selects it.
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!down || Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects(pickables)[0];if(hit)select(hit.object.userData.fixture);
  });
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{const presets={room:[-4.4,4.4,5.3],top:[0,7,.01],bed:[0,2.5,4.5]};camera.position.set(...presets[b.dataset.view]);orbit.target.set(0,.65,0);orbit.update();});
  const resize=new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});resize.observe(viewport);
  $('#loading').remove();
  renderer.setAnimationLoop(()=>{
    if(document.hidden)return;
    orbit.update();
    // Hide walls facing the camera for a dollhouse cutaway, retaining the interior when behind it.
    back.visible=camera.position.z>-.8;right.visible=camera.position.x<.8;
    fixtures.forEach((f,i)=>{const p=f.anchor.clone().project(camera);const offset=i===1?-45:i===2?45:0;f.marker.style.display=labels&&p.z<1&&p.z>-1?'flex':'none';f.marker.style.left=((p.x+1)*viewport.clientWidth/2+offset)+'px';f.marker.style.top=((-p.y+1)*viewport.clientHeight/2)+'px';});
    renderer.render(scene,camera);
  });
  renderState();
}
try{buildRoom();}catch(e){$('#loading').textContent='3D rendering is unavailable. You can still control each light with the fixture buttons below.';notify('Could not start the 3D view: '+e.message,true);}
try{token=(await api('session')).token;}catch{notify('Start the WiZ server to connect your bulbs.',true);}
await refresh();
async function poll(){if(!sending)await refresh();setTimeout(poll,3000);}setTimeout(poll,3000);
