// sound.test.js — unit tests for src/sound.js (Web Audio synth cues).
//
// sound.js reads AudioContext from globalThis LAZILY (autoplay policy: the
// context may only be created/resumed after a user gesture), so Node tests
// install a fake constructor first and capture the instance via __fakeAC.
// Each test re-imports with a cache-bust query for fresh module state.
import assert from 'node:assert/strict';

class FakeAudioContext {
  constructor(state = 'running') {
    this.state = state;
    this.currentTime = 0;
    this.destination = { kind: 'destination' };
    this.events = [];
    this.resumeCalls = 0;
    globalThis.__fakeAC = this;
  }
  createOscillator() {
    const e = { kind: 'osc', freqs: [], started: false, stopped: false, connected: null };
    e.frequency = {
      setValueAtTime: (v, t) => e.freqs.push([v, t]),
      exponentialRampToValueAtTime: (v, t) => e.freqs.push([v, t]),
    };
    e.connect = (n) => { e.connected = n; };
    e.start = (t) => { e.started = true; };
    e.stop = (t) => { e.stopped = true; };
    this.events.push(e);
    return e;
  }
  createGain() {
    const e = { kind: 'gain', gains: [], connected: null };
    e.gain = {
      setValueAtTime: (v, t) => e.gains.push([v, t]),
      exponentialRampToValueAtTime: (v, t) => e.gains.push([v, t]),
    };
    e.connect = (n) => { e.connected = n; };
    this.events.push(e);
    return e;
  }
  // Browsers make resume() async: the Promise resolves and state flips
  // LATER, not synchronously. Fake mirrors that (just count the call).
  resume() { this.resumeCalls++; return Promise.resolve(); }
}

function installFake(state) {
  globalThis.AudioContext = class extends FakeAudioContext {
    constructor() { super(state); }
  };
}

async function freshModule() {
  return import('../src/sound.js?v=' + Math.random().toString(36).slice(2));
}

let passed = 0;

// 1. No AudioContext at all (very old browser / SSR-ish env) -> cues must be
//    silent no-ops, never throw.
{
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  const mod = await freshModule();
  for (const cue of ['playDeal', 'playCard', 'playPass', 'playTurn', 'playBomb', 'playWin', 'primeAudio', 'resumeAudio']) {
    assert.doesNotThrow(() => mod[cue]());
  }
  assert.equal(mod.isMuted(), false, 'default unmuted (no localStorage in Node)');
  console.log('  ok - silent no-ops when AudioContext unavailable');
  passed++;
}

// 2. Running context: playCard schedules an oscillator wired osc->gain->dest.
{
  installFake('running');
  const mod = await freshModule();
  mod.playCard();
  const ac = globalThis.__fakeAC;
  const oscs = ac.events.filter(e => e.kind === 'osc');
  const gains = ac.events.filter(e => e.kind === 'gain');
  assert.ok(oscs.length >= 1, 'playCard schedules >=1 oscillator');
  assert.ok(oscs[0].started && oscs[0].stopped, 'oscillator started and stopped');
  assert.ok(gains.length >= 1, 'gain node created');
  assert.equal(oscs[0].connected, gains[0], 'osc -> gain');
  assert.equal(gains[0].connected, ac.destination, 'gain -> destination');
  console.log('  ok - playCard wires osc->gain->destination');
  passed++;
}

// 3. Cue shapes are distinct: bomb = low thump, turn = high ding, deal = multi-tick.
{
  installFake('running');
  const mod = await freshModule();
  mod.playBomb();
  let ac = globalThis.__fakeAC;
  let freqs = ac.events.filter(e => e.kind === 'osc').flatMap(o => o.freqs.map(f => f[0]));
  assert.ok(freqs.length > 0 && Math.min(...freqs) < 200, 'bomb has a low thump (<200Hz)');

  ac.events.length = 0;
  mod.playTurn();
  freqs = ac.events.filter(e => e.kind === 'osc').flatMap(o => o.freqs.map(f => f[0]));
  assert.ok(freqs.length > 0 && Math.max(...freqs) >= 800, 'turn ding is high (>=800Hz)');

  ac.events.length = 0;
  mod.playDeal();
  assert.ok(ac.events.filter(e => e.kind === 'osc').length >= 2, 'deal is multi-tick (>=2 oscillators)');
  console.log('  ok - bomb/turn/deal have distinct correct shapes');
  passed++;
}

// 4. Mute gate: muted -> NO context is even created (nothing scheduled);
//    unmuted -> context created and it plays.
{
  installFake('running');
  const mod = await freshModule();
  assert.equal(mod.isMuted(), false);
  globalThis.__fakeAC = null;
  mod.setMuted(true);
  assert.equal(mod.isMuted(), true);
  mod.playCard();
  mod.playTurn();
  assert.equal(globalThis.__fakeAC, null, 'muted -> context not even created, nothing scheduled');
  mod.setMuted(false);
  mod.playCard();
  const ac = globalThis.__fakeAC;
  assert.ok(ac && ac.events.filter(e => e.kind === 'osc').length > 0, 'unmuted -> context created and plays');
  console.log('  ok - mute gate works both ways');
  passed++;
}

// 5. Suspended context (autoplay policy): cues stay silent but trigger a
//    resume() attempt; once the browser flips the state to running, cues play.
{
  installFake('suspended');
  const mod = await freshModule();
  mod.playCard();
  const ac = globalThis.__fakeAC;
  assert.equal(ac.events.filter(e => e.kind === 'osc').length, 0, 'suspended -> silent');
  assert.equal(ac.resumeCalls, 1, 'play on suspended ctx triggers resume()');
  mod.resumeAudio();
  assert.equal(ac.resumeCalls, 2, 'resumeAudio also triggers resume()');
  // Browser finishes resuming (async) -> state flips to running.
  ac.state = 'running';
  mod.playCard();
  assert.ok(ac.events.filter(e => e.kind === 'osc').length > 0, 'after resume completes -> plays');
  console.log('  ok - suspended context: silent until resume completes');
  passed++;
}

console.log('\n' + passed + ' sound tests passed');
