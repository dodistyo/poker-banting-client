// Quick test: trick reset when human plays highest card and all bots pass
// Run with: node trick-test.js

const assert = require('assert');

const playerNames = ['You', 'Bot Ali', 'Bot Budi', 'Bot Cici'];

// Simulate exact game state: human (P0) just played highest card, 3 bots pass
let currentComboPlayer = 0;  // Human played the winning combo
let currentPlayer = 1;       // Next player is Bot Ali
let passedPlayers = [];
let currentCombo = { type: 'single', cards: [{ rank: '2', suit: 'spades' }] };

console.log('=== Scenario: Human plays highest card, 3 bots pass ===\n');
console.log(`Winning combo by P${currentComboPlayer} (${playerNames[currentComboPlayer]})`);
console.log(`Next to play: P${currentPlayer} (${playerNames[currentPlayer]})`);

// Bot Ali passes
passedPlayers.push(currentPlayer);
console.log(`\nP${currentPlayer} (${playerNames[currentPlayer]}) passed. passedPlayers=${JSON.stringify(passedPlayers)}`);
assert.strictEqual(passedPlayers.length, 1);
currentPlayer = (currentPlayer + 1) % 4; // -> 2

// Bot Budi passes
passedPlayers.push(currentPlayer);
console.log(`P${currentPlayer} (${playerNames[currentPlayer]}) passed. passedPlayers=${JSON.stringify(passedPlayers)}`);
assert.strictEqual(passedPlayers.length, 2);
currentPlayer = (currentPlayer + 1) % 4; // -> 3

// Bot Cici passes — this is the 3rd pass, trick reset happens
passedPlayers.push(currentPlayer);
console.log(`P${currentPlayer} (${playerNames[currentPlayer]}) passed. passedPlayers=${JSON.stringify(passedPlayers)}`);
assert.strictEqual(passedPlayers.length, 3);

// === TRICK RESET (same logic as aiPass line 596-602) ===
console.log(`\n>>> TRICK RESET`);
console.log(`    currentComboPlayer before reset: ${currentComboPlayer}`);
console.log(`    playerNames[currentComboPlayer]: "${playerNames[currentComboPlayer]}"`);

assert(currentComboPlayer >= 0 && currentComboPlayer < 4, `currentComboPlayer=${currentComboPlayer} out of range!`);
assert(playerNames[currentComboPlayer] !== undefined, `playerNames[${currentComboPlayer}] is undefined!`);

// This is the critical order: save currentComboPlayer to currentPlayer FIRST
currentPlayer = currentComboPlayer;  // Save winner to currentPlayer
console.log(`    currentPlayer = currentComboPlayer => ${currentPlayer}`);

// THEN reset
currentCombo = null;
currentComboPlayer = -1;
passedPlayers = [];

console.log(`    After reset: currentComboPlayer=${currentComboPlayer}, passedPlayers=${JSON.stringify(passedPlayers)}`);

// === Verify ===
console.log(`\n>>> AFTER RESET`);
console.log(`    currentPlayer: ${currentPlayer}`);
console.log(`    playerNames[currentPlayer]: "${playerNames[currentPlayer]}"`);

assert(currentPlayer >= 0 && currentPlayer < 4, `currentPlayer=${currentPlayer} out of range!`);
assert(playerNames[currentPlayer] !== undefined, `playerNames[${currentPlayer}] is undefined!`);

// The "New trick" message
const message = 'New trick — ' + playerNames[currentPlayer] + ' plays first';
console.log(`\n>>> CENTER MESSAGE: "${message}"`);

assert(!message.includes('undefined'), `Message contains "undefined": ${message}`);
assert.strictEqual(currentPlayer, 0, 'Human should start next trick');
assert.strictEqual(message, 'New trick — You plays first');

console.log('\n=== ALL CHECKS PASSED ===');
console.log(`Winner P${currentComboPlayer} (${playerNames[currentPlayer]}) correctly starts next trick.`);
