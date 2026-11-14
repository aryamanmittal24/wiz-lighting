/* Same-document views retain playback and capture state when moving between tabs. */
(function(){
  const views={lights:'Lights',scenes:'Scenes',music:'Music',screen:'Screen Sync',hands:'Hand Control',patterns:'Patterns'};
  const hashes={lights:'lights',scenes:'scenes',looks:'scenes','music-sync':'music','screen-sync':'screen','hand-control':'hands',patterns:'patterns'};
  function showView(){
    const view=hashes[location.hash.slice(1)]||'lights';
    document.querySelectorAll('[data-view]').forEach(panel=>panel.hidden=panel.dataset.view!==view);
    document.querySelectorAll('[data-tab]').forEach(link=>{
      const active=link.dataset.tab===view;link.classList.toggle('active',active);
      if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    document.querySelector('#view-title').textContent=views[view].toUpperCase();
    document.title=`${views[view]} · WiZ Studio`;
    window.scrollTo({top:0,behavior:'instant'});
  }
  window.addEventListener('hashchange',showView);showView();
})();
