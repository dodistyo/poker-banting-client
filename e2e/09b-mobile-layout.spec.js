import { test } from '@playwright/test';
import { makeServerState, injectCreated, injectState } from './helpers.js';

// Automated overlap/clipping check across the mobile-ish viewports.
// PASS criteria per viewport:
//   1. FAB fully inside the viewport (fab.bottom <= vh)   — not clipped
//   2. Action bar does not overlap the strip (actionbar.bottom <= sidebar.top)
//   3. When no action bar (not your turn), just the FAB check
test('layout: no overlap / clipping across viewports', async ({ page }) => {
  const states = [
    { label: 'portrait 390x844',  w: 390, h: 844 },
    { label: 'portrait 480x800',  w: 480, h: 800 },
    { label: 'landscape 844x390', w: 844, h: 390 },
    { label: 'landscape 800x480', w: 800, h: 480 },
  ];
  const results = [];
  for (const s of states) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto('/');
    await injectCreated(page, makeServerState({ log: ['Game started'] }));
    // Mid-game: Dodi (player 0) to move -> action bar visible
    await injectState(page, makeServerState({
      phase: 'playing', currentPlayer: 0,
      hands: [[{rank:'A',suit:'spades'},{rank:'K',suit:'hearts'}], [], [], [
        {rank:'A',suit:'spades'},{rank:'K',suit:'hearts'},{rank:'Q',suit:'diamonds'},
        {rank:'J',suit:'clubs'},{rank:'10',suit:'spades'},{rank:'9',suit:'hearts'},
        {rank:'8',suit:'diamonds'},{rank:'7',suit:'clubs'},
      ]],
      scores: [12, 8, 0, -15],
      log: ['Game started','Dodi plays K♠'],
    }));
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const g = (s)=>{const e=document.querySelector(s); if(!e) return null; const cs=getComputedStyle(e); const r=e.getBoundingClientRect(); return (cs.display==='none'||r.width===0)?null:{top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height)};};
      return { vh: window.innerHeight, sidebar: g('#sidebar'), fab: g('#log-fab-btn'), actionbar: g('#action-bar') };
    });
    const checks = {};
    checks.fab_in_viewport = m.fab ? m.fab.bottom <= m.vh : false;
    checks.fab_present = !!m.fab;
    if (m.actionbar && m.sidebar) {
      checks.no_overlap = m.actionbar.bottom <= m.sidebar.top + 1; // allow 1px rounding
      checks.overlap_px = m.actionbar.bottom - m.sidebar.top;
    } else {
      checks.no_overlap = true; // no action bar -> nothing to overlap
    }
    const pass = checks.fab_present && checks.fab_in_viewport && checks.no_overlap;
    results.push({ label: s.label, pass, ...checks, sidebar: m.sidebar?.h, actionbar: m.actionbar?.bottom, vh: m.vh });
    console.log(`LAYOUT ${pass?'PASS':'FAIL'} ${s.label}`, JSON.stringify(results.at(-1)));
  }
  const allPass = results.every(r => r.pass);
  console.log('LAYOUT ALL:', allPass ? 'PASS' : 'FAIL');
  test.allPass = allPass; // eslint-disable-line
  if (!allPass) test.fail('Some viewports failed layout checks', true);
});
