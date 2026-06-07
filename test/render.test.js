import assert from 'assert';
import { JSDOM } from 'jsdom';
import { render, renderThreePhaseOverlay, updateScoreboard, renderLobby } from '../src/render.js';

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; }
  catch (e) { failed++; console.log(`FAIL: ${name}\n  ${e.message}`); }
};

const setupDOM = () => {
  const html = `
    <div id="player-0"></div>
    <div id="player-1"></div>
    <div id="player-2"></div>
    <div id="player-3"></div>
    <div id="center-cards"></div>
    <div id="center-info"></div>
    <div id="pass-markers"></div>
    <div id="log"></div>
    <div id="scoreboard"></div>
    <div id="action-bar">
      <button id="btn-play">Play</button>
      <button id="btn-pass">Pass</button>
      <button id="btn-sort">Sort Hand</button>
    </div>
    <div id="three-phase-overlay" class="">
      <div id="three-discard-grid"></div>
      <div id="three-phase-center-info"></div>
    </div>
    <div id="lobby-overlay" style="display:none">
      <div id="lobby-player-list"></div>
    </div>
    <div id="gameover-overlay" class="">
      <div id="final-scores"></div>
    </div>
  `;
  const dom = new JSDOM(html);
  global.document = dom.window.document;
  global.window = dom.window;
};

function card(rank, suit) {
  const syms = { diamonds: '\u2666', clubs: '\u2663', hearts: '\u2665', spades: '\u2660' };
  return { rank, suit, suitSymbol: syms[suit] || '?', selected: false };
}

function makeState(hand0, hand1, hand2, hand3, opts = {}) {
  const players = [
    { id: 0, name: opts.names?.[0] || 'You', hand: hand0 || [], finished: false, isBot: false, connected: true },
    { id: 1, name: opts.names?.[1] || 'Bot1', hand: hand1 || [], finished: opts.bot1Finished || false, isBot: true, connected: true },
    { id: 2, name: opts.names?.[2] || 'Bot2', hand: hand2 || [], finished: opts.bot2Finished || false, isBot: true, connected: true },
    { id: 3, name: opts.names?.[3] || 'Bot3', hand: hand3 || [], finished: opts.bot3Finished || false, isBot: true, connected: true },
  ];
  return {
    phase: opts.phase || 'playing',
    players,
    currentPlayer: opts.currentPlayer || 0,
    trick: {
      combo: opts.trickCombo || null,
      comboPlayer: opts.trickComboPlayer ?? -1,
      passed: opts.trickPassed || [],
      leader: opts.currentPlayer || 0,
    },
    finishedOrder: opts.finishedOrder || [],
    scores: opts.scores || [0, 0, 0, 0],
    log: opts.log || [],
    // Adapted properties (normally set by adaptState in app.js)
    _playerId: 0,
    _lastActive: -1,
    playerNames: players.map(p => p.name),
    isHuman: players.map(p => !p.isBot && p.connected),
    hands: [hand0, hand1, hand2, hand3].map(h => (h || []).map(c => ({ ...c, selected: false }))),
    gameOver: opts.phase === 'gameOver',
    threePhase: opts.phase === 'threeDiscard',
    selectCard: () => {},
    updatePlayButton: () => {},
  };
}

console.log('\n=== Render Tests ===');

// ─── Basic render ───

test('render populates player hand divs', () => {
  setupDOM();
  const state = makeState([card('3', 'diamonds'), card('K', 'spades')]);
  render(state);
  const p0 = document.getElementById('player-0');
  assert.ok(p0.innerHTML.includes('3'), 'Should contain card 3');
  assert.ok(p0.innerHTML.includes('K'), 'Should contain card K');
});

test('render shows opponent cards face-down', () => {
  setupDOM();
  const state = makeState([], [card('A', 'hearts')]);
  render(state);
  const p1 = document.getElementById('player-1');
  assert.ok(!p1.innerHTML.includes('A'), 'Opponent card should not show rank');
  assert.ok(p1.innerHTML.includes('face-down'), 'Should have face-down class');
});

test('render shows correct number of opponent cards', () => {
  setupDOM();
  const state = makeState([], [card('3', 'diamonds'), card('4', 'diamonds'), card('5', 'diamonds')]);
  render(state);
  const p1 = document.getElementById('player-1');
  const count = (p1.innerHTML.match(/face-down/g) || []).length;
  assert.strictEqual(count, 3, 'Should show 3 face-down cards');
});

