// Public room browse + join over the REAL Rust server.
//
// Browse is a dedicated lobby screen (same navigation pattern as New Game /
// Join Game — a back icon, not the main menu), so this test also guards the
// screen switching: main -> browse -> join.
//
// The server route is /rooms (no /api prefix): the client's dev proxy strips
// the /api prefix before forwarding, so /api/rooms 404s and the list renders
// empty.
//
// Flow: profile A creates a PUBLIC room via the UI (public toggle on). A
// fresh profile B opens the app, hits "Browse Public Rooms", sees A's room
// listed with its code, clicks Join, and lands in A's room (both names
// appear in the waiting room).
import { test, expect } from '@playwright/test';
import { waitForConnected, watch } from './helpers.js';

async function createPublicRoom(page, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.click('li.primary'); // New Game
  await page.locator('#lobby-name-input').fill(name);
  // Public toggle defaults to checked; make it explicit.
  const toggle = page.locator('#lobby-public-toggle');
  if (!(await toggle.isChecked())) await toggle.check();
  await page.click('#lobby-screen-new .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
  return (await page.locator('#party-code').textContent()).trim();
}

test('browse public rooms shows a created room, and join works', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // --- A creates a public room ---
  const code = await createPublicRoom(pageA, 'Dodi');
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  // --- B (fresh profile) opens the dedicated browse screen ---
  await pageB.goto('/');
  await waitForConnected(pageB);
  // "Browse Public Rooms" switches to the browse screen AND fetches live.
  await pageB.locator('li', { hasText: 'Browse Public Rooms' }).click();
  await expect(pageB.locator('#lobby-screen-browse')).toHaveClass(/active/);
  await expect(pageB.locator('#lobby-screen-main')).not.toHaveClass(/active/);

  // A's room appears with its code, hosted by Dodi.
  const roomRow = pageB.locator('#lobby-room-list .room-item', { hasText: code });
  await expect(roomRow).toHaveCount(1, 'created room must be visible in the browse list');
  await expect(roomRow).toContainText('Dodi');
  await expect(roomRow).toContainText(`1/4 players`);

  // Refresh re-fetches the list (button binding + endpoint still healthy).
  await pageB.locator('.room-refresh-btn').click();
  await expect(pageB.locator('#lobby-room-list .room-item', { hasText: code })).toHaveCount(1, { timeout: 5_000 });

  // --- B joins A's room by clicking the row's Join button ---
  await roomRow.locator('.room-join-btn').click();
  // Join flow needs B's name (prefilled with an animal name) — submit.
  await expect(pageB.locator('#lobby-screen-join.active #lobby-code-input')).toHaveValue(code, { timeout: 5_000 });
  await pageB.click('#lobby-screen-join .lobby-submit-btn');
  await pageB.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
  await expect(pageB.locator('#party-code')).toHaveText(code);
  await watch(pageB, 1500);

  // Both waiting rooms agree: Dodi AND B's (animal) name are present.
  for (const [page, who] of [[pageA, 'A'], [pageB, 'B']]) {
    const list = page.locator('#party-player-list tbody tr');
    await expect(list, `client ${who} player list`).toHaveCount(2);
    await expect(page.locator(`#party-player-list >> text=Dodi`)).toHaveCount(1);
  }

  await ctxA.close();
  await ctxB.close();
});
