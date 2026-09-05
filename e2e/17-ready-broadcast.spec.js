// Ready status broadcast (bug report 2026-09-04): when the OTHER player
// presses Ready in the waiting room, the ROOM CREATOR's view did not update
// the player's status.
//
// Root cause (server, ws.rs): the `Ready` handler answered `playerReady`
// ONLY to the toggling player's own socket (ws_tx.send), while every other
// room event (start, play, ...) goes out through rooms.broadcast(). The
// creator's client never received the message — its playerReady handler and
// the waiting-room chip render were always correct.
//
// This test drives the real UI end-to-end: two browser profiles (isolated
// localStorage), A creates, B joins, B clicks Ready, and the CREATOR'S
// waiting-room chip for B must flip to "Ready" without any reload.
import { test, expect } from '@playwright/test';
import { waitForConnected, watch } from './helpers.js';

async function joinRoomViaUI(page, code, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.locator('li', { hasText: 'Join Game' }).click();
  await page.locator('#lobby-join-name-input').fill(name);
  await page.locator('#lobby-code-input').fill(code);
  await page.click('#lobby-screen-join .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
}

// The status chip text shown for `name` in a page's waiting-room list.
const chipFor = (page, name) =>
  page.locator('#party-player-list tbody tr', { hasText: name }).locator('span');

test('creator sees the other player\'s ready status update live', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(); // creator
  const pageB = await ctxB.newPage(); // the other player

  // --- A creates the room ---
  await pageA.goto('/');
  await waitForConnected(pageA);
  await pageA.click('li.primary');
  await pageA.locator('#lobby-name-input').fill('Dodi');
  await pageA.click('#lobby-screen-new .lobby-submit-btn');
  await pageA.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
  const code = (await pageA.locator('#party-code').textContent()).trim();

  // --- B joins with the code ---
  await joinRoomViaUI(pageB, code, 'Olivia');
  await watch(pageA, 1000); // creator's waiting room now lists Olivia

  // Baseline: creator's view of Olivia is NOT ready yet.
  const chip = chipFor(pageA, 'Olivia');
  await expect(chip).toHaveText(/Not Ready/i, { timeout: 10_000 });

  // --- B presses Ready (no reload anywhere) ---
  await pageB.click('#party-ready-btn');
  await watch(pageB, 500);

  // The CREATOR's chip for Olivia must flip to Ready — this is the whole bug.
  await expect(chip, 'creator view of Olivia after Ready').toHaveText(/Ready/i, { timeout: 10_000 });
  await expect(chip).not.toHaveText(/Not Ready/i);

  // And B's own button reflects the toggle too (sanity).
  await expect(pageB.locator('#party-ready-btn')).toHaveText('Cancel');

  // Toggle back: creator must see "Not Ready" again.
  await pageB.click('#party-ready-btn');
  await expect(chip, 'creator view after cancel').toHaveText(/Not Ready/i, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
