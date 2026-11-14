// No room writes: all control APIs are intercepted.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/api/state')return route.fulfill({json:{lights:Array.from({length:4},(_,i)=>({id:`light${i}`,name:`Light ${i+1}`,online:true,state:{state:true,dimming:50,r:80,g:80,b:120}})),screen_order:['light0','light1','light2','light3'],scenes:[{id:'saved1',name:'My scene'}]}});
  if(p==='/api/session')return route.fulfill({json:{token:'test'}});
  if(p==='/api/control'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.ids.map(id=>({id,ok:true}))}});}
  return route.fulfill({json:{ok:true,results:[]}});
 });
 try{
  await page.goto('http://127.0.0.1:8765/');
  assert.equal(await page.locator('#music-sync').isVisible(),false,'Home must not contain music controls');
  assert.equal(await page.locator('#lights').isVisible(),true);
  await page.getByRole('link',{name:'Scenes',exact:true}).click();
  await page.locator('#scenes').waitFor({state:'visible'});
  assert.equal(await page.locator('#lights').isVisible(),false);
  assert.equal(await page.locator('#looks').isVisible(),true);
  assert.ok(await page.locator('[data-preset]').count()>=18);
  await page.getByRole('button',{name:'Cinema',exact:true}).click();
  assert.equal(await page.locator('[data-preset="deep-space"]').isVisible(),true);
  assert.equal(await page.locator('[data-preset="focus"]').isVisible(),false);
  await page.locator('[data-preset="deep-space"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('applied'));
  assert.equal(writes.length,4);assert.equal(new Set(writes.map(x=>`${x.params.r},${x.params.g},${x.params.b}`)).size,4,'Scene composes four different colours');
  assert.ok(writes.every(x=>x.params.w===0&&x.params.c===0&&x.params.dimming>=10));
  for(const [name,id] of [['Music','music-sync'],['Screen Sync','screen-sync'],['Hand Control','hand-control'],['Patterns','patterns']]){
   await page.getByRole('link',{name,exact:true}).click();
   await page.locator(`#${id}`).waitFor({state:'visible'});
   assert.equal(await page.locator(`#${id}`).isVisible(),true);
   assert.equal(await page.locator('[data-view]:visible').count(),1);
   assert.equal(await page.locator('aside a[aria-current="page"]').count(),1);
  }
  await page.goBack();await page.locator('#hand-control').waitFor({state:'visible'});assert.equal(await page.locator('#hand-control').isVisible(),true);
  await page.goto('http://127.0.0.1:8765/#music-sync');assert.equal(await page.locator('#music-sync').isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'Scenes',exact:true}).click();
  await page.locator('#scenes').waitFor({state:'visible'});
  assert.equal(await page.locator('#looks').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile tabs must not overflow');
  await page.screenshot({path:__dirname+'/studio-scenes-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:950});await page.getByRole('button',{name:'All',exact:true}).click();
  await page.screenshot({path:__dirname+'/studio-scenes.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: isolated tabs, deep links, back navigation, scene filters, four-light palettes, desktop/mobile layout. Zero hardware writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
