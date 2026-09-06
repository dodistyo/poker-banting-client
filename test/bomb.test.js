import assert from 'assert';
import { detectCombo, validatePlay, compareCombos, createDeck } from '../src/game.js';

function mkCard(rank, suitName) {
  const suitMap = { d: 'diamonds', c: 'clubs', h: 'hearts', s: 'spades' };
  return createDeck().find(c => c.rank === rank && c.suit === suitMap[suitName]);
}

function bomb(rank) {
  return [mkCard(rank, 'd'), mkCard(rank, 'c'), mkCard(rank, 'h'), mkCard(rank, 's')];
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== Bomb (4x same rank) ===');

test('four same rank is detected as bomb', () => {
  const r = detectCombo(bomb('K'));
  assert.strictEqual(r.type, 'bomb');
});

test('four 2s is a bomb too (detection only)', () => {
  const r = detectCombo(bomb('2'));
  assert.strictEqual(r.type, 'bomb');
});

test('same-suit 4-card straight is still a straight, not a bomb', () => {
  const r = detectCombo([mkCard('7', 'h'), mkCard('8', 'h'), mkCard('9', 'h'), mkCard('10', 'h')]);
  assert.strictEqual(r.type, 'straight');
});

test('higher bomb beats lower bomb', () => {
  assert.ok(compareCombos(detectCombo(bomb('K')), detectCombo(bomb('5'))) > 0);
});

test('lower bomb cannot beat higher bomb', () => {
  assert.ok(compareCombos(detectCombo(bomb('5')), detectCombo(bomb('K'))) < 0);
});

test('bomb vs non-bomb compare is null', () => {
  assert.strictEqual(compareCombos(detectCombo(bomb('K')), detectCombo([mkCard('2', 'd')])), null);
});

test('bomb cannot lead a trick', () => {
  const r = validatePlay(bomb('K'), null);
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /cannot lead/i);
});

test('bomb cannot beat a normal single', () => {
  const table = detectCombo([mkCard('K', 'd')]);
  const r = validatePlay(bomb('5'), table);
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /only counter a single 2/i);
});

test('bomb beats a single 2', () => {
  const table = detectCombo([mkCard('2', 'd')]);
  const r = validatePlay(bomb('5'), table);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.comboName, 'Bomb');
});

test('bomb cannot beat a pair of 2s', () => {
  const table = detectCombo([mkCard('2', 'd'), mkCard('2', 'c')]);
  const r = validatePlay(bomb('K'), table);
  assert.strictEqual(r.valid, false);
});

test('bomb cannot beat a triple of 2s', () => {
  const table = detectCombo([mkCard('2', 'd'), mkCard('2', 'c'), mkCard('2', 'h')]);
  const r = validatePlay(bomb('K'), table);
  assert.strictEqual(r.valid, false);
});

test('higher bomb counters lower bomb', () => {
  const table = detectCombo(bomb('5'));
  const r = validatePlay(bomb('K'), table);
  assert.strictEqual(r.valid, true);
});

test('lower bomb cannot counter higher bomb', () => {
  const table = detectCombo(bomb('K'));
  const r = validatePlay(bomb('5'), table);
  assert.strictEqual(r.valid, false);
});

test('equal bomb cannot counter', () => {
  const table = detectCombo(bomb('K'));
  const r = validatePlay(bomb('K'), table);
  assert.strictEqual(r.valid, false);
});

test('normal cards cannot follow a bomb', () => {
  const table = detectCombo(bomb('5'));
  const r = validatePlay([mkCard('2', 's')], table);
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /higher bomb/i);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
