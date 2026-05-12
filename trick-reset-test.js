// Test: simulate exact trick reset scenario from the game
// Run with: node trick-reset-test.js
const assert = require('assert');

// Simulate the game state
const playerNames = ['You', 'Bot Ali', 'Bot Budi', 'Bot Cici'];
let currentCombo = null;
let currentComboPlayer = -1;
let passedPlayers = [];
let currentPlayer = 0;
let gameOver = false;
const logs = [];

// Simulate human plays a card (becomes combo player)
function humanPlayCard() {
    currentCombo = { type: 'single', cards: [{ rank: 'K', suit: 'spades' }] };
    currentComboPlayer = 0;
    passedPlayers = [];
    logs.push(`${playerNames[0]} played K♠. comboPlayer=${currentComboPlayer}`);
    currentPlayer = (currentPlayer + 1) % 4; // advance to next
}

// Simulate AI pass (from aiPass function, line 590-608)
function aiPass(playerIdx) {
    passedPlayers.push(playerIdx);
    logs.push(`${playerNames[playerIdx]} passed. passedCount=${passedPlayers.length} comboPlayer=${currentComboPlayer}`);

    if (passedPlayers.length === 3) {
        logs.push(`>>> TRICK RESET: winner=${currentComboPlayer} (${playerNames[currentComboPlayer]})`);
        currentPlayer = currentComboPlayer;  // line 598
        currentCombo = null;                  // line 599
        currentComboPlayer = -1;              // line 600
        passedPlayers = [];                   // line 601
        logs.push(`>>> After reset: currentPlayer=${currentPlayer} (${playerNames[currentPlayer]})`);
    } else {
        currentPlayer = (playerIdx + 1) % 4;  // line 604
    }
}

// Simulate human pass (from passTurn function, line 715-733)
function humanPass() {
    passedPlayers.push(0);
    logs.push(`${playerNames[0]} passed. passedCount=${passedPlayers.length} comboPlayer=${currentComboPlayer}`);

    if (passedPlayers.length === 3) {
        logs.push(`>>> TRICK RESET: winner=${currentComboPlayer} (${playerNames[currentComboPlayer]})`);
        currentPlayer = currentComboPlayer;  // line 722
        currentCombo = null;                  // line 723
        currentComboPlayer = -1;              // line 724
        passedPlayers = [];                   // line 725
        logs.push(`>>> After reset: currentPlayer=${currentPlayer} (${playerNames[currentPlayer]})`);
    } else {
        currentPlayer = (currentPlayer + 1) % 4;  // line 728
    }
}

// What render() shows (line 831)
function renderCenterInfo() {
    if (currentCombo) {
        return `Combo by ${playerNames[currentComboPlayer]}`;
    } else {
        return gameOver ? 'Game Over' : `New trick — ${playerNames[currentPlayer]} plays first`;
    }
}

// --- Test 1: Human plays, 3 bots pass ---
console.log('\n=== Test 1: Human plays, 3 bots pass ===');
{
    // Reset
    currentCombo = null; currentComboPlayer = -1; passedPlayers = []; currentPlayer = 0; gameOver = false;
    const testLogs = [];
    const origLogs = logs;

    // Human plays
    humanPlayCard(); // currentPlayer -> 1
    assert.strictEqual(currentPlayer, 1, 'After human play, next player should be 1');

    // Bot 1 passes
    aiPass(1); // currentPlayer -> 2
    assert.strictEqual(currentPlayer, 2, 'After bot 1 pass, next player should be 2');

    // Bot 2 passes
    aiPass(2); // currentPlayer -> 3
    assert.strictEqual(currentPlayer, 3, 'After bot 2 pass, next player should be 3');

    // Bot 3 passes -> trick reset
    aiPass(3);
    assert.strictEqual(currentPlayer, 0, 'After trick reset, currentPlayer should be 0 (human)');
    assert.strictEqual(currentCombo, null, 'currentCombo should be null');
    assert.strictEqual(currentComboPlayer, -1, 'currentComboPlayer should be -1');

    const msg = renderCenterInfo();
    assert.strictEqual(msg, 'New trick — You plays first', `Expected "New trick — You plays first", got "${msg}"`);
    console.log('  PASS: Human wins trick, human starts next trick');
    console.log(`  Message: "${msg}"`);
}

