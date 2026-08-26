import { test, expect } from '@playwright/test';
import { makeServerState, injectCreated, injectState } from './helpers.js';

// Repro: "sort action is not persistent"
//
// Clicking Sort reorders the human hand, but the next `state` message from the
// server rebuilds the hand in DEAL ORDER (adaptState maps server hand
// verbatim). So the sort visually reverts the moment any status update lands.
test('sortHand order survives a subsequent state message', async ({ page }) => {
  await page.goto('/');
  // Deterministic hand for seat 0: a known, non-sorted deal order.
  const deal = [
    { rank: '7', suit: 'clubs' },     // c5_1
    { rank: 'A', suit: 'spades' },   // c11_3
    { rank: '3', suit: 'hearts' },   // c0_2
    { rank: 'K', suit: 'diamonds' }, // c10_0
    { rank: '5', suit: 'hearts' },   // c2_2
    { rank: '2', suit: 'spades' },   // c12_3
    { rank: 'Q', suit: 'clubs' },     // c9_1
    { rank: '4', suit: 'diamonds' }, // c1_0
    { rank: 'J', suit: 'hearts' },   // c8_2
    { rank: '9', suit: 'clubs' },     // c6_1
    { rank: '10', suit: 'diamonds' },// c7_0
    { rank: '6', suit: 'hearts' },   // c4_2
    { rank: '8', suit: 'clubs' },     // c6... wait dup rank ok
  ];
  const hs = [deal,
    [{ rank:'3',suit:'clubs'},{rank:'4',suit:'clubs'},{rank:'5',suit:'clubs'},{rank:'6',suit:'clubs'},{rank:'7',suit:'clubs'},{rank:'8',suit:'clubs'},{rank:'9',suit:'clubs'},{rank:'10',suit:'clubs'},{rank:'J',suit:'clubs'},{rank:'Q',suit:'clubs'},{rank:'K',suit:'clubs'},{rank:'A',suit:'clubs'},{rank:'2',suit:'clubs'}],
    [{ rank:'3',suit:'hearts'},{rank:'4',suit:'hearts'},{rank:'5',suit:'hearts'},{rank:'6',suit:'hearts'},{rank:'7',suit:'hearts'},{rank:'8',suit:'hearts'},{rank:'9',suit:'hearts'},{rank:'10',suit:'hearts'},{rank:'J',suit:'hearts'},{rank:'Q',suit:'hearts'},{rank:'K',suit:'hearts'},{rank:'A',suit:'hearts'},{rank:'2',suit:'hearts'}],
    [{ rank:'3',suit:'diamonds'},{rank:'4',suit:'diamonds'},{rank:'5',suit:'diamonds'},{rank:'6',suit:'diamonds'},{rank:'7',suit:'diamonds'},{rank:'8',suit:'diamonds'},{rank:'9',suit:'diamonds'},{rank:'10',suit:'diamonds'},{rank:'J',suit:'diamonds'},{rank:'Q',suit:'diamonds'},{rank:'K',suit:'diamonds'},{rank:'A',suit:'diamonds'},{rank:'2',suit:'diamonds'}]];
  const ss = makeServerState({ phase: 'playing', currentPlayer: 0, hands: hs, names: ['Me','Bot2','Bot3','Bot4'] });

  await injectCreated(page, ss, { playerId: 0, code: 'SORT01', token: 't' });
  await page.waitForSelector('#hand-0 .card', { timeout: 8000 });

  const order = () => page.evaluate(() =>
    [...document.querySelectorAll('#hand-0 .card')].map(c => c.dataset.key).join(','));

  const before = await order();
  // Sort
  await page.click('#btn-sort');
  await page.waitForTimeout(150);
  const sorted = await order();
  console.log('BEFORE:', before);
  console.log('SORTED:', sorted);
  console.log('sort changed order:', before !== sorted);

  // Server pushes a status update: same cards, same DEAL order (what the
  // server always sends). In real life this is a bot pass / my own play echo.
  const ss2 = makeServerState({ phase: 'playing', currentPlayer: 1, hands: hs, names: ['Me','Bot2','Bot3','Bot4'] });
  await injectState(page, ss2);
  await page.waitForTimeout(150);
  const after = await order();
  console.log('AFTER state msg:', after);

  expect(before !== sorted).toBe(true, 'sorting should actually reorder');
  expect(after === sorted).toBe(true, 'SORT ORDER SHOULD PERSIST across a state message (it reverts to deal order = the bug)');
});

