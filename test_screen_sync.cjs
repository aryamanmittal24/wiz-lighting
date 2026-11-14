const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/web/app.js`, 'utf8');
const calls = [];
const context = vm.createContext({
  syncActive: true, screenVideo: {readyState: 2, videoWidth: 32, videoHeight: 32},
  screenCanvas: {}, screenCtx: {drawImage(){}, getImageData(){return {data: context.pixels}}},
  pixels: [0, 0, 0, 255], selected: new Set(['bulb']),
  data: {lights: [{id: 'bulb'}]}, orderedSelectedIds: () => ['bulb'],
  screenPoints: [{x: .5, y: .5}], defaultScreenPoints: [], lastScreenColors: [],
  document: {querySelector: () => null}, $: () => ({value: 85}),
  api: (path, body) => {calls.push(body); return Promise.resolve({results: []})},
  toast: message => {throw Error(message)},
});
for (const name of ['sampleScreenPoint', 'vividColor', 'isScreenBlack', 'colorsChanged', 'sendScreenColors']) {
  vm.runInContext(source.split('\n').find(line => line.startsWith(`function ${name}(`)), context);
}
context.sendScreenColors();
assert.equal(calls.at(-1).params.state, false, 'First black frame must turn an already-on bulb off');
context.pixels = [255, 0, 0, 255];
context.sendScreenColors();
assert.equal(calls.at(-1).params.state, true, 'Color must wake the bulb');
assert.equal(calls.at(-1).params.r, 255);
context.pixels = [0, 0, 0, 255];
context.sendScreenColors();
assert.equal(calls.at(-1).params.state, false, 'Returning to black must switch off');
context.lastScreenColors = [[9, 9, 9]];
assert.equal(context.colorsChanged([[8, 8, 8]]), true, 'Off threshold must bypass small-color-change filtering');
context.pixels = [15, 0, 0, 255];
context.sendScreenColors();
assert.equal(calls.at(-1).params.g, 0, 'Dark red must stay red, not become white');
assert.ok(calls.at(-1).params.dimming < 8, 'Dark samples must dim below the old brightness floor');
context.pixels = [0, 0, 0, 255, 100, 100, 100, 255];
assert.equal(context.sampleScreenPoint({x: .5, y: .5})[0], 50, 'Black pixels must contribute to sample brightness');
console.log('Screen sync regression checks passed');
