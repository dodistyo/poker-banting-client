import assert from 'assert';
import { PROD_HOST, PROD_API_ORIGIN, apiOrigin, wsUrl, restUrl } from '../src/config.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== Config (API origin resolution) ===');

test('PROD_HOST is the firebase hosting host', () => {
  assert.strictEqual(PROD_HOST, 'poker-banting.dodistyo.com');
});

test('PROD_API_ORIGIN is the cloud run api host', () => {
  assert.strictEqual(PROD_API_ORIGIN, 'https://api.poker-banting.dodistyo.com');
});

test('prod host resolves cross-origin to the prod API', () => {
  assert.strictEqual(apiOrigin(PROD_HOST), 'https://api.poker-banting.dodistyo.com');
});

test('localhost stays same-origin (dev-server proxy)', () => {
  // Node has no `location`; with a non-prod hostname the fallback is
  // `location.origin`, which is "" under Node. The contract we care about:
  // it must NOT be the prod API.
  assert.notStrictEqual(apiOrigin('localhost'), PROD_API_ORIGIN);
});

test('tunnel dev host stays same-origin (not prod API)', () => {
  assert.notStrictEqual(apiOrigin('app.dodistyo.work'), PROD_API_ORIGIN);
});

test('wsUrl: prod builds wss to the api subdomain', () => {
  assert.strictEqual(wsUrl(PROD_HOST), 'wss://api.poker-banting.dodistyo.com/api/ws');
});

test('wsUrl: non-prod never points at the prod API', () => {
  const url = wsUrl('localhost');
  assert.ok(!url.includes('api.poker-banting.dodistyo.com'), `unexpected prod URL: ${url}`);
});

test('restUrl: prod REST goes to the api origin', () => {
  assert.strictEqual(restUrl('/api/rooms', PROD_HOST), 'https://api.poker-banting.dodistyo.com/api/rooms');
});

test('restUrl: prod health goes to the api origin', () => {
  assert.strictEqual(restUrl('/api/health', PROD_HOST), 'https://api.poker-banting.dodistyo.com/api/health');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
