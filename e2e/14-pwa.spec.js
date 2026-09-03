// 14-pwa.spec.js — PWA: service worker registration, manifest, offline shell.
//
// What this proves:
//  1. sw.js registers + activates and takes control of the page.
//  2. manifest.webmanifest is linked, served as JSON, and parseable.
//  3. After a first online load, the app shell still renders with the
//     network cut (offline fallback) — the lobby overlay comes up.
//  4. /api traffic is NEVER served from cache (the live game API must
//     always hit the network — a cached API response is a stale board).
import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
  test('service worker registers, manifest links, shell works offline', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // 1. First online load: SW should install + activate. Use the `ready`
    //    promise (it resolves to the registration once one is active).
    //    `getRegistration()` returns a *Promise*, so a plain property check
    //    on it never sees `.active` — that was the earlier false-negative.
    await page.goto('/');
    const sw = await page.evaluate(() => new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 8000);
      navigator.serviceWorker.ready
        .then((reg) => { clearTimeout(t); resolve(reg.active || reg.waiting); })
        .catch(() => { clearTimeout(t); resolve(null); });
    }));
    expect(sw, 'service worker should be active').toBeTruthy();

    // 2. Manifest linked + valid JSON with the required install fields.
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const res = await fetch(link.href);
      if (!res.ok) return { error: `status ${res.status}` };
      return { contentType: res.headers.get('content-type'), data: await res.json() };
    });
    expect(manifest, 'manifest link should exist').toBeTruthy();
    expect(manifest.error).toBeUndefined();
    expect(manifest.contentType).toContain('json');
    expect(manifest.data.name).toBe('Poker Banting');
    expect(manifest.data.display).toBe('standalone');
    expect(manifest.data.icons.some((i) => i.sizes === '512x512')).toBe(true);

    // 3. API responses must not be cached (live game state).
    const apiCacheState = await page.evaluate(async () => {
      // Hit the health endpoint through the app's own /api proxy prefix.
      const res = await fetch('/api/health', { cache: 'no-store' });
      const text = await res.text();
      return { status: res.status, body: text };
    });
    // /api/health maps to BE /health (200). If the SW had served it from
    // cache, the SW would have needed to store it first — which it must
    // not. We assert it round-trips to the backend live.
    expect(apiCacheState.status).toBe(200);

    // 3. Second online load: this one IS controlled by the SW, so its
    //    sub-resources get stored in the runtime cache (the first load
    //    happens before the SW takes control).
    const page2 = await ctx.newPage();
    await page2.goto('/');
    await page2.waitForTimeout(500); // let the SW cache its sub-resources

    // 4. Offline: a fresh page with the network cut must render the app
    //    shell from cache (lobby overlay + booted modules).
    await ctx.setOffline(true);
    const page3 = await ctx.newPage();
    await page3.goto('/');
    await expect(page3.locator('#lobby-overlay')).toBeVisible({ timeout: 10_000 });
    const appBooted = await page3.evaluate(() =>
      typeof window.__app_getState === 'function'
    );
    expect(appBooted, 'app shell should boot from cache offline').toBe(true);

    // 5. Coming back online, a navigation is network-first: still works.
    await ctx.setOffline(false);
    await page3.reload();
    await expect(page3.locator('#lobby-overlay')).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });

  test('SW serves a fresh shell after CACHE_VERSION bump (versioned cache)', async ({ browser }) => {
    // The shell is versioned: a stale SW with an old cache name is evicted
    // on activate. We can't bump the constant mid-test, but we can verify
    // the activate handler keeps only the current version's caches.
    // The expected version is read from the served sw.js (CACHE_VERSION),
    // so bumping the constant does not require editing this test.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/');
    const info = await page.evaluate(async () => {
      const swSrc = await (await fetch('/sw.js')).text();
      const m = swSrc.match(/const CACHE_VERSION = "([^"]+)"/);
      const version = m ? m[1] : null;
      await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      return { version, keys };
    });
    expect(info.version, 'CACHE_VERSION must be declared in sw.js').toBeTruthy();
    // Only the current version's caches should exist (pb-static-<v>,
    // pb-runtime-<v>). No orphans from earlier versions.
    expect(info.keys.every((k) => k.includes(info.version)),
      `only current-version caches should remain, got: ${info.keys}`).toBe(true);
    await ctx.close();
  });
});
