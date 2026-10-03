const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(hiddenOnLoad=false) {
  let now = 0, id = 0;
  const timers = new Map(), sockets = [], sent = [];
  function makeVideo() {
    const handlers = {};
    const classes = new Set();
    return {
      currentTime: 0, duration: 44.7, readyState: 2, seeking: false, src: '', onerror: null, loop: false,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      pause() {}, play() { return { then(fn) { fn(); return { catch() {} }; }, catch() {} }; },
      requestVideoFrameCallback(fn) { fn(0, { mediaTime: this.currentTime }); },
      load() { this.currentTime = 0; this.onloadedmetadata?.(); },
      addEventListener(name, fn) { handlers[name] = fn; },
      dispatch(name) { handlers[name]?.(); }
    };
  }
  const players = [makeVideo(), makeVideo()];
  const context = {
    document: { getElementById: id => id === 'rulo-a' ? players[0] : id === 'rulo-b' ? players[1] : { classList: { add() {}, remove() {} } }, documentElement: { dataset: {} } },
    location: { protocol: 'http:', host: 'localhost:4000' }, window: {}, console, requestAnimationFrame: fn => fn(),
    localStorage: { getItem: () => hiddenOnLoad ? '1' : '0', setItem() {} },
    Date: { now: () => now }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    setTimeout(fn, ms) { timers.set(++id, { fn, due: now + ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
    WebSocket: class {
      static OPEN = 1;
      constructor() { this.events = {}; this.readyState = 1; sockets.push(this); }
      addEventListener(key, fn) { this.events[key] = fn; }
      send(data) { sent.push(JSON.parse(data)); }
    }
  };
  const html = fs.readFileSync(path.join(__dirname, '../rulo-animaciones.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const result = {
    get video() { return players.find(player => player.classList.contains('visible')) || players[0]; },
    get visible() { return players.filter(player => player.classList.contains('visible')); },
    players, sent,
    command: action => sockets.at(-1).events.message({ data: JSON.stringify({ type: 'rulo_animation_control', action }) }),
    message: data => sockets.at(-1).events.message({ data: JSON.stringify(data) }),
    frame(time) { const player = players.find(item => item.classList.contains('visible')); player.currentTime = time; player.dispatch('timeupdate'); },
    end() { players.find(item => item.classList.contains('visible'))?.dispatch('ended'); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, t]) => t.due <= end).sort((a,b) => a[1].due-b[1].due)[0];
        if (!entry) break;
        now = entry[1].due; timers.delete(entry[0]); entry[1].fn();
      }
      now = end;
    }
  };
  result.message({type:'rulo_mascota_state',enabled:true});
  result.end();
  return result;
}
test('sleep loops 9–28; a pending action waits for the end of the full video', () => {
  const s = setup(); s.command('dormir');
  assert.equal(s.video.currentTime, 0);
  s.frame(9); s.frame(28); assert.equal(s.video.currentTime, 9);
  s.frame(15); const sleeping = s.video.src;
  s.message({ type: 'rulo_animation_trigger', animation: 'hablando' });
  assert.equal(s.video.src, sleeping);
  s.frame(27.9); assert.equal(s.video.src, sleeping);
  s.frame(28); assert.equal(s.video.src, sleeping);
  assert.equal(s.video.currentTime, 28);
  s.frame(44.6); assert.equal(s.video.src, sleeping);
  s.end(); assert.match(s.video.src, /hablando.webm/);
});
test('an action during sleep intro waits for full video end; latest action wins', () => {
  const s = setup(); s.command('dormir'); s.frame(3);
  s.command('hablar'); s.command('aparecer');
  assert.match(s.video.src, /Durmiendo/);
  s.frame(28); assert.match(s.video.src, /Durmiendo/);
  s.end(); assert.match(s.video.src, /aparece/);
});
test('normal animations serialize without replacing an unfinished clip', () => {
  const s = setup(); s.command('aparecer'); const entrance = s.video.src;
  s.command('hablar'); assert.equal(s.video.src, entrance);
  s.end(); assert.match(s.video.src, /hablando/);
});
test('entrance transitions to normal looping state on end', () => {
  const s = setup(); s.command('aparecer');
  assert.match(s.video.src, /aparece/);
  s.end();
  assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  assert.equal(s.video.loop, true);
});
test('speaking transitions to normal looping state on end', () => {
  const s = setup(); s.command('aparecer'); s.end();
  assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  s.command('hablar');
  assert.match(s.video.src, /hablando/);
  s.end();
  assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  assert.equal(s.video.loop, true);
});
test('sleep follows five minutes of inactivity in normal state; live activity resets the deadline', () => {
  const s = setup(); s.command('aparecer'); s.end();
  s.advance(299000); assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  s.message({ type: 'rulo_animation_activity' });
  s.advance(299000); assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  s.advance(1000); assert.match(s.video.src, /Durmiendo/);
});
test('hidden Rulo neither auto sleeps nor reacts to old history', () => {
  const s = setup(); s.command('ocultar');
  s.message({type:'rulo_bot_message',rulo:{message:'old'}});
  s.advance(600000); assert.equal(s.visible.length, 0);
  s.command('aparecer'); s.end(); s.command('ocultar');
  const source = s.video.src;
  s.advance(600000); assert.equal(s.video.src, source);
});
test('power off plays the reverse farewell, then hides and blocks new actions', () => {
  const s = setup(); s.command('iniciar');
  s.message({type:'rulo_mascota_shutdown'});
  assert.match(s.video.src, /Start_Apareciendo/);
  s.end();
  assert.match(s.video.src, /Start_Desapareciendo/); assert.equal(s.visible.length, 1);
  s.message({type:'rulo_animation_trigger',animation:'hablando'});
  s.message({type:'rulo_animation_activity'}); s.command('iniciar');
  s.end(); assert.equal(s.visible.length, 0);
  assert.equal(s.sent.at(-1).type,'rulo_mascota_shutdown_complete');
  s.advance(1000000); assert.equal(s.visible.length, 0);
  s.message({type:'rulo_mascota_state',enabled:true});
  assert.match(s.video.src, /Start_Apareciendo/);
});

