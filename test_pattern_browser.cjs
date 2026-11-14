const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),calls=[],errors=[];
 let pattern={running:false};page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/api/state')return route.fulfill({json:{lights:Array.from({length:4},(_,i)=>({id:`l${i}`,name:['Left','Mid left','Mid right','Right'][i],online:true,state:{state:true,dimming:30,temp:2700}})),screen_order:['l0','l1','l2','l3'],scenes:[],pattern}});
  if(p==='/api/session')return route.fulfill({json:{token:'test'}});
  const body=route.request().postDataJSON();calls.push([p,body]);
  if(p==='/api/pattern/start')pattern={running:true,mode:body.mode,name:'Travelling Gradient',...body.options};
  if(p==='/api/pattern/stop')pattern={running:false};
  return route.fulfill({json:{ok:true}});
 });
 try{
  await page.goto('http://127.0.0.1:8765/#patterns');
  assert.ok(await page.locator('#thunder-mode option').count()>=10,'New animations must be selectable');
  await page.waitForFunction(()=>document.querySelectorAll('#pattern-preview .motion-bulb').length===4);
  await page.locator('#pattern-speed').evaluate(el=>{el.value=80;el.dispatchEvent(new Event('input'));});
  await page.locator('#pattern-brightness').evaluate(el=>{el.value=45;el.dispatchEvent(new Event('input'));});
  await page.locator('#pattern-direction').selectOption('reverse');
  await page.locator('#pattern-palette').selectOption('ocean');
  await page.locator('#start-thunder').click();
  await page.waitForFunction(()=>document.querySelector('#stop-thunder').disabled===false);
  const request=calls.find(([p])=>p==='/api/pattern/start')[1];
  assert.deepEqual(request,{ids:['l0','l1','l2','l3'],mode:'gradient',options:{speed:80,brightness:45,reverse:true,palette:'ocean'}});
  await page.locator('#thunder-mode').selectOption('strobe');
  assert.match(await page.locator('#thunder-description').textContent(),/flash/i);
  await page.locator('#start-thunder').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Strobe'));
  assert.equal(calls.filter(([p])=>p==='/api/pattern/start').at(-1)[1].mode,'strobe');
  await page.locator('#stop-thunder').click();await page.waitForFunction(()=>document.querySelector('#stop-thunder').disabled);
  const after=calls.length;await page.waitForTimeout(300);assert.equal(calls.length,after,'Previews send no control commands');
  await page.locator('#thunder-mode').selectOption('comet');
  await page.waitForTimeout(150);
  const previewBefore=await page.locator('.motion-bulb').evaluateAll(items=>items.map(item=>item.style.background));
  await page.waitForTimeout(1100);
  const previewAfter=await page.locator('.motion-bulb').evaluateAll(items=>items.map(item=>item.style.background));
  assert.notDeepEqual(previewAfter,previewBefore,'Comet preview must move');
  assert.equal(calls.length,after,'Moving preview never writes to bulbs');
  await page.screenshot({path:__dirname+'/patterns-motion.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('PASS: animation controls, ordered start options, mode change, Stop, preview-only rendering, mobile layout. No physical light writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
