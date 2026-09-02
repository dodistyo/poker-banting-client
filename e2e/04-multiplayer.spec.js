// True two-client multiplayer over the REAL Rust server.
//
// Two independent browser contexts (= two browser profiles) so localStorage
// is isolated: page B must join as a NEW player via the room code, not
// auto-rejoin page A's session.
//
// Core case: A creates, B joins with the code, B readies up, A starts, and
// BOTH clients land in the playing phase with their own dealt hands.
import { test, expect } from '@playwright/test';
import { waitForConnected, waitForPhase, watch } from './helpers.js';

async function joinRoomViaUI(page, code, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.locator('li', { hasText: 'Join Game' }).click();
  await page.locator('#lobby-join-name-input').fill(name);
  await page.locator('#lobby-code-input').fill(code);
  await page.click('#lobby-screen-join .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
}

/** True once this page's own hand is dealt (9..13 cards, no rank "3"). */
async function ownHandDealt(page) {
  return page.evaluate(() => {
    const s = window.__app_getState();
    if (!s || !Array.isArray(s.hands) || s.hands.length !== 4) return false;
    const pid = window.__app_getPlayerId?.() ?? 0;
    const hand = s.hands[pid] || [];
    return hand.length >= 9 && hand.length <= 13 && !hand.some(c => c.rank === '3');
  });
}

test('two real clients share one room: create, join, ready, play', async ({ browser }) => {
  // Two profiles -> isolated localStorage.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // --- A creates the room via the real UI ---
  await pageA.goto('/');
  await waitForConnected(pageA);
  await pageA.click('li.primary'); // New Game
  await pageA.locator('#lobby-name-input').fill('Dodi');
  await pageA.click('#lobby-screen-new .lobby-submit-btn');
  await pageA.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
  const code = (await pageA.locator('#party-code').textContent()).trim();
  await expect(pageA.locator('#party-code')).toHaveText(/^[A-Z0-9]{6}$/);

  // --- B joins with the code (fresh profile: no stored session) ---
  await joinRoomViaUI(pageB, code, 'Olivia');
  await expect(pageB.locator('#party-code')).toHaveText(code);
  await watch(pageB, 2000); // viewer: two people now in the waiting room

  // Both waiting rooms agree: Dodi AND Olivia are in the room
  for (const [page, who] of [[pageA, 'A'], [pageB, 'B']]) {
    const list = page.locator('#party-player-list tbody tr');
    await expect(list, `client ${who} player list`).toHaveCount(2);
    await expect(page.locator(`#party-player-list >> text=Dodi`)).toHaveCount(1);
    await expect(page.locator(`#party-player-list >> text=Olivia`)).toHaveCount(1);
  }

  // --- B must be ready before the host can start (server enforces
  // all_human_ready). Host is auto-ready on create. ---
  await pageB.click('#party-ready-btn');
  await watch(pageB, 1500); // viewer: B flags ready in the waiting room

  // --- Host (A) starts; both clients must land in the play phase ---
  await pageA.click('#party-start-btn');
  await expect(pageA.locator('#lobby-overlay')).toBeHidden();
  await waitForPhase(pageA, 'playing');
  await waitForPhase(pageB, 'playing');
  await expect(ownHandDealt(pageA)).resolves.toBe(true);
  await expect(ownHandDealt(pageB)).resolves.toBe(true);
  await watch(pageA, 2500); // viewer: the table with two humans + two bots

  // Both drawers carry the same room code
  await pageA.click('#menu-toggle-btn');
  await expect(pageA.locator('#menu-drawer-code')).toHaveText(code);
  await pageA.keyboard.press('Escape');
  await pageB.click('#menu-toggle-btn');
  await expect(pageB.locator('#menu-drawer-code')).toHaveText(code);

  await ctxA.close();
  await ctxB.close();
});
