// Mobile touch-gesture interactions for the human hand (bottom seat):
//  - tap selects / deselects a card (existing, regression under the new handler)
//  - swipe UP on a card = activate (select) it
//  - drag a card onto the center trick area = play it (drag & drop to play)
//  - drag a card onto another hand card = manual sort (regression, 07 too)
//
// All states are injected (helpers.js) so bot timing never interferes. For
// drag-to-play we spy on WebSocket.prototype.send to assert the exact play
// message the gesture produced (the injected room doesn't exist on the real
// server, so we verify the outgoing message, not a server echo).
import { test, expect } from '@playwright/test';
import {
  makeServerState, makeHand, injectCreated, waitForPhase, watch,
} from './helpers.js';

const hands = [
  makeHand(13, 0),
  makeHand(13, 13),
  makeHand(13, 26),
  makeHand(13, 39),
];

async function startTurn(page, serverState = makeServerState({ currentPlayer: 0, hands })) {
  await page.goto('/');
  await injectCreated(page, serverState);
  await waitForPhase(page, 'playing');
  await watch(page);
}

/** Record every outgoing WS message (JSON-parsed) on window.__sent. */
async function trackSends(page) {
  await page.evaluate(() => {
    window.__sent = [];
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { window.__sent.push(JSON.parse(data)); } catch { /* keep raw */ }
      return orig.call(this, data);
    };
  });
}

const sentPlays = (page) =>
  page.evaluate(() => (window.__sent || []).filter(m => m && m.type === 'play'));

// Center of a card's bounding box.
async function cardCenter(page, idx) {
  const box = await page.locator('#hand-0 .card').nth(idx).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('tap on own card still selects it (regression under the gesture handler)', async ({ page }) => {
  await startTurn(page);
  await page.locator('#hand-0 .card').first().click();
  await expect(page.locator('#hand-0 .card').first()).toHaveClass(/selected/);
  await expect(page.locator('#btn-play')).toBeEnabled();
  await expect(page.locator('#combo-preview')).not.toHaveText('');
  // Tap again -> deselect
  await page.locator('#hand-0 .card').first().click();
  await expect(page.locator('#hand-0 .card').first()).not.toHaveClass(/selected/);
});

test('swipe up on a card activates (selects) it', async ({ page }) => {
  await startTurn(page);
  const c = await cardCenter(page, 2);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  // Upward swipe: a few intermediate moves, ending well above the start.
  await page.mouse.move(c.x, c.y - 20, { steps: 2 });
  await page.mouse.move(c.x, c.y - 50, { steps: 3 });
  await page.mouse.up();
  await watch(page);
  await expect(page.locator('#hand-0 .card').nth(2)).toHaveClass(/selected/);
  await expect(page.locator('#btn-play')).toBeEnabled();
  await expect(page.locator('#combo-preview')).not.toHaveText('');
});

test('swipe down and sideways flicks do NOT select (no false positives)', async ({ page }) => {
  await startTurn(page);
  // Swipe DOWN from card 3.
  const down = await cardCenter(page, 3);
  await page.mouse.move(down.x, down.y);
  await page.mouse.down();
  await page.mouse.move(down.x, down.y + 30, { steps: 2 });
  await page.mouse.move(down.x, down.y + 55, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#hand-0 .card').nth(3)).not.toHaveClass(/selected/);

  // Sideways flick off the LAST card (released over empty space, so it can't
  // be read as a drop-on-card manual sort).
  const last = await cardCenter(page, 12);
  await page.mouse.move(last.x, last.y);
  await page.mouse.down();
  await page.mouse.move(last.x + 40, last.y + 2, { steps: 3 });
  await page.mouse.move(last.x + 90, last.y + 4, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#hand-0 .card').nth(12)).not.toHaveClass(/selected/);
  // Nothing selected at all -> Play stays disabled.
  await expect(page.locator('#btn-play')).toBeDisabled();
});

test('drag a card onto the center trick area plays it (drag & drop to play)', async ({ page }) => {
  await startTurn(page);
  await trackSends(page);

  const from = await cardCenter(page, 0);
  const zone = await page.locator('#center-cards').boundingBox();
  const to = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 24, { steps: 3 });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await watch(page);

  // The gesture sent exactly the dragged card (3♠ = first card of makeHand).
  const plays = await sentPlays(page);
  expect(plays).toHaveLength(1);
  expect(plays[0].cards).toEqual(['3:spades']);
});

test('drop zone highlights on your turn and while a card is held over it', async ({ page }) => {
  await startTurn(page);
  // My turn -> armed drop zone.
  await expect(page.locator('#center-cards')).toHaveClass(/play-dropzone/);

  const from = await cardCenter(page, 0);
  const zone = await page.locator('#center-cards').boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 24, { steps: 3 });
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 5 });
  // Held over the zone -> active glow while deciding where to drop.
  await expect(page.locator('#center-cards')).toHaveClass(/play-drop-active/);
  await page.mouse.up();
  // Released -> glow gone (the play itself is fine; we assert the highlight).
  await expect(page.locator('#center-cards')).not.toHaveClass(/play-drop-active/);
});

