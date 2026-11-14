/* Curated, static per-light palettes. Safe to preview without sending commands. */
window.StudioScenes = [
  {id:'sunset',name:'Golden hour',group:'Relax',note:'Soft amber',dimming:45,colors:['#ff8b31','#ffa64e','#ee653a','#ffd08b']},
  {id:'lavender',name:'After hours',group:'Party',note:'Electric violet',dimming:35,colors:['#9b4aff','#c747ed','#6545e0','#de63b6']},
  {id:'ocean',name:'Deep blue',group:'Relax',note:'Ocean colour',dimming:40,colors:['#207fff','#1972c9','#389ec5','#345bd0']},
  {id:'focus',name:'Clear mind',group:'Focus',note:'Cool white · 4500 K',dimming:85,temp:4500,preview:['#e9f2ff','#e9f2ff','#e9f2ff','#e9f2ff']},
  {id:'moonlit',name:'Moonlit sage',group:'Relax',note:'Blue-green hush',dimming:18,colors:['#9ab3b0','#7195a5','#506a7a','#7d929e']},
  {id:'ember',name:'Ember rain',group:'Relax',note:'Red-gold warmth',dimming:24,colors:['#ff7b4f','#d86b45','#8e3d3d','#b94d2e']},
  {id:'aurora',name:'Aurora hush',group:'Relax',note:'Mint and lilac',dimming:26,colors:['#9dd9c3','#9fa9e7','#c28dc7','#65ada7']},
  {id:'rosewood',name:'Rosewood dusk',group:'Relax',note:'Plum and rose',dimming:22,colors:['#bc637c','#75415e','#342943','#a15366']},
  {id:'moss',name:'Deep moss',group:'Relax',note:'Forest green',dimming:16,colors:['#829c65','#4d674d','#263d39','#60795a']},
  {id:'twilight',name:'Twilight teal',group:'Relax',note:'Teal and indigo',dimming:30,colors:['#36a9a1','#4f70bd','#6f4e9d','#398593']},
  {id:'deep-space',name:'Deep Space',group:'Cinema',note:'Indigo, violet and starlight',dimming:18,colors:['#17256f','#6731b5','#233e9c','#967bcc']},
  {id:'mars-sunset',name:'Mars Sunset',group:'Cinema',note:'Rust, copper and warm gold',dimming:30,colors:['#e54b26','#fc9c46','#a72e38','#ffc16d']},
  {id:'movie-night',name:'Movie Night',group:'Cinema',note:'Low amber with a blue edge',dimming:12,colors:['#ff9c4c','#c36c38','#254381','#4d6589']},
  {id:'cyberpunk',name:'Cyberpunk',group:'Party',note:'Neon pink meets cyan',dimming:55,colors:['#ff198d','#00d4e8','#6b2dff','#ff4fc4']},
  {id:'rainforest',name:'Rainforest',group:'Relax',note:'Emerald, jade and teal',dimming:28,colors:['#1e9e65','#57b888','#137d83','#8cbd63']},
  {id:'candlelight',name:'Candlelight',group:'Relax',note:'A steady, warm room glow',dimming:15,colors:['#ff8b24','#f5b05b','#db6823','#ffc681']},
  {id:'reading',name:'Reading Room',group:'Focus',note:'Comfortable warm white · 3200 K',dimming:70,temp:3200,preview:['#ffe0ae','#ffe0ae','#ffe0ae','#ffe0ae']},
  {id:'sunrise',name:'Soft Sunrise',group:'Focus',note:'Peach, apricot and pale gold',dimming:55,colors:['#ffad93','#ffca8b','#ffe0ad','#ef9d95']}
];
const sceneGrid=document.querySelector('#scene-library');
sceneGrid.innerHTML=StudioScenes.map((scene,index)=>{
  const colors=scene.colors||scene.preview;
  return `<button class="scene-card" data-preset="${scene.id}" data-group="${scene.group}" style="--scene-gradient:linear-gradient(125deg,${colors.join(',')})"><span class="scene-art" aria-hidden="true"></span><span class="scene-meta">${scene.group} <span>${String(index+1).padStart(2,'0')}</span></span><strong>${scene.name}</strong><small>${scene.note}</small><span class="scene-bottom"><span class="scene-swatches" aria-hidden="true">${colors.map(color=>`<i style="background:${color}"></i>`).join('')}</span><span>${scene.dimming}% brightness</span></span></button>`;
}).join('');
document.querySelectorAll('[data-scene-filter]').forEach(button=>button.onclick=()=>{
  const group=button.dataset.sceneFilter;
  document.querySelectorAll('[data-scene-filter]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  sceneGrid.querySelectorAll('[data-preset]').forEach(card=>card.hidden=group!=='All'&&card.dataset.group!==group);
});
