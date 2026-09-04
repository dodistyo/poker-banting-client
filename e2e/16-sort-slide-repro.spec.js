// Slide-to-play × Sort interaction (bug report 2026-09-04):
//   "slide to play works, but after tapping Sort in the action bar, slide no
//    longer works" + "slide should also work when the card tricks (yellow
//    group) are active — the active cards should be grouped".
//
// Root cause found while reproing — BOTH complaints were one bug:
//   * sortHand() called clearSelections(), so a tap on Sort erased the
//     user's yellow group; every later slide then played a single card,
//     which loses to a table combo → "slide ga works".
//   * dragPlay() only ever sent the OTHER selected cards (it dropped the
//     swiped card when it was selected), so a slide could never carry the
//     whole active group → "slide cuma bisa buat single card".
//
// Harness notes:
//   * Tapping Sort is purely client-side — the server only broadcasts state
//     on play/pass/join events, so NO state frame lands during the human's
//     turn. Tests therefore never re-inject state mid-turn (a fresh frame
//     would reset the in-memory sort and wipe `selected` via adaptState —
//     correct server behaviour, but not part of this flow).
//   * The human hand is deliberately NOT in sorted deal order (13 spades in
//     3..2 order, which helpers.js hands use, is already sorted by rank —
//     a no-op sort would not prove anything). The 5♠6♠7♠ trio is a valid
//     lead straight to drive the yellow-group test.
import { test, expect } from '@playwright/test';
import {
  makeServerState, makeHand, injectCreated, waitForPhase,
} from './helpers.js';

const HUMAN_HAND = [
  { rank: '5', suit: 'spades' },
  { rank: '6', suit: 'spades' },
  { rank: '7', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
  { rank: '3', suit: 'diamonds' },
  { rank: '10', suit: 'clubs' },
  { rank: 'A', suit: 'hearts' },
  { rank: '9', suit: 'diamonds' },
  { rank: 'J', suit: 'clubs' },
  { rank: '4', suit: 'hearts' },
  { rank: 'Q', suit: 'spades' },
  { rank: '8', suit: 'diamonds' },
  { rank: '2', suit: 'clubs' },
];

const hands = [
  HUMAN_HAND,
  makeHand(13, 13),
  makeHand(13, 26),
  makeHand(13, 39),
];

const SUIT_SYM = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/** Convert a DOM card label like "3♠" -> "3:spades". */
function labelToId(label) {
  const m = label.trim().match(/^([3-9]|10|J|Q|K|A|2)([♠♥♦♣])$/);
  if (!m) return null;
  const sym2suit = Object.fromEntries(Object.entries(SUIT_SYM).map(([s, x]) => [x, s]));
  return `${m[1]}:${sym2suit[m[2]]}`;
}

async function startTurn(page) {
  await page.goto('/');
  await injectCreated(page, makeServerState({ currentPlayer: 0, hands }));
  await waitForPhase(page, 'playing');
  await page.waitForTimeout(250); // let the fan sizing pass settle
}

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

/**
 * The card at the leftmost fan position (DOM order = fan order, left to
 * right — the proven pattern from 12-touch-gestures): its center + its
 * label, so the assertion follows the geometry.
 */
async function leftmostCard(page) {
  return page.evaluate(() => {
    const c = document.querySelectorAll('#hand-0 .card')[0];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: (c.textContent || '').trim() };
  });
}

// y where the pointer-centered dragged card has fully exited the active box
// (top edge crosses the seat's top border gate) — fires the play mid-gesture.
async function aboveBoxTopY(page) {
  const seat = await page.locator('#player-0').boundingBox();
  const cardH = await page.evaluate(() =>
    document.querySelector('#hand-0 .card').getBoundingClientRect().height);
  return seat.y - cardH / 2 - 12;
}

/** Swipe the card centered at (x,y) out of the active box (the play gesture). */
async function swipeOut(page, x, y) {
  const exitY = await aboveBoxTopY(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, (y + exitY) / 2, { steps: 3 });
  await page.mouse.move(x, exitY, { steps: 3 });
  await page.mouse.up();
}

test('slide-to-play still works after tapping sort', async ({ page }) => {
  await startTurn(page);
  await trackSends(page);

  // 1) Baseline: plain swipe of the leftmost card plays exactly that card.
  let c = await leftmostCard(page);
  expect(c, 'no leftmost card found').toBeTruthy();
  const firstLabel = c.label;
  await swipeOut(page, c.x, c.y);
  await expect.poll(() => sentPlays(page).then(p => p.length)).toBe(1);
  expect((await sentPlays(page))[0].cards).toEqual([labelToId(firstLabel)]);

  // 2) Tap Sort — purely client-side, no state frame lands. The gesture must
  //    keep working afterward.
  await expect(page.locator('#btn-sort')).toBeEnabled();
  await page.locator('#btn-sort').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#action-bar')).toHaveClass(/visible/);

  // The sort really happened: client state order changed vs deal order.
  const sortedNow = await page.evaluate(() =>
    window.__app_getState().hands[0].map(x => x.rank + x.suit).join(','));
  const dealOrder = HUMAN_HAND.map(x => x.rank + x.suit).join(',');
  expect(sortedNow).not.toBe(dealOrder);

  // Slide again: whatever card is leftmost now, it plays.
  c = await leftmostCard(page);
  expect(c, 'no leftmost card after sort').toBeTruthy();
  await swipeOut(page, c.x, c.y);
  await expect.poll(() => sentPlays(page).then(p => p.length)).toBe(2);
  expect((await sentPlays(page))[1].cards).toEqual([labelToId(c.label)]);
});

test('yellow group survives sort; sliding plays the WHOLE group', async ({ page }) => {
  await startTurn(page);
  await trackSends(page);

  // Build the active (yellow) group: 5♠ 6♠ 7♠ = a valid lead straight.
  // Click by data-key (rank+suit derived in render.js) so the fan rotation
  // can't mis-target a neighbour.
  for (const key of ['c2_3', 'c3_3', 'c4_3']) {
    await page.locator(`#hand-0 .card[data-key="${key}"]`).click();
  }
  await expect(page.locator('#hand-0 .card.selected')).toHaveCount(3);

  // Tap Sort — the group must STAY active (pre-fix: clearSelections() wiped
  // it, so the next slide played one card and lost to the table).
  await page.locator('#btn-sort').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#hand-0 .card.selected'),
    'yellow group must survive Sort').toHaveCount(3);

  // Slide a yellow card (wherever the sort put it) → the WHOLE group plays
  // (pre-fix this sent the OTHER two selected cards only). In a fanned,
  // overlapping hand the RIGHTMOST card sits on top (highest z), so it is
  // always the one the pointer can actually grab.
  const target = await page.evaluate(() => {
    const selected = [...document.querySelectorAll('#hand-0 .card.selected')];
    if (!selected.length) return null;
    let top = selected[0], topLeft = -Infinity;
    for (const c of selected) {
      const r = c.getBoundingClientRect();
      if (r.left > topLeft) { top = c; topLeft = r.left; }
    }
    const r = top.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(target, 'a yellow card must exist after sort').toBeTruthy();

  await swipeOut(page, target.x, target.y);
  await expect.poll(() => sentPlays(page).then(p => p.length)).toBe(1);
  const plays = await sentPlays(page);
  expect(plays[0].cards.slice().sort()).toEqual(['5:spades', '6:spades', '7:spades']);

  // No error was surfaced (the group is a legal lead straight).
  await expect(page.locator('#error-msg')).toHaveText('');
});
