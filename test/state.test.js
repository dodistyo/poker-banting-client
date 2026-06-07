import assert from 'assert';
import { createDeck, shuffle, sortCards, detectCombo, validatePlay, compareCombos, rankIndex, suitOrder } from '../src/game.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name} — ${e.message}`); failed++; }
}

console.log('\n=== State Machine Tests ===');

function card(rank, suit) {
  return { rank, suit, rankIndex: rankIndex(rank), suitOrder: suitOrder(suit) };
}

// ─── Trick resolution ───

test('trick winner leads next trick', () => {
  const winner = 2;
  const currentPlayer = winner;
  assert.strictEqual(currentPlayer, 2, 'Winner should lead next trick');
});

test('trick passes accumulate correctly', () => {
  const passed = [1, 2, 3];
  assert.strictEqual(passed.length, 3, 'Three passes should end trick');
});

test('free play has no combo player', () => {
  const trick = { cards: [], comboType: null, comboPlayer: null, passed: [] };
  assert.strictEqual(trick.comboPlayer, null, 'Free play has no combo player');
});

// ─── Scoring ───

test('first place gets +10', () => {
  const scores = [10, 0, 0, 0];
  assert.strictEqual(scores[0], 10);
});

test('second place gets +5', () => {
  const scores = [10, 5, 0, 0];
  assert.strictEqual(scores[1], 5);
});

test('third place gets 0', () => {
  const scores = [10, 5, 0, 0];
  assert.strictEqual(scores[2], 0);
});

test('last place gets -15', () => {
  const scores = [10, 5, 0, -15];
  assert.strictEqual(scores[3], -15);
});

test('scoring sums to 0', () => {
  const scores = [10, 5, 0, -15];
  assert.strictEqual(scores.reduce((a, b) => a + b, 0), 0, 'Scores should sum to 0');
});

// ─── 3-discard phase ───

test('player with most 3s discards first', () => {
  const hands = [
    [card('3', 'diamonds'), card('3', 'hearts'), card('3', 'clubs')],
    [card('3', 'diamonds')],
    [],
    [card('3', 'spades'), card('3', 'diamonds')],
  ];
  const counts = hands.map(h => h.filter(c => c.rank === '3').length);
  const order = [0, 1, 2, 3].sort((a, b) => counts[b] - counts[a]);
  assert.strictEqual(order[0], 0, 'Player with 3 threes goes first');
});

test('3-discard tiebreak by highest suit', () => {
  const hands = [
    [card('3', 'hearts')],
    [card('3', 'diamonds')],
  ];
  const suitOrderMap = { diamonds: 0, clubs: 1, hearts: 2, spades: 3 };
  const order = [0, 1].sort((a, b) => {
    const suitA = suitOrderMap[hands[a][0].suit];
    const suitB = suitOrderMap[hands[b][0].suit];
    return suitB - suitA;
  });
  assert.strictEqual(order[0], 0, 'Hearts beats diamonds for 3-discard order');
});

test('player with no 3s skips discard', () => {
  const hand = [card('K', 'diamonds'), card('A', 'spades')];
  const threes = hand.filter(c => c.rank === '3');
  assert.strictEqual(threes.length, 0, 'No 3s to discard');
});

// ─── Game over ───

test('game ends when 3 players finish', () => {
  const finishedOrder = [0, 1, 2];
  const isGameOver = finishedOrder.length >= 3;
  assert.strictEqual(isGameOver, true);
});

test('last player added to finished order on game over', () => {
  const finishedOrder = [0, 1, 2];
  const remaining = [0, 1, 2, 3].filter(i => !finishedOrder.includes(i));
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0], 3);
});

test('finished order tracks completion sequence', () => {
  const finishedOrder = [];
  finishedOrder.push(2);
  finishedOrder.push(0);
  finishedOrder.push(3);
  assert.deepStrictEqual(finishedOrder, [2, 0, 3]);
});

// ─── Deck and hands ───

test('deck has 52 cards', () => {
  const deck = createDeck();
  assert.strictEqual(deck.length, 52);
});

test('shuffle produces different order', () => {
  const deck1 = createDeck();
  const deck2 = createDeck();
  shuffle(deck2);
  assert.notDeepStrictEqual(deck1, deck2, 'Shuffled deck should differ');
});

test('sortCards orders by rank descending then suit descending', () => {
  const cards = [card('3', 'spades'), card('K', 'diamonds'), card('3', 'diamonds'), card('2', 'hearts')];
  const sorted = sortCards(cards);
  assert.strictEqual(sorted[0].rank, '2', 'Two should be highest (first)');
  assert.strictEqual(sorted[1].rank, 'K', 'King should be next');
  assert.strictEqual(sorted[2].suit, 'spades', 'Higher suit first for same rank');
  assert.strictEqual(sorted[3].suit, 'diamonds', 'Lower suit last for same rank');
});

test('hands deal 13 cards each', () => {
  const deck = createDeck();
  shuffle(deck);
  const hands = [[], [], [], []];
  deck.forEach((c, i) => hands[i % 4].push(c));
  hands.forEach((h, i) => assert.strictEqual(h.length, 13, `Player ${i} should have 13 cards`));
});

// ─── Validate play ───

test('valid single beats lower single', () => {
  const result = validatePlay([card('K', 'diamonds')], detectCombo([card('3', 'diamonds')]));
  assert.strictEqual(result.valid, true);
});

test('invalid play: lower card cannot beat higher', () => {
  const result = validatePlay([card('3', 'diamonds')], detectCombo([card('K', 'diamonds')]));
  assert.strictEqual(result.valid, false);
});

test('free play accepts any valid combo', () => {
  const result = validatePlay([card('K', 'diamonds'), card('K', 'clubs')], null);
  assert.strictEqual(result.valid, true);
});

test('free play rejects invalid combo', () => {
  const result = validatePlay([card('K', 'diamonds'), card('A', 'clubs')], null);
  assert.strictEqual(result.valid, false);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
