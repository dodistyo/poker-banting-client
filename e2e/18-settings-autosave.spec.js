// Room settings are applied automatically — no Save button (2026-09-06).
// The host edits a value in the waiting room and it must reach the server
// (and hence every client in the room) on change, not on a button click.
import { test, expect } from '@playwright/test';
import { waitForConnected, watch } from './helpers.js';

async function createRoomViaUI(page, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.click('li.primary');
  await page.locator('#lobby-name-input').fill(name);
  await page.click('#lobby-screen-new .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
  return (await page.locator('#party-code').textContent()).trim();
}

async function joinRoomViaUI(page, code, name) {
  await page.goto('/');
  await waitForConnected(page);
  await page.locator('li', { hasText: 'Join Game' }).click();
  await page.locator('#lobby-join-name-input').fill(name);
  await page.locator('#lobby-code-input').fill(code);
  await page.click('#lobby-screen-join .lobby-submit-btn');
  await page.waitForSelector('#lobby-screen-party.active #party-code', { timeout: 10_000 });
}

test('settings auto-apply per room on change — no Save button', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(); // host
  const pageB = await ctxB.newPage(); // guest

  const code = await createRoomViaUI(pageA, 'Dodi');
  await joinRoomViaUI(pageB, code, 'Olivia');
  await watch(pageA, 800);

  // The Save button must not exist at all — applying is automatic.
  await expect(pageA.locator('#party-settings-save-btn')).toHaveCount(0);

  // Baseline defaults: 10s play limit, 50 winning point.
  const stateB0 = await pageB.evaluate(() => window.__app_getState());
  expect(stateB0.playLimitSecs).toBe(10);
  expect(stateB0.winningPoint).toBe(50);

  // Host types a play limit — no click on anything else.
  await pageA.locator('#party-setting-play-limit').fill('25');

  // The GUEST's state must pick up 25 via the server echo.
  await expect
    .poll(() => pageB.evaluate(() => window.__app_getState().playLimitSecs), { timeout: 10_000 })
    .toBe(25);

  // Partial update: winning point must be untouched.
  const stateB1 = await pageB.evaluate(() => window.__app_getState());
  expect(stateB1.winningPoint).toBe(50);

  // Host types a winning point — auto-applied too.
  await pageA.locator('#party-setting-winning-point').fill('77');
  await expect
    .poll(() => pageB.evaluate(() => window.__app_getState().winningPoint), { timeout: 10_000 })
    .toBe(77);

  // Out-of-range input must not propagate (server rejects it).
  await pageA.locator('#party-setting-play-limit').fill('999');
  await watch(pageA, 1500);
  expect(await pageB.evaluate(() => window.__app_getState().playLimitSecs)).toBe(25);
  await pageA.locator('#party-setting-play-limit').fill('25');
});
