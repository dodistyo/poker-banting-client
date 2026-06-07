import assert from 'assert';
import { isStraight, detectCombo, createDeck } from '../src/game.js';

function mkCard(rank, suitName) {
  const suitMap = { d: 'diamonds', c: 'clubs', h: 'hearts', s: 'spades' };
  return createDeck().find(c => c.rank === rank && c.suit === suitMap[suitName]);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== isStraight Edge Cases ===');

test('minimum 3 cards required', () => {
  const r = detectCombo([mkCard('3', 'h'), mkCard('4', 'h')]);
  assert.strictEqual(r, null);
});

test('3-4-5 all numbers is valid', () => {
  const r = detectCombo([mkCard('3', 'h'), mkCard('4', 'h'), mkCard('5', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('4-5-6-7 all numbers is valid', () => {
  const r = detectCombo([mkCard('4', 'h'), mkCard('5', 'h'), mkCard('6', 'h'), mkCard('7', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('5-6-7-8-9 all numbers is valid', () => {
  const r = detectCombo([mkCard('5', 'h'), mkCard('6', 'h'), mkCard('7', 'h'), mkCard('8', 'h'), mkCard('9', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('J-Q-K all letters is valid', () => {
  const r = detectCombo([mkCard('J', 'h'), mkCard('Q', 'h'), mkCard('K', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('Q-K-A all letters is valid', () => {
  const r = detectCombo([mkCard('Q', 'h'), mkCard('K', 'h'), mkCard('A', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('J-Q-K-A all letters is valid', () => {
  const r = detectCombo([mkCard('J', 'h'), mkCard('Q', 'h'), mkCard('K', 'h'), mkCard('A', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('10-J-Q-K all letters is valid', () => {
  const r = detectCombo([mkCard('10', 'h'), mkCard('J', 'h'), mkCard('Q', 'h'), mkCard('K', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('10-J-Q-K-A all letters is valid', () => {
  const r = detectCombo([mkCard('10', 'h'), mkCard('J', 'h'), mkCard('Q', 'h'), mkCard('K', 'h'), mkCard('A', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('9-10-J mixed numbers/letters is invalid', () => {
  const r = detectCombo([mkCard('9', 'h'), mkCard('10', 'h'), mkCard('J', 'h')]);
  assert.strictEqual(r, null);
});

test('8-9-10-J mixed is invalid', () => {
  const r = detectCombo([mkCard('8', 'h'), mkCard('9', 'h'), mkCard('10', 'h'), mkCard('J', 'h')]);
  assert.strictEqual(r, null);
});

test('2 cannot be in straight', () => {
  const r = detectCombo([mkCard('Q', 'h'), mkCard('K', 'h'), mkCard('A', 'h'), mkCard('2', 'h')]);
  assert.strictEqual(r, null);
});

test('A-2-3 cannot be straight', () => {
  const r = detectCombo([mkCard('A', 'h'), mkCard('2', 'h'), mkCard('3', 'h')]);
  assert.strictEqual(r, null);
});

test('non-consecutive numbers fail', () => {
  const r = detectCombo([mkCard('3', 'h'), mkCard('5', 'h'), mkCard('7', 'h')]);
  assert.strictEqual(r, null);
});

test('non-consecutive letters fail', () => {
  const r = detectCombo([mkCard('J', 'h'), mkCard('K', 'h'), mkCard('A', 'h')]);
  assert.strictEqual(r, null);
});

test('gaps in letter sequence fail', () => {
  const r = detectCombo([mkCard('10', 'h'), mkCard('Q', 'h'), mkCard('K', 'h')]);
  assert.strictEqual(r, null);
});

test('mixed suits fail even if sequential', () => {
  const r = detectCombo([mkCard('3', 'h'), mkCard('4', 'd'), mkCard('5', 'h')]);
  assert.strictEqual(r, null);
});

test('duplicate rank fails', () => {
  const r = detectCombo([mkCard('3', 'h'), mkCard('3', 'd'), mkCard('4', 'h')]);
  assert.strictEqual(r, null);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
