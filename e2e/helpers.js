// Shared helpers for Pocer E2E tests.
//
// Two driving modes:
//  1. Real server: create a room through the UI, let the Rust server deal.
//     Used for the happy-path lobby -> start flow.
//  2. Injected state: window.__app_injectMessage feeds synthetic server
//     messages (same dispatcher the WebSocket uses) so table rendering and
//     interaction logic can be tested deterministically, without bot timing.

const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = ['spades','hearts','diamonds','clubs'];

/** Deterministic n-card hand, no duplicates. */
export function makeHand(n, offset = 0) {
  const cards = [];
  for (let i = 0; i < n; i++) {
    const k = (offset + i) % 52;
    cards.push({ rank: RANKS[k % 13], suit: SUITS[Math.floor(k / 13)] });
  }
  return cards;
}

/** Build a full server-shaped GameState (camelCase, mirrors Rust GameState). */
export function makeServerState({
  phase = 'playing',
  currentPlayer = 0,
  hands = null,
  trick = null,
  scores = [0, 0, 0, 0],
  finishedOrder = [],
  names = ['Dodi', 'Bot 2', 'Bot 3', 'Bot 4'],
  threeDiscard = null,
} = {}) {
  const hs = hands || [makeHand(13, 0), makeHand(13, 13), makeHand(13, 26), makeHand(13, 39)];
  return {
    phase,
    players: names.map((name, i) => ({
      id: i,
      name,
      hand: hs[i],
      finished: false,
      isBot: i !== 0,
      connected: true,
      isCreator: i === 0,
    })),
    ready: [true, true, true, true],
    currentPlayer,
    trick: trick || { cards: [], comboType: null, comboPlayer: null, passed: [], played: [] },
    finishedOrder,
    scores,
    threeDiscard,
    log: [],
  };
}

/** Push a synthetic `state` message through the app's real dispatcher. */
export async function injectState(page, serverState) {
  await page.evaluate((s) => window.__app_injectMessage({ type: 'state', state: s }), serverState);
}

/** Push a synthetic `created` message (sets playerId + roomCode like the real flow). */
export async function injectCreated(page, serverState, { playerId = 0, code = 'TEST00', token = 't' } = {}) {
  await page.evaluate(({ s, playerId, code, token }) =>
    window.__app_injectMessage({ type: 'created', playerId, code, token, state: s }),
    { s: serverState, playerId, code, token });
}

/** Poll #table-area dataset.phase until it matches (set by the render hook). */
export async function waitForPhase(page, phase, timeout = 15_000) {
  await page.waitForFunction((p) => {
    const el = document.getElementById('table-area');
    return el && el.dataset.phase === p;
  }, phase, { timeout });
}

/** Wait until the app reports "connected" (real-server tests). */
export async function waitForConnected(page) {
  await page.waitForSelector('#connection-status.connected', { timeout: 10_000 });
}

/**
 * Real-server path: from the main menu, create a room named `name`.
 * Resolves once the party screen (room code) is visible.
 */
export async function createRoomViaUI(page, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.click('li.primary'); // New Game
  const nameInput = page.locator('#lobby-name-input');
  await nameInput.fill(name);
  await page.click('#lobby-screen-new .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
}

/** Real-server path: click Start Game and wait until the game leaves the lobby. */
export async function startGameViaUI(page) {
  await page.click('#party-start-btn');
  await page.waitForFunction(
    () => {
      const el = document.getElementById('table-area');
      return el && el.dataset.phase && el.dataset.phase !== 'lobby';
    },
    { timeout: 15_000 }
  );
}

/** Number of visible cards in the human hand (bottom player seat). */
export function humanCardCount(page) {
  return page.locator('.hand-bottom .card').count();
}
