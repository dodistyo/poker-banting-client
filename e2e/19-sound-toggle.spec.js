// 19-sound-toggle.spec.js — mute toggle in the menu drawer + persistence.
//
// Audio output is not observable headless (no output device), so this spec
// asserts the CONTRACT around the sound module:
//   1. the drawer exposes a Sound row, default state ON (unmuted)
//   2. toggling flips the visible state and persists `pocer-sound-muted`
//   3. a fresh page boot restores the persisted mute state — the drawer
//      elements are static DOM, so syncSoundToggle() on load reflects the
//      saved flag even before joining a room (no rejoin race)
//   4. toggling back to ON clears the persisted flag
// If a cue ever threw during page boot, the page would show an error and the
// suite would fail — so "doesn't throw without a real AudioContext" is
// implicitly guarded by the whole suite staying green.

import { test, expect } from '@playwright/test';
import { createRoomViaUI, startGameViaUI } from './helpers.js';

test.describe('sound toggle in menu drawer', () => {
  test('default ON, toggle mutes + persists, boot restores, toggle back clears', async ({ page }) => {
    await page.goto('/');
    await createRoomViaUI(page, 'Dodi');
    await expect(page.locator('#party-code')).toBeVisible({ timeout: 15000 });

    // The hamburger (menu drawer) only appears once we're IN a game, not in
    // the waiting room — start first.
    await startGameViaUI(page);
    await expect(page.locator('#table-area')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('#menu-toggle-btn')).toBeVisible();

    // 1. Default state: ON.
    await page.click('#menu-toggle-btn');
    await expect(page.locator('#menu-drawer')).toHaveClass(/open/);
    await expect(page.locator('#menu-drawer-sound')).toBeVisible();
    await expect(page.locator('#menu-sound-icon')).toHaveText('🔊');
    await expect(page.locator('#menu-sound-label')).toHaveText('On');
    expect(await page.evaluate(() => localStorage.getItem('pocer-sound-muted'))).not.toBe('1');

    // 2. Toggle -> muted, persisted.
    await page.click('#menu-sound-btn');
    await expect(page.locator('#menu-sound-icon')).toHaveText('🔇');
    await expect(page.locator('#menu-sound-label')).toHaveText('Off');
    await expect(page.locator('#menu-sound-btn')).toHaveClass(/muted/);
    expect(await page.evaluate(() => localStorage.getItem('pocer-sound-muted'))).toBe('1');

    // 3. Fresh boot restores the persisted mute state. We set the flag directly
    //    (not via the drawer) to exercise the load-time sync on the static DOM.
    await page.evaluate(() => localStorage.setItem('pocer-sound-muted', '1'));
    await page.reload();
    // The saved session should surface the Rejoin item (session persists too).
    await expect(page.locator('#lobby-rejoin-item')).toBeVisible();
    // Drawer is closed here (lobby), but syncSoundToggle() ran on load and set
    // the static elements from the persisted flag.
    await expect(page.locator('#menu-sound-icon')).toHaveText('🔇');
    await expect(page.locator('#menu-sound-label')).toHaveText('Off');

    // 4. Toggle back -> ON, flag cleared. The drawer is closed in the lobby,
    //    so drive the same handler the button onclick uses (click path was
    //    already exercised in step 2).
    await page.evaluate(() => window.__app_toggleSound());
    await expect(page.locator('#menu-sound-icon')).toHaveText('🔊');
    await expect(page.locator('#menu-sound-label')).toHaveText('On');
    expect(await page.evaluate(() => localStorage.getItem('pocer-sound-muted'))).not.toBe('1');
  });
});
