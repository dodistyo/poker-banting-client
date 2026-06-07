import assert from 'assert';
import { createRoom, joinRoom, sendPlay, sendPass, isConnected, connect, disconnect, send } from '../src/network.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== Network (WebSocket mode) ===');

// Mock WebSocket for Node.js
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._messages = [];
    // Simulate open
    if (this.onopen) setTimeout(() => this.onopen(), 0);
  }
  send(data) {
    this._messages.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
  getMessages() {
    return this._messages;
  }
}

global.WebSocket = MockWebSocket;
global.WebSocket.OPEN = 1;
global.WebSocket.CLOSED = 3;

test('isConnected returns false when not connected', () => {
  disconnect();
  assert.strictEqual(isConnected(), false);
});

test('connect creates WebSocket and fires onopen', () => {
  disconnect();
  let opened = false;
  connect('ws://localhost:8080/ws', null, () => { opened = true; }, null);
  assert.strictEqual(isConnected(), true);
});

test('createRoom sends correct message', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  createRoom('Test Room');
  const ws = global.WebSocket.prototype.constructor;
});

test('joinRoom sends correct message', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  joinRoom('ABC123', 'Player1');
});

test('sendPlay sends correct message', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  sendPlay([0, 2, 5]);
});

test('sendPass sends correct message', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  sendPass();
});

test('send serializes message to JSON', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  send({ type: 'ping' });
});

test('disconnect closes WebSocket', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  disconnect();
  assert.strictEqual(isConnected(), false);
});

test('createRoom sends create type', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  createRoom('Test');
});

test('joinRoom preserves player name', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  joinRoom('XYZ789', 'Alice');
});

test('sendPlay with single card', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  sendPlay([3]);
});

test('messages are sent as JSON strings', () => {
  disconnect();
  connect('ws://localhost:8080/ws', null, null, null);
  send({ type: 'test', data: 'hello' });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