test('power off during sleep finishes the sleep video, then plays the farewell and hides', () => {
  const s=setup();s.command('dormir');s.frame(18);
  s.message({type:'rulo_mascota_shutdown'});
  s.frame(28);assert.match(s.video.src,/Rulo%20Durmiendo/);
  s.end();assert.match(s.video.src,/Start_Desapareciendo/);
  s.end();assert.equal(s.visible.length,0);
});

test('uninterrupted sleep exits after 12.5 minutes by default, finishes full video, then hides', () => {
  const s = setup(); s.command('dormir');
  s.advance(749999); s.frame(9); s.frame(28);
  assert.equal(s.video.currentTime, 9);
  s.advance(1); s.frame(28); assert.equal(s.video.currentTime, 28);
  assert.match(s.video.src, /Durmiendo/);
  s.end(); assert.match(s.video.src, /Start_Desapareciendo/);
  assert.equal(s.visible.length, 1);
  s.end(); assert.equal(s.visible.length, 0);
  s.advance(3600000); assert.equal(s.visible.length, 0);
  s.message({type:'rulo_mascota_state',enabled:true});
  assert.equal(s.visible.length, 0, 'reconnection must not wake hidden Rulo');
});

test('a music request after hiding enters before talking and keeps the reply trigger', () => {
  const s = setup(); s.command('ocultar');
  s.message({type:'rulo_animation_activity'});
  assert.match(s.video.src, /Start_Apareciendo/);
  s.message({type:'rulo_animation_trigger',animation:'hablando',triggerId:'reply-123'});
  assert.match(s.video.src, /Start_Apareciendo/);
  assert.equal(s.sent.filter(x=>x.type==='rulo_animation_started').length, 0);
  s.end(); assert.match(s.video.src, /hablando/);
  assert.equal(s.sent.at(-1).triggerId, 'reply-123');
  assert.equal(s.visible.length, 1);
  s.end(); assert.match(s.video.src, /Estado%20Normal/); assert.equal(s.video.loop, true);
});

