// wake.test.js — unit tests for src/wake.js (screen Wake Lock).
//
// Why this exists: on mobile, screen-off suspends/throttles the page — the
// 25s WS ping stops firing and the connection drops mid-game. A screen Wake
// Lock keeps the display awake while the user is IN a room (lobby + playing),
// and is released when they leave.
//
// The module must stay DOM-light so Node can test it: it reads
// navigator.wakeLock lazily from globalThis and accepts a sentinel for the
// lock, so tests inject fakes instead of a real browser.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(__dirname, '..', 'src', 'wake.js');
let passed = 0;

function ok(label) { passed++; console.log('  ok - ' + label); }

async function freshModule() {
  const url = 'file://' + modulePath + '?t=' + Date.now() + Math.random();
  return import(url);
}

function installFakeNavigator(state = 'granted') {
  const calls = { request: 0, release: 0, sentinel: [] };
  class FakeSentinel {
    constructor() {
      this.released = false;
      const self = this;
      this.addEventListener = (evt, fn) => {
        if (evt === 'release') this._onRelease = fn;
      };
      this.release = () => {
        if (this.released) return;
        this.released = true;
        if (this._onRelease) this._onRelease();
      };
    }
    get state() { return state; }
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      wakeLock: {
        request: async (type) => {
          calls.request++;
          if (type !== 'screen') throw new Error('wrong type: ' + type);
          const s = new FakeSentinel();
          calls.sentinel.push(s);
          return s;
        },
      },
    },
    configurable: true,
    writable: true,
  });
  return { calls, sentinel: () => calls.sentinel[calls.sentinel.length - 1] };
}

// 1. No Wake Lock support (old browser / unsupported): hold() resolves false,
//    nothing throws. (Node 24 exposes a `navigator` getter without wakeLock,
//    which is the same shape — no override needed.)
{
  const mod = await freshModule();
  assert.equal(await mod.hold(), false);
  assert.equal(await mod.hold(), false); // repeated, still safe
  assert.equal(mod.isHeld(), false);
  ok('no wakeLock API -> hold() resolves false, no throw');
}

// 2. Supported: hold() requests a screen lock, isHeld flips, release() frees it.
{
  const fake = installFakeNavigator();
  const mod = await freshModule();
  assert.equal(await mod.hold(), true);
  assert.equal(fake.calls.request, 1);
  assert.equal(mod.isHeld(), true);
  mod.release();
  assert.equal(mod.isHeld(), false);
  assert.equal(fake.sentinel().released, true);
  ok('hold() -> request("screen") + isHeld; release() frees the sentinel');
}

// 3. Idempotent: holding while already held does NOT request a second lock.
{
  const fake = installFakeNavigator();
  const mod = await freshModule();
  await mod.hold();
  await mod.hold();
  assert.equal(fake.calls.request, 1);
  assert.equal(mod.isHeld(), true);
  ok('hold() while held is a no-op (one request total)');
}

// 4. Auto re-hold: when the OS releases the lock (screen off / unlock),
//    the module re-requests while the user is still in a room.
{
  const fake = installFakeNavigator();
  const mod = await freshModule();
  await mod.hold();
  // Simulate the OS releasing the first sentinel (e.g. screen-off).
  fake.sentinel().release();
  // The module debounces re-requests (~50ms); give it time.
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fake.calls.request, 2);
  assert.equal(mod.isHeld(), true);
  mod.release(); // stop the session
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fake.calls.request, 2); // no third request after release
  ok('OS release while in-room triggers exactly one re-request; release stops it');
}

// 5. Release stops re-hold: after an explicit release, sentinel release events
//    are ignored (no request loop).
{
  const fake = installFakeNavigator();
  const mod = await freshModule();
  await mod.hold();
  mod.release();
  fake.sentinel().release(); // stale sentinel fires after we left
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fake.calls.request, 1);
  ok('explicit release ignores later release events (no loop)');
}

console.log(passed + ' wake tests passed');
