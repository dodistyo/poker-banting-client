// Multi-window (PWA + mobile browser) rejoin: both windows share one
// localStorage, so they hold the SAME session token. Server rule: one
// token = one seat, so while window A is connected, window B's rejoin of
// the same seat must fail with a clear "in use" hint — WITHOUT clearing
// the shared session. Once A gives up the seat (tab closed, not a Leave
// click — that's the real PWA-killed flow), B's rejoin succeeds.
// Cross-window session changes also sync via the `storage` event so the
// Rejoin item can't go stale in the other tab.
import { test, expect } from '@playwright/test';
import { waitForConnected, createRoomViaUI, startGameViaUI } from './helpers.js';

const rejoinItem = (page) => page.locator('#lobby-rejoin-item');

test('seat in use by another window: clear error, session survives, rejoin works after release', async ({ context }) => {
  // --- Window A: real room, game started, A connected on its seat.
  const tabA = await context.newPage();
  await createRoomViaUI(tabA, 'Dodi');
  await startGameViaUI(tabA);

  // --- Window B: same browser context = shared localStorage. Fresh load
  // --- sees the saved session and offers the manual Rejoin item. The
  // --- CheckRoom probe answers found=true (room alive) so the session
  // --- is NOT proactively cleared.
  const tabB = await context.newPage();
  await tabB.goto('/');
  await waitForConnected(tabB);
  await expect(rejoinItem(tabB)).toBeVisible();

  // Click Rejoin while A is STILL connected on the seat: the server answers
  // "Seat already in use by another window". The client must (1) show that
  // hint, (2) keep the session (NOT clear it — that was the old behavior),
  // (3) keep the Rejoin item visible so the user can retry.
  await rejoinItem(tabB).click();
  await expect(tabB.locator('#lobby-error')).toHaveText(/in use/i, { timeout: 10_000 });
  await expect(
    tabB.evaluate(() => localStorage.getItem('poker-banting_session'))
  ).not.toBeNull();
  await expect(rejoinItem(tabB)).toBeVisible();

  // --- Window A is KILLED (tab closed, no Leave click): the socket dies,
  // --- the server marks the seat disconnected, the shared session stays.
  await tabA.close();
  await tabB.waitForTimeout(1500); // let the server register the disconnect

  // Window B clicks Rejoin again -> succeeds: same seat, same name, back on
  // the table. (No reload of B: its socket is already connected.)
  await rejoinItem(tabB).click();
  await tabB.waitForFunction(
    () => {
      const el = document.getElementById('table-area');
      return el && el.dataset.phase && el.dataset.phase !== 'lobby';
    },
    { timeout: 15_000 }
  );
  const myName = await tabB.evaluate(() => {
    const s = window.__app_getState();
    const pid = window.__app_getPlayerId?.() ?? 0;
    return s?.players?.[pid]?.name;
  });
  expect(myName).toBe('Dodi');

  await tabB.close();
});

test('storage event: session cleared in another window hides the Rejoin item here', async ({ context }) => {
  // Window A: real room + started game, then reload: the seat goes
  // disconnected, the session persists, and the probe answers found=true
  // (room alive) so the Rejoin item stays.
  const tabA = await context.newPage();
  await createRoomViaUI(tabA, 'Dodi');
  await startGameViaUI(tabA);
  await tabA.reload();
  await waitForConnected(tabA);
  await expect(rejoinItem(tabA)).toBeVisible();

  // Window B shares the session too: its item is visible as well.
  const tabB = await context.newPage();
  await tabB.goto('/');
  await waitForConnected(tabB);
  await expect(rejoinItem(tabB)).toBeVisible();

  // B clears the session (e.g. it hit the stale-session path). The `storage`
  // event fires in A — not in B, which made the change — and A's item must
  // hide without a reload.
  await tabB.evaluate(() => localStorage.removeItem('poker-banting_session'));
  await expect(rejoinItem(tabA)).toBeHidden({ timeout: 5_000 });

  await tabA.close();
  await tabB.close();
});