test('every manual appearance from hidden state uses Start_Apareciendo', () => {
  const s = setup();
  for (const action of ['aparecer','normal','iniciar']) {
    s.command('ocultar'); s.command(action);
    assert.match(s.video.src, /Start_Apareciendo/);
    s.end(); assert.match(s.video.src, /Estado%20Normal/); assert.equal(s.video.loop, true);
  }
});

test('changed sleep range applies to elapsed uninterrupted sleep; unrelated config does not reset it', () => {
  const s = setup(); s.command('dormir'); s.advance(60000);
  s.message({type:'rulo_config_updated',config:{sleepHideMinMinutes:2,sleepHideMaxMinutes:2}});
  s.advance(30000);
  s.message({type:'rulo_config_updated',config:{sleepHideMinMinutes:2,sleepHideMaxMinutes:2,botName:'Rulo'}});
  s.advance(29999); s.frame(9); s.frame(28); assert.equal(s.video.currentTime, 9);
  s.advance(1); s.frame(28); assert.equal(s.video.currentTime, 28);
  s.end(); assert.match(s.video.src, /Start_Desapareciendo/);
});

test('activity cancels a pending departure while the sleep video is finishing', () => {
  const s = setup(); s.command('dormir'); s.advance(750000);
  s.message({type:'rulo_animation_activity'}); s.end();
  assert.match(s.video.src, /Estado%20Normal/);
  s.advance(300000); assert.match(s.video.src, /Durmiendo/);
  s.frame(9); s.frame(28); assert.equal(s.video.currentTime, 9, 'new sleep has a fresh deadline');
});

test('a request during reverse exit waits, then enters forward before speaking', () => {
  const s = setup(); s.command('dormir'); s.advance(750000); s.end();
  assert.match(s.video.src, /Start_Desapareciendo/);
  s.message({type:'rulo_animation_activity'});
  s.message({type:'rulo_animation_trigger',animation:'hablando',triggerId:'during-exit'});
  assert.match(s.video.src, /Start_Desapareciendo/);
  s.end(); assert.match(s.video.src, /Start_Apareciendo/);
  s.end(); assert.match(s.video.src, /hablando/);
  assert.equal(s.sent.at(-1).triggerId, 'during-exit');
});

test('automatic music does not interrupt sleep or wake a hidden mascot', () => {
  const s = setup(); s.command('dormir'); s.advance(750000);
  s.message({type:'rulo_animation_trigger',animation:'hablando',wake:false});
  s.end(); assert.match(s.video.src, /Start_Desapareciendo/); s.end();
  s.message({type:'rulo_animation_trigger',animation:'hablando',wake:false});
  assert.equal(s.visible.length, 0);
});

test('a refreshed overlay remembers it was hidden until a request arrives', () => {
  const s = setup(true); assert.equal(s.visible.length, 0);
  s.message({type:'rulo_animation_activity'});
  assert.match(s.video.src, /Start_Apareciendo/);
});
test('request in progress wakes at full video end transitioning to normal state', () => {
  const s = setup(); s.command('dormir'); s.frame(14);
  s.message({type:'rulo_animation_activity'});
  assert.match(s.video.src, /Durmiendo/);
  s.frame(28); assert.match(s.video.src, /Durmiendo/);
  s.frame(44.6); assert.match(s.video.src, /Durmiendo/);
  s.end(); assert.match(s.video.src, /Estado%20Normal%20-%20Esperando/);
  assert.equal(s.video.loop, true);
});