// The flip side: a manual drag reorder must also persist — and it must NOT
// be snapped back to sorted by a later state message. Dragging is explicit
// intent and should override the sort preference.
test('manual drag reorder persists and is not re-sorted by a later state message', async ({ page }) => {
  await page.goto('/');
  const deal = [
    { rank: '7', suit: 'clubs' }, { rank: 'A', suit: 'spades' },
    { rank: '3', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' },
    { rank: '5', suit: 'hearts' }, { rank: '2', suit: 'spades' },
    { rank: 'Q', suit: 'clubs' }, { rank: '4', suit: 'diamonds' },
    { rank: 'J', suit: 'hearts' }, { rank: '9', suit: 'clubs' },
    { rank: '10', suit: 'diamonds' }, { rank: '6', suit: 'hearts' },
    { rank: '8', suit: 'clubs' },
  ];
  const hs = [deal,
    [{ rank:'3',suit:'clubs'},{rank:'4',suit:'clubs'},{rank:'5',suit:'clubs'},{rank:'6',suit:'clubs'},{rank:'7',suit:'clubs'},{rank:'8',suit:'clubs'},{rank:'9',suit:'clubs'},{rank:'10',suit:'clubs'},{rank:'J',suit:'clubs'},{rank:'Q',suit:'clubs'},{rank:'K',suit:'clubs'},{rank:'A',suit:'clubs'},{rank:'2',suit:'clubs'}],
    [{ rank:'3',suit:'hearts'},{rank:'4',suit:'hearts'},{rank:'5',suit:'hearts'},{rank:'6',suit:'hearts'},{rank:'7',suit:'hearts'},{rank:'8',suit:'hearts'},{rank:'9',suit:'hearts'},{rank:'10',suit:'hearts'},{rank:'J',suit:'hearts'},{rank:'Q',suit:'hearts'},{rank:'K',suit:'hearts'},{rank:'A',suit:'hearts'},{rank:'2',suit:'hearts'}],
    [{ rank:'3',suit:'diamonds'},{rank:'4',suit:'diamonds'},{rank:'5',suit:'diamonds'},{rank:'6',suit:'diamonds'},{rank:'7',suit:'diamonds'},{rank:'8',suit:'diamonds'},{rank:'9',suit:'diamonds'},{rank:'10',suit:'diamonds'},{rank:'J',suit:'diamonds'},{rank:'Q',suit:'diamonds'},{rank:'K',suit:'diamonds'},{rank:'A',suit:'diamonds'},{rank:'2',suit:'diamonds'}]];
  const ss = makeServerState({ phase: 'playing', currentPlayer: 0, hands: hs, names: ['Me','Bot2','Bot3','Bot4'] });
  await injectCreated(page, ss, { playerId: 0, code: 'SORT02', token: 't' });
  await page.waitForSelector('#hand-0 .card', { timeout: 8000 });

  // Sort first, so the sort preference is ON — this test proves a drag
  // overrides it.
  await page.click('#btn-sort');
  await page.waitForTimeout(150);

  const order = () => page.evaluate(() =>
    [...document.querySelectorAll('#hand-0 .card')].map(c => c.dataset.key).join(','));

  // Drag card at index 0 onto card at index 2.
  const src = await page.locator('#hand-0 .card').nth(0).boundingBox();
  const dst = await page.locator('#hand-0 .card').nth(2).boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + src.width / 2 + 8, src.y + src.height / 2, { steps: 3 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterDrag = await order();
  console.log('AFTER DRAG:', afterDrag);

  // Same server deal order lands again; the manual arrangement must survive.
  const ss2 = makeServerState({ phase: 'playing', currentPlayer: 1, hands: hs, names: ['Me','Bot2','Bot3','Bot4'] });
  await injectState(page, ss2);
  await page.waitForTimeout(150);
  const afterMsg = await order();
  console.log('AFTER state msg:', afterMsg);

  expect(afterDrag === afterMsg).toBe(true, 'manual drag order must persist across a state message');
});