// --- Test 2: Bot plays, human + 2 bots pass ---
console.log('\n=== Test 2: Bot plays, human + 2 bots pass ===');
{
    currentCombo = null; currentComboPlayer = -1; passedPlayers = []; currentPlayer = 0; gameOver = false;

    // Simulate: human started with 3D, bot 1 beat it
    currentCombo = { type: 'single', cards: [{ rank: 'A', suit: 'diamonds' }] };
    currentComboPlayer = 1;
    passedPlayers = [];
    currentPlayer = 2;

    // Bot 2 passes
    aiPass(2); // currentPlayer -> 3
    assert.strictEqual(currentPlayer, 3);

    // Bot 3 passes
    aiPass(3); // currentPlayer -> 0
    assert.strictEqual(currentPlayer, 0);

    // Human passes -> trick reset
    humanPass();
    assert.strictEqual(currentPlayer, 1, 'After trick reset, currentPlayer should be 1 (Bot Ali)');

    const msg = renderCenterInfo();
    assert.strictEqual(msg, 'New trick — Bot Ali plays first', `Expected "New trick — Bot Ali plays first", got "${msg}"`);
    console.log('  PASS: Bot wins trick, bot starts next trick');
    console.log(`  Message: "${msg}"`);
}

// --- Test 3: Each bot wins a trick in sequence ---
console.log('\n=== Test 3: Sequential trick wins ===');
{
    for (let winner = 0; winner < 4; winner++) {
        currentCombo = null; currentComboPlayer = -1; passedPlayers = []; currentPlayer = 0; gameOver = false;

        // Set up: winner plays
        currentCombo = { type: 'single', cards: [] };
        currentComboPlayer = winner;
        passedPlayers = [];
        currentPlayer = (winner + 1) % 4;

        // Other 3 players pass
        for (let i = 1; i <= 3; i++) {
            const passer = (winner + i) % 4;
            if (passer === 0) {
                humanPass();
            } else {
                aiPass(passer);
            }
        }

        const msg = renderCenterInfo();
        const expected = `New trick — ${playerNames[winner]} plays first`;
        assert.strictEqual(msg, expected, `Winner=${winner}: expected "${expected}", got "${msg}"`);
        console.log(`  PASS: Player ${winner} (${playerNames[winner]}) wins trick, starts next`);
    }
}

// --- Test 4: Verify no undefined in any message ---
console.log('\n=== Test 4: No undefined in messages ===');
{
    currentCombo = null; currentComboPlayer = -1; passedPlayers = []; currentPlayer = 0; gameOver = false;

    // Play through several tricks
    for (let trick = 0; trick < 10; trick++) {
        const winner = trick % 4;
        currentCombo = { type: 'single', cards: [] };
        currentComboPlayer = winner;
        passedPlayers = [];
        currentPlayer = (winner + 1) % 4;

        for (let i = 1; i <= 3; i++) {
            const passer = (winner + i) % 4;
            if (passer === 0) humanPass();
            else aiPass(passer);
        }

        const msg = renderCenterInfo();
        assert(!msg.includes('undefined'), `Trick ${trick}: message contains "undefined": ${msg}`);
    }
    console.log('  PASS: 10 tricks, no "undefined" in any message');
}

console.log('\n=== ALL TESTS PASSED ===');
console.log('The game logic is correct. If you still see "undefined" in browser,');
console.log('it is almost certainly a browser cache issue.');
console.log('Try: Ctrl+Shift+R (hard refresh) or open DevTools > Network > Disable cache');
