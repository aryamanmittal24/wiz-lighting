// Browser integration: real decode, librosa analysis and AudioContext;
// light endpoints intercepted so this test never controls room hardware.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const file=path.join(os.tmpdir(),`wiz-track-test-${process.pid}.wav`);
 const rate=22050,seconds=14,pcm=Buffer.alloc(rate*seconds*2),wav=Buffer.alloc(44+pcm.length);
 for(let i=0;i<rate*seconds;i++){
  const t=i/rate,p=(t-.5+.5)%.5;
  const sample=t>=.5&&p<.12?.7*Math.sin(2*Math.PI*(70*p-90*p*p))*Math.exp(-p*45):0;
  pcm.writeInt16LE(Math.round(sample*32767),i*2);
 }
 wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);fs.writeFileSync(file,wav);
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
 const page=await browser.newPage({viewport:{width:1280,height:1100}}),errors=[],frames=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/session'||url.pathname==='/api/music/analyze')return route.continue();
  if(url.pathname==='/api/state')return route.fulfill({json:{lights:[{id:'test',name:'Test light',online:true,state:{state:true,dimming:50,r:50,g:80,b:120}}],screen_order:['test'],scenes:[]}});
  if(url.pathname==='/api/music/start')return route.fulfill({json:{session:'test-session'}});
  if(url.pathname==='/api/music/frame'){frames.push(route.request().postDataJSON());return route.fulfill({json:{sent:1}});}
  return route.fulfill({json:{ok:true}});
 });
 try{
  await page.goto('http://127.0.0.1:8765/#music-sync');
  await page.locator('#track-file').setInputFiles(file);
  await page.waitForFunction(()=>!document.querySelector('#track-play').disabled,{},{timeout:180000});
  assert.match(await page.locator('#track-status').innerText(),/120 BPM/);
  await page.locator('#track-play').click();
  await page.waitForFunction(()=>document.querySelector('#music-status').textContent==='Scheduled track sync');
  await page.waitForTimeout(2000);assert.ok(frames.length>=3,'Scheduled lights must dispatch');
  assert.ok(frames.some(f=>f.frames[0].params.state===true),'Attack turns on');
  assert.ok(frames.some(f=>f.frames[0].params.state===false),'Release turns off');
  await page.locator('#track-pause').click();await page.waitForTimeout(150);const stopped=frames.length;
  await page.waitForTimeout(500);assert.equal(frames.length,stopped,'Pause cancels queued light frames');
  await page.locator('#track-position').evaluate(el=>{el.value=8;el.dispatchEvent(new Event('change'));});
  assert.match(await page.locator('#track-time').innerText(),/0:08/);
  await page.locator('#track-play').click();await page.waitForTimeout(700);
  await page.locator('#music-mode').selectOption('spectrum');await page.waitForTimeout(300);
  await page.locator('#music-source').selectOption('live');await page.waitForTimeout(150);const switched=frames.length;
  await page.waitForTimeout(400);assert.equal(frames.length,switched,'Source switch cancels track sync');
  assert.equal(await page.locator('#live-music-help').isVisible(),true);
  assert.equal(await page.locator('#music-start').isVisible(),true);
  assert.equal(await page.locator('#track-panel').isVisible(),false);
  await page.locator('#music-source').selectOption('track');
  await page.locator('#track-position').evaluate(el=>{el.value=13.3;el.dispatchEvent(new Event('change'));});
  await page.locator('#track-play').click();
  await page.waitForFunction(()=>document.querySelector('#track-status').textContent.includes('finished'),{},{timeout:6000});
  assert.match(await page.locator('#track-time').innerText(),/0:00/,'Track completion resets position');
  await page.waitForTimeout(150);const finished=frames.length;await page.waitForTimeout(300);
  assert.equal(frames.length,finished,'No light frames after end');
  await page.locator('#music-sync').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'music-track-sync.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No mobile overflow');
  assert.deepEqual(errors,[]);console.log(`PASS: real song analysis, play/pause/seek/mode/source cancellation, responsive layout; ${frames.length} intercepted frames, zero hardware commands.`);
 }finally{await browser.close();fs.unlinkSync(file);}
})().catch(error=>{console.error(error);process.exitCode=1;});