test('dropping an invalid card on the center shows the reason and plays nothing', async ({ page }) => {
  // Table has a Pair (K♠ Q♥ by bot 1); a single low card cannot beat it.
  const ss = makeServerState({
    currentPlayer: 0,
    hands,
    trick: {
      cards: [
        { rank: 'K', suit: 'spades' },
        { rank: 'Q', suit: 'hearts' },
      ],
      comboType: 'pair',
      comboPlayer: 1,
      passed: [],
      played: [1],
    },
  });
  await startTurn(page, ss);
  await trackSends(page);

  const from = await cardCenter(page, 0); // 3♠
  const zone = await page.locator('#center-cards').boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 24, { steps: 3 });
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 5 });
  await page.mouse.up();

  // Error surfaced in the table-center hint; no play message went out.
  await expect(page.locator('#error-msg')).toContainText('Must match');
  expect(await sentPlays(page)).toHaveLength(0);
});

test('mobile viewport: gestures armed on your turn', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone portrait
  await startTurn(page);

  // Drop zone armed on mobile while it's the human's turn.
  await expect(page.locator('#center-cards')).toHaveClass(/play-dropzone/);

  // Swipe-up works on mobile sizes too (cards are JS-scaled, ~20px tall).
  const c = await cardCenter(page, 1);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y - 18, { steps: 2 });
  await page.mouse.move(c.x, c.y - 40, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#hand-0 .card').nth(1)).toHaveClass(/selected/);

  // Drop zone disarms on the bot's turn.
  await page.evaluate((s) => window.__app_injectMessage({
    type: 'state',
    state: s,
  }), makeServerState({ currentPlayer: 1, hands }));
  await expect(page.locator('#center-cards')).not.toHaveClass(/play-dropzone/);
});

// Regression (drag flicker): a state frame arriving while a card is held
// down used to re-run performHandSizing() → change #table-area paddingBottom
// (action bar show/hide) → shift the grid row the hand sits in → the fan
// jumped under the pointer-tracked drag follower. The sizing pass must now
// be skipped for the whole duration of a drag, then re-apply on release.
test('drag is layout-stable across a mid-drag state frame (no flicker)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone portrait
  await startTurn(page);

  // Let the initial sizing pass (rAF) land so the baseline is the real one.
  await page.waitForTimeout(120);
  const padBefore = await page.evaluate(() =>
    getComputedStyle(document.getElementById('table-area')).paddingBottom);

  const from = await cardCenter(page, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 }); // arm the drag
  await page.waitForTimeout(50);

  // Capture the exact layout while the drag is live.
  const handBoxBefore = await page.locator('.hand-bottom').boundingBox();

  // The repro: a state frame while the finger is still down. Switching the
  // turn to a bot would hide the action bar (different bottom clearance) —
  // pre-fix that changed paddingBottom and repositioned the hand mid-drag.
  await page.evaluate((s) => window.__app_injectMessage({
    type: 'state',
    state: s,
  }), makeServerState({ currentPlayer: 1, hands }));
  await page.waitForTimeout(120); // let the rAF sizing pass run — it must skip

  // (1) The bottom clearance the fan is laid out against is untouched.
  const padDuring = await page.evaluate(() =>
    getComputedStyle(document.getElementById('table-area')).paddingBottom);
  expect(padDuring).toBe(padBefore);

  // (2) …and so is the hand's own position: the fan didn't jump under the
  //     pointer-tracked follower (that was the flicker).
  const handBoxDuring = await page.locator('.hand-bottom').boundingBox();
  expect(Math.abs(handBoxDuring.y - handBoxBefore.y)).toBeLessThan(1);
  expect(Math.abs(handBoxDuring.x - handBoxBefore.x)).toBeLessThan(1);

  // Release over the hand (no play) → sizing runs again. The clearance must
  // stay at the SAME value (the action bar keeps its layout box, so the bar
  // being hidden no longer changes it) and the fan must actually re-lay out —
  // the skip during the drag was temporary, not a stranded layout.
  const handRight = await page.locator('#hand-0 .card').nth(3).boundingBox();
  await page.mouse.move(handRight.x + handRight.width / 2, handRight.y + handRight.height / 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const padAfter = await page.evaluate(() =>
    getComputedStyle(document.getElementById('table-area')).paddingBottom);
  expect(padAfter).toBe(padBefore);
  // Fan re-laid out (not stuck on the last skipped pass): ready flag set and a
  // card carries an explicit fan position.
  const reflowed = await page.evaluate(() => {
    const hand = document.querySelector('.hand-bottom');
    const card = hand && hand.querySelector(':scope > .card');
    return { ready: !!(hand && hand.dataset.ready), cardLeft: card ? card.style.left : '' };
  });
  expect(reflowed.ready).toBe(true);
  expect(reflowed.cardLeft).not.toBe('');
});