test('render highlights current player', () => {
  setupDOM();
  const state = makeState([], [], [], [], { currentPlayer: 2 });
  render(state);
  const p2 = document.getElementById('player-2');
  assert.ok(p2.className.includes('active'), 'Current player should have active class');
});

test('render shows center cards', () => {
  setupDOM();
  const state = makeState([], [], [], [], {
    currentPlayer: 1,
    trickCombo: { type: 'pair', cards: [card('K', 'diamonds'), card('K', 'clubs')], comboPlayer: 0 },
    trickComboPlayer: 0,
  });
  render(state);
  const center = document.getElementById('center-cards');
  assert.ok(center.innerHTML.includes('K'), 'Center should show played cards');
});

test('render shows pass markers', () => {
  setupDOM();
  const state = makeState([], [], [], [], {
    currentPlayer: 2,
    trickCombo: { type: 'single', cards: [card('K', 'diamonds')], comboPlayer: 0 },
    trickComboPlayer: 0,
    trickPassed: [1],
  });
  render(state);
  const passMarkers = document.getElementById('pass-markers');
  assert.ok(passMarkers.innerHTML.includes('Pass'), 'Should show pass markers');
});

test('render shows finished player', () => {
  setupDOM();
  const state = makeState([], [card('3', 'diamonds')], [card('3', 'diamonds')], [card('3', 'diamonds')], {
    currentPlayer: 1,
    finishedOrder: [0],
    scores: [10, 0, 0, 0],
  });
  render(state);
  const p0 = document.getElementById('player-0');
  assert.ok(p0.innerHTML.includes('FINISHED'), 'Finished player should be marked');
});

test('render shows gameover in center info', () => {
  setupDOM();
  const state = makeState([], [], [], [], {
    phase: 'gameOver',
    finishedOrder: [0, 1, 2, 3],
    scores: [10, 5, 0, -15],
  });
  render(state);
  const centerInfo = document.getElementById('center-info');
  assert.ok(centerInfo.textContent.includes('Game Over'), 'Should show game over');
});

// ─── Three phase overlay ───

test('renderThreePhaseOverlay shows 3s', () => {
  setupDOM();
  const state = makeState([card('3', 'diamonds'), card('3', 'hearts')], [], [], [], {
    phase: 'threeDiscard',
  });
  state.threePhaseOrder = [0, 1, 2, 3];
  state.threePhaseIndex = 0;
  state.threePhaseCards = [
    [card('3', 'diamonds'), card('3', 'hearts')],
    [card('3', 'clubs')],
    [],
    [],
  ];
  state.threePhaseDiscarded = [false, false, false, false];
  renderThreePhaseOverlay(state);
  const overlay = document.getElementById('three-phase-overlay');
  assert.ok(overlay.classList.contains('show'), 'Three overlay should be shown');
  const grid = document.getElementById('three-discard-grid');
  assert.ok(grid.innerHTML.includes('3'), 'Should show 3 cards');
});

test('renderThreePhaseOverlay shows discard order', () => {
  setupDOM();
  const state = makeState([], [], [], [], { phase: 'threeDiscard' });
  state.threePhaseOrder = [0, 1, 2, 3];
  state.threePhaseIndex = 0;
  state.threePhaseCards = [[], [], [], []];
  state.threePhaseDiscarded = [false, false, false, false];
  renderThreePhaseOverlay(state);
  const centerInfo = document.getElementById('three-phase-center-info');
  assert.ok(centerInfo.textContent.includes('Your turn') || centerInfo.textContent.includes('discarding'), 'Should show turn info');
});

// ─── Scoreboard ───

test('updateScoreboard shows scores', () => {
  setupDOM();
  const state = makeState([], [], [], [], { scores: [10, 5, 0, -15] });
  updateScoreboard(state);
  const sb = document.getElementById('scoreboard');
  assert.ok(sb.innerHTML.includes('10'), 'Should show score 10');
  assert.ok(sb.innerHTML.includes('-15'), 'Should show score -15');
});

// ─── Lobby ───

test('renderLobby shows players', () => {
  setupDOM();
  const state = makeState([], [], [], [], {
    phase: 'lobby',
    names: ['Alice', 'Bot1', 'Bot2', 'Bot3'],
  });
  renderLobby(state);
  const list = document.getElementById('lobby-player-list');
  assert.ok(list.innerHTML.includes('Alice'), 'Should show Alice');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
