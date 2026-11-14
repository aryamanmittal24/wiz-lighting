/* Local visual preview only. Physical animations run independently on the server. */
const motionModes={
 gradient:{name:'Travelling Gradient',description:'A continuous ribbon of colour travels across your lights. Each bulb holds a different part of the gradient.'},
 chase:{name:'Light Chase',description:'One bright point runs across the room, with a dim background to make the movement stand out.'},
 bounce:{name:'Bounce Scanner',description:'A bright beam sweeps to the far side, then bounces back through the room.'},
 comet:{name:'Comet Trail',description:'A bright head moves through the lights and leaves a soft, fading colour trail behind it.'},
 'aurora-flow':{name:'Aurora Flow',description:'Slow green, cyan and blue waves drift through the room, with brightness rippling between lights.'},
 breathe:{name:'Room Breathing',description:'The whole room gently brightens and dims together while the colours slowly drift.'},
 strobe:{name:'Room Strobe',description:'All lights flash together. Speed ranges from 0.75 to 3 flashes per second; physical timing varies.'},
 alternating:{name:'Alternating Strobe',description:'Alternate lights trade places between bright and dark, creating a marching flash across the room.'},
 classic:{name:'Thunder Classic',description:'One random light strikes white, followed by a quick fade. Original thunder timing is preserved.'},
 storm:{name:'Thunderstorm',description:'Two random lights strike together at different brightness levels, then fade quickly.'}
};
function motionOptions(){return{speed:Number($('#pattern-speed').value),brightness:Number($('#pattern-brightness').value),reverse:$('#pattern-direction').value==='reverse',palette:$('#pattern-palette').value};}
function paintPatternState(){
 const running=!!data.pattern?.running;
 $('#start-thunder').disabled=false;$('#start-thunder').textContent=running?'Apply changes':'Start animation';
 $('#motion-apply-hint').textContent=running?'Changes affect the preview. Apply changes to restart the lights with these settings.':'Preview first, then start. Runs until Stop, even if you close this page. Uses your saved light order.';
}
let motionPreviewStarted=performance.now(),motionPreviewOrder='',motionPreviewFrame=0,motionPreviewLast=0;
function motionChoiceChanged(){
 const mode=$('#thunder-mode').value,item=motionModes[mode];
 $('#motion-title').textContent=item.name;$('#motion-preview-label').textContent=item.name;
 $('#thunder-description').textContent=item.description;
 $('#motion-options').hidden=['classic','storm'].includes(mode);
 $('#pattern-speed-label').textContent=motionOptions().speed+'%';
 $('#pattern-brightness-label').textContent=motionOptions().brightness+'%';
 motionPreviewStarted=performance.now();
}
$('#thunder-mode').onchange=motionChoiceChanged;
for(const id of ['pattern-speed','pattern-brightness','pattern-palette','pattern-direction'])$('#'+id).oninput=motionChoiceChanged;
$('#start-thunder').onclick=()=>{
 stopLiveModes();
 const mode=$('#thunder-mode').value;
 return action(async()=>{await api('pattern/start',{ids:orderedSelectedIds(),mode,options:motionOptions()});toast(motionModes[mode].name+' started');});
};
$('#stop-thunder').onclick=()=>action(async()=>{await api('pattern/stop',{});toast('Animation stopped; previous look restored');});
function motionPreviewColor(phase,palette){
 phase=((phase%1)+1)%1;
 if(palette==='rainbow')return hsv(phase*360,.92,1);
 const palettes={neon:[[255,20,150],[20,210,255],[120,35,255],[255,70,200]],sunset:[[255,55,25],[255,175,45],[210,35,95],[255,110,55]],ocean:[[15,50,220],[10,190,230],[35,220,160],[70,65,240]]};
 const colors=palettes[palette],p=phase*4,k=Math.floor(p),mix=p-k;
 return colors[k].map((value,j)=>Math.round(value+(colors[(k+1)%4][j]-value)*mix));
}
function animateMotionPreview(now){
 motionPreviewFrame=requestAnimationFrame(animateMotionPreview);
 if($('#patterns').hidden||document.hidden||now-motionPreviewLast<80)return;
 motionPreviewLast=now;
 const ids=activeLightIds(),order=ids.join(',');
 if(order!==motionPreviewOrder||!$('#pattern-preview').children.length){
  motionPreviewOrder=order;
  $('#pattern-preview').replaceChildren(...(ids.length?ids:['preview0','preview1','preview2','preview3']).map((id,i)=>{
   const item=document.createElement('div');item.className='motion-light';const bulb=document.createElement('i');bulb.className='motion-bulb';
   const label=document.createElement('span');label.textContent=data.lights.find(light=>light.id===id)?.name||`Light ${i+1}`;
   item.append(bulb,label);return item;
  }));
 }
 const bulbs=[...document.querySelectorAll('.motion-bulb')],count=bulbs.length;
 const {speed,brightness,reverse,palette}=motionOptions(),mode=$('#thunder-mode').value,t=(now-motionPreviewStarted)/1000,phase=t*(.2+speed/100*1.8);
 // Honour reduced motion for preview; physical effects start only on explicit click.
 const frozen=matchMedia('(prefers-reduced-motion: reduce)').matches,p=frozen?0:phase;
 bulbs.forEach((bulb,index)=>{
  const i=reverse?count-1-index:index;let level=1,colorPhase=i/count-p*.12;
  if(mode==='chase'||mode==='comet'){
   const distance=((p%count-i)%count+count)%count;
   level=mode==='chase'?.025+.975*Math.max(0,1-Math.min(distance,count-distance))**2:.025+.975*Math.exp(-distance*1.8);colorPhase=p*.07+i/count*.16;
  }else if(mode==='bounce'){
   const pos=p%(2*Math.max(1,count-1)),head=pos<count-1?pos:2*(count-1)-pos;
   level=.025+.975*Math.exp(-(((i-head)/.6)**2));colorPhase=.5+p*.025;
  }else if(mode==='aurora-flow'){colorPhase=.35+.25*Math.sin(p*.3-i*.5);level=.35+.65*(.5+.5*Math.sin(p*.8-i*.9));}
  else if(mode==='breathe'){level=.08+.92*(.5-.5*Math.cos(p*Math.PI*2*.18));colorPhase=p*.025+i/count*.12;}
  else if(mode==='strobe'||mode==='alternating'){
   // Preview flashes capped at 1 Hz; room strobe timing follows selected speed.
   const flash=frozen?0:t*Math.min(1,.5+speed/100*2.5)%1;
   level=mode==='strobe'?(flash<.38?1:0):((i%2===0)===(flash<.5)?1:0);colorPhase=mode==='strobe'?p*.04:i/count;
  }else if(mode==='classic'||mode==='storm'){const head=Math.floor(frozen?0:t)%count;level=i===head||(mode==='storm'&&i===(head+1)%count)?1:0;}
  const color=['classic','storm'].includes(mode)?[235,245,255]:motionPreviewColor(colorPhase,palette),strength=Math.max(.035,level*brightness/100);
  bulb.style.background=`rgb(${color.map(v=>Math.round(v*strength)).join(',')})`;
  bulb.style.boxShadow=`0 0 ${10+45*strength}px ${4+12*strength}px rgba(${color.join(',')},${strength*.4})`;
 });
}
motionChoiceChanged();paintPatternState();motionPreviewFrame=requestAnimationFrame(animateMotionPreview);
window.addEventListener('pagehide',()=>cancelAnimationFrame(motionPreviewFrame));
window.addEventListener('pageshow',()=>{cancelAnimationFrame(motionPreviewFrame);motionPreviewFrame=requestAnimationFrame(animateMotionPreview);});