// Regression (stale closure state): the card DOM nodes are born on the first
// render, so their drag handlers close over THAT frame's state object. A
// later server frame replaces `state` with a fresh object — a drag release
// that read the closure `state` spliced the stale deal-order hand and called
// render(staleState). If the deal-time frame was a bot's turn, that stale
// render hid the action bar AND snapped the fan back to deal order —
// "click Sort, drag a card, everything resets and the bar vanishes."
test('manual sort drag after frames keeps hand order and action bar (stale state)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone portrait
  // Deal-time frame is a BOT's turn (Bot 2 leads trick 1): the human's card
  // nodes are created while holding this state in their gesture closures.
  await startTurn(page, makeServerState({ currentPlayer: 1, hands }));

  // My turn arrives: a fresh state object; the bar must show.
  await page.evaluate((s) => window.__app_injectMessage({ type: 'state', state: s }),
    makeServerState({ currentPlayer: 0, hands }));
  await expect(page.locator('#action-bar')).toHaveClass(/visible/);
  const dealOrder = await page.evaluate(() =>
    window.__app_getState().hands[0].map(c => c.rank + c.suit));

  // Click Sort, then let another frame land (the sticky order must survive).
  await page.locator('#btn-sort').click();
  await page.evaluate((s) => window.__app_injectMessage({ type: 'state', state: s }),
    makeServerState({ currentPlayer: 0, hands }));
  await page.waitForTimeout(120);
  const sorted = await page.evaluate(() =>
    window.__app_getState().hands[0].map(c => c.rank + c.suit));
  expect(sorted.join()).not.toBe(dealOrder.join());

  // Manual drag: card at index 0 -> slot 3.
  const from = await cardCenter(page, 0);
  const to = await cardCenter(page, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6, { steps: 2 });
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  // The bar must still be mine: the release re-renders the LIVE state (my
  // turn), not the stale deal-time frame (bot's turn).
  await expect(page.locator('#action-bar')).toHaveClass(/visible/);
  const barOpacity = await page.evaluate(() =>
    getComputedStyle(document.getElementById('action-bar')).opacity);
  expect(barOpacity).toBe('1');

  // And the hand is the sorted order with card 0 moved to slot 3 — NOT the
  // deal order (which would mean the stale state was re-rendered).
  const after = await page.evaluate(() =>
    window.__app_getState().hands[0].map(c => c.rank + c.suit));
  // No cards lost (it's a permutation of the same 13).
  expect(after.slice().sort().join()).toBe(sorted.slice().sort().join());
  // The release re-rendered the LIVE state, not the stale deal-time frame:
  // the hand is NOT back in deal order…
  expect(after.join()).not.toBe(dealOrder.join());
  // …and the manual drag actually took effect (hand != the pre-drag sorted
  // order — the move wasn't silently discarded by a stale-state render).
  expect(after.join()).not.toBe(sorted.join());
  await watch(page);
});
