const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  let now = 0, id = 0;
  const timers = new Map(), sockets = [];
  function makeVideo() {
    const handlers = {};
    const classes = new Set();
    return {
      currentTime: 0, duration: 44.7, readyState: 2, seeking: false, src: '', onerror: null,
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
    Date: { now: () => now }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    setTimeout(fn, ms) { timers.set(++id, { fn, due: now + ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
    WebSocket: class { constructor() { this.events = {}; sockets.push(this); } addEventListener(key, fn) { this.events[key] = fn; } }
  };
  const html = fs.readFileSync(path.join(__dirname, '../rulo-animaciones.html'), 'utf8');
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {
    get video() { return players.find(player => player.classList.contains('visible')) || players[0]; },
    players,
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
test('sleep follows five minutes of inactivity; live activity resets the deadline', () => {
  const s = setup(); s.command('aparecer'); s.end();
  s.advance(299000); assert.match(s.video.src, /aparece/);
  s.message({ type: 'rulo_animation_activity' });
  s.advance(299000); assert.match(s.video.src, /aparece/);
  s.advance(1000); assert.match(s.video.src, /Durmiendo/);
});
test('hidden Rulo neither auto sleeps nor reacts to old history', () => {
  const s = setup();
  s.message({type:'rulo_bot_message',rulo:{message:'old'}});
  s.advance(600000); assert.equal(s.video.src, '');
  s.command('aparecer'); s.end(); s.command('ocultar');
  const source = s.video.src;
  s.advance(600000); assert.equal(s.video.src, source);
});
test('hide waits for full sleep video and prevents subsequent automatic speaking', () => {
  const s = setup(); s.command('dormir'); s.frame(12); s.command('ocultar');
  const source = s.video.src;
  s.message({type:'rulo_animation_trigger',animation:'hablando'});
  s.frame(28); assert.match(s.video.src, /Durmiendo/);
  s.end();
  s.message({type:'rulo_animation_trigger',animation:'hablando'});
  s.advance(600000); assert.equal(s.video.src, source);
});
test('request in progress wakes at full video end without replaying entrance', () => {
  const s = setup(); s.command('dormir'); s.frame(14);
  s.message({type:'rulo_animation_activity'});
  assert.match(s.video.src, /Durmiendo/);
  s.frame(28); assert.match(s.video.src, /Durmiendo/);
  s.frame(44.6); assert.match(s.video.src, /Durmiendo/);
  s.end(); assert.match(s.video.src, /aparece/);
  assert.ok(s.video.currentTime > 44);
});
