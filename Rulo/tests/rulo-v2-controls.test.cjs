const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function engineHarness(enabled = false) {
  const sandbox = { module: {exports:{}}, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'animation-engine.cjs'), 'utf8'), sandbox);
  const clips = [
    ['idle','Idle','Idle_Base','Idle_Base','behavior',true],
    ['idle2','Idle','Idle_Base','Idle_Base','behavior',true],
    ['enter','Idle','Oculto','Idle_Base','entry',false],
    ['sleepIn','Dormir','Idle_Base','Dormido','transition',false],
    ['snore','Dormir','Dormido','Dormido','behavior',true],
    ['wake','Dormir','Dormido','Idle_Base','transition',false],
    ['hide','Especiales','Idle_Base','Oculto','exit',false],
    ['sleepHide','Dormir','Dormido','Oculto','exit',false]
  ];
  const animations = Object.fromEntries(clips.map(([id,family,from,to,role,loop]) => [id,
    {id,family,from,to,role,loop,enabled:true,interruptible:false,weight:50,priority:1,file:id+'.webm',media:{duration:10}}]));
  const manifest = { animations, fallback:'idle', behavior:{recentCount:3,queueLimit:30,idleMinMinutes:4,idleMaxMinutes:6} };
  const client = {readyState:1}, packets=[];
  const engine = sandbox.module.exports.createAnimationEngine({library:{read:()=>manifest,publicManifest:()=>manifest},enabled,emit:(_,p)=>packets.push(JSON.parse(JSON.stringify(p)))});
  engine.clientReady(client);
  const end = () => { const c=engine.inspect().current; assert.ok(c); assert.equal(c.loop,false); engine.message(client,{type:'rulo_v2_ended',token:c.token}); };
  const start = () => {engine.setEnabled(true);assert.equal(engine.inspect().current.id,'enter');end();};
  const sleep = () => {engine.request('dormir');end();assert.equal(engine.inspect().current.id,'sleepIn');end();assert.equal(engine.inspect().current.id,'snore');assert.equal(engine.inspect().current.loop,true);};
  return {engine,client,packets,end,start,sleep};
}

test('encendido usa entrada; Dormir termina entrada y mantiene ronquidos; normal despierta y continúa Idle', () => {
  const h=engineHarness();h.start();h.sleep();
  h.engine.request('normal');h.end();assert.equal(h.engine.inspect().current.id,'wake');
  h.end();assert.equal(h.engine.inspect().current.family,'Idle');
  h.end();assert.equal(h.engine.inspect().current.family,'Idle');
});
test('primera conexión usa la entrada registrada', () => {
  const h=engineHarness(true);assert.equal(h.engine.inspect().current.id,'enter');
});
test('ocultar conserva habilitación, mostrar usa entrada y apagar reproduce salida', () => {
  const h=engineHarness();h.start();h.sleep();h.engine.request('ocultar');h.end();
  assert.equal(h.engine.inspect().current.id,'sleepHide');h.end();
  assert.equal(h.engine.status().enabled,true);assert.equal(h.engine.status().pose,'Oculto');
  h.engine.request('aparecer');assert.equal(h.engine.inspect().current.id,'enter');h.end();
  h.engine.setEnabled(false);h.end();assert.equal(h.engine.inspect().current.id,'hide');h.end();
  assert.equal(h.engine.status().enabled,false);assert.equal(h.engine.status().pose,'Oculto');
});
test('una acción durante la entrada a Dormir no queda atrapada en ronquidos infinitos', () => {
  const h=engineHarness();h.start();h.engine.request('dormir');h.end();
  h.engine.request('normal');h.end();assert.equal(h.engine.inspect().current.id,'snore');
  assert.equal(h.engine.inspect().current.loop,false);h.end();assert.equal(h.engine.inspect().current.id,'wake');
});
test('Habla sin clip propio despierta antes del respaldo y sincroniza el cartel después de la transición', () => {
  const h=engineHarness();h.start();h.sleep();h.engine.request('hablar',{triggerId:'reply'});h.end();
  assert.equal(h.engine.inspect().current.id,'wake');
  h.engine.message(h.client,{type:'rulo_v2_started',token:h.engine.inspect().current.token});
  assert.equal(h.packets.filter(p=>p.type==='rulo_animation_started').length,0);
  h.end();assert.equal(h.engine.inspect().current.id,'idle');
  h.engine.message(h.client,{type:'rulo_v2_started',token:h.engine.inspect().current.token});
  assert.equal(h.packets.filter(p=>p.type==='rulo_animation_started').length,1);
  h.end();h.end();assert.equal(h.engine.inspect().current.family,'Idle');
});

class Video {
  constructor(){this.dataset={};this.readyState=0;this.listeners=new Map();this.classList={add(){},remove(){}};this.paused=true;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  dispatch(name){for(const fn of [...(this.listeners.get(name)||[])])fn();}
  removeAttribute(name){if(name==='src'){this.src='';this.readyState=0;}}
  load(){} pause(){this.paused=true;} async play(){this.paused=false;}
  requestVideoFrameCallback(fn){this.frame=fn;}
}
function playerHarness(){
  const videos=[new Video(),new Video()], sockets=[];
  class Socket {static OPEN=1;constructor(){this.readyState=1;this.handlers={};this.sent=[];sockets.push(this);}addEventListener(n,fn){this.handlers[n]=fn;}send(s){this.sent.push(JSON.parse(s));}}
  const sandbox={document:{getElementById:id=>videos[id==='rulo-a'?0:1],documentElement:{dataset:{},style:{setProperty(){}}}},WebSocket:Socket,location:{protocol:'http:',host:'localhost'},window:{},setTimeout:()=>1,clearTimeout(){},setInterval(){},requestAnimationFrame:fn=>fn()};
  const script=fs.readFileSync(path.join(root,'rulo-animaciones.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script,sandbox);
  return {videos,socket:sockets[0],send:p=>sockets[0].handlers.message({data:JSON.stringify(p)})};
}
test('la precarga no sobrescribe la entrada que está cargando; el fin conserva su token',async()=>{
  const h=playerHarness(),a=h.videos[0],b=h.videos[1];
  h.send({type:'rulo_v2_play',token:7,clip:{url:'/entry.webm',family:'Idle',loop:false}});
  h.send({type:'rulo_v2_preload',clip:{url:'/idle.webm'}});
  assert.equal(a.src,'/entry.webm');assert.equal(a.dataset.token,'7');
  a.readyState=2;a.dispatch('loadeddata');await new Promise(setImmediate);a.frame();
  assert.equal(b.src,'/idle.webm');assert.equal(a.src,'/entry.webm');
  a.dispatch('ended');assert.ok(h.socket.sent.some(p=>p.type==='rulo_v2_ended'&&p.token===7));
  h.send({type:'rulo_v2_play',token:8,clip:{url:'/exit.webm',family:'Especiales',loop:false}});
  h.send({type:'rulo_v2_preload',clip:null});assert.equal(b.src,'/exit.webm');
  b.readyState=2;b.dispatch('loadeddata');await new Promise(setImmediate);b.frame();
  assert.equal(b.src,'/exit.webm');b.dispatch('ended');
  assert.ok(h.socket.sent.some(p=>p.type==='rulo_v2_ended'&&p.token===8));
});
