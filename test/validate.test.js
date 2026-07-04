import assert from 'assert';
import { validatePlay, detectCombo, createDeck } from '../src/game.js';

function mkCard(rank, suitName) {
  const suitMap = { d: 'diamonds', c: 'clubs', h: 'hearts', s: 'spades' };
  return createDeck().find(c => c.rank === rank && c.suit === suitMap[suitName]);
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== validatePlay ===');

test('empty cards is invalid', () => {
  const r = validatePlay([], null);
  assert.strictEqual(r.valid, false);
});

test('single card on empty table is valid', () => {
  const r = validatePlay([mkCard('7', 'h')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Single');
});

test('pair on empty table is valid', () => {
  const r = validatePlay([mkCard('K', 'h'), mkCard('K', 's')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Pair');
});

test('triple on empty table is valid', () => {
  const r = validatePlay([mkCard('5', 'd'), mkCard('5', 'c'), mkCard('5', 'h')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Triple');
});

test('straight on empty table is valid', () => {
  const r = validatePlay([mkCard('3', 'h'), mkCard('4', 'h'), mkCard('5', 'h')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Straight');
});

test('full house on empty table is valid', () => {
  const r = validatePlay([mkCard('K', 'd'), mkCard('K', 'c'), mkCard('K', 'h'), mkCard('7', 's'), mkCard('7', 'd')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Full House');
});

test('four of a kind on empty table is valid', () => {
  const r = validatePlay([mkCard('A', 'd'), mkCard('A', 'c'), mkCard('A', 'h'), mkCard('A', 's'), mkCard('3', 'd')], null);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Four of a Kind');
});

test('invalid combo on empty table', () => {
  const r = validatePlay([mkCard('3', 'd'), mkCard('7', 'c'), mkCard('Q', 'h')], null);
  assert.strictEqual(r.valid, false);
});

test('higher single beats lower single', () => {
  const table = detectCombo([mkCard('7', 'h')]);
  const r = validatePlay([mkCard('K', 'd')], table);
  assert.strictEqual(r.valid, true);
});

test('same rank different suit cannot beat', () => {
  const table = detectCombo([mkCard('K', 'd')]);
  const r = validatePlay([mkCard('K', 's')], table);
  assert.strictEqual(r.valid, false);
});

test('same rank same suit cannot beat', () => {
  const table = detectCombo([mkCard('K', 's')]);
  const r = validatePlay([mkCard('K', 's')], table);
  assert.strictEqual(r.valid, false);
});

test('lower single cannot beat', () => {
  const table = detectCombo([mkCard('K', 'd')]);
  const r = validatePlay([mkCard('7', 'h')], table);
  assert.strictEqual(r.valid, false);
});

test('different type cannot beat', () => {
  const table = detectCombo([mkCard('7', 'h')]);
  const r = validatePlay([mkCard('K', 'd'), mkCard('K', 'c')], table);
  assert.strictEqual(r.valid, false);
});

test('higher pair beats lower pair', () => {
  const table = detectCombo([mkCard('7', 'h'), mkCard('7', 'd')]);
  const r = validatePlay([mkCard('K', 'd'), mkCard('K', 'c')], table);
  assert.strictEqual(r.valid, true);
});

test('higher triple beats lower triple', () => {
  const table = detectCombo([mkCard('5', 'd'), mkCard('5', 'c'), mkCard('5', 'h')]);
  const r = validatePlay([mkCard('K', 'd'), mkCard('K', 'c'), mkCard('K', 'h')], table);
  assert.strictEqual(r.valid, true);
});

test('higher straight beats lower straight', () => {
  const table = detectCombo([mkCard('3', 'h'), mkCard('4', 'h'), mkCard('5', 'h')]);
  const r = validatePlay([mkCard('7', 'h'), mkCard('8', 'h'), mkCard('9', 'h')], table);
  assert.strictEqual(r.valid, true);
});

test('higher full house beats lower full house', () => {
  const table = detectCombo([mkCard('7', 'd'), mkCard('7', 'c'), mkCard('7', 'h'), mkCard('3', 's'), mkCard('3', 'd')]);
  const r = validatePlay([mkCard('K', 'd'), mkCard('K', 'c'), mkCard('K', 'h'), mkCard('3', 's'), mkCard('3', 'd')], table);
  assert.strictEqual(r.valid, true);
});

test('higher fourkind beats lower fourkind', () => {
  const table = detectCombo([mkCard('3', 'd'), mkCard('7', 'd'), mkCard('7', 'c'), mkCard('7', 'h'), mkCard('7', 's')]);
  const r = validatePlay([mkCard('3', 'd'), mkCard('K', 'd'), mkCard('K', 'c'), mkCard('K', 'h'), mkCard('K', 's')], table);
  assert.strictEqual(r.valid, true);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
