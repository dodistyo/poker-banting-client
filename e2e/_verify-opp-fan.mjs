// Screenshot opponent fan at 4 resolutions + geometry dump for verification.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:3000';
const shots = '/tmp/opp-fan-shots';
mkdirSync(shots, { recursive: true });
const deal = [
  { rank: '7', suit: 'clubs' }, { rank: 'A', suit: 'spades' },
  { rank: '3', suit: 'hearts' }, { rank: 'K', suit: 'diamonds' },
  { rank: '5', suit: 'hearts' }, { rank: '2', suit: 'spades' },
  { rank: 'Q', suit: 'clubs' }, { rank: '4', suit: 'diamonds' },
  { rank: 'J', suit: 'hearts' }, { rank: '9', suit: 'clubs' },
  { rank: '10', suit: 'diamonds' }, { rank: '6', suit: 'hearts' },
  { rank: '8', suit: 'clubs' },
];
const bots = [1, 2, 3].map(i => ({ name: 'Bot ' + i, isBot: true, connected: true, hand: [], handCount: 13, score: 0 }));

const res = [
  { name: 'portrait', w: 390, h: 844 },
  { name: 'landscape', w: 844, h: 390 },
  { name: 'desktop', w: 1280, h: 720 },
  { name: 'tablet', w: 768, h: 1024 },
];

const browser = await chromium.launch();
for (const r of res) {
  const ctx = await browser.newContext({ viewport: { width: r.w, height: r.h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(({ deal, bots }) => {
    window.__app_injectMessage({ type: 'created', state: {
      phase: 'playing', currentPlayer: 0,
      players: [{ name: 'Raven83', isBot: false, connected: true, hand: deal, handCount: 13, score: 0 }, ...bots],
      trick: { combo: null, comboPlayer: null, passed: [], played: [] },
      log: ['Game started'], finishedOrder: [], threePhase: false,
    }, playerId: 0, code: 'OPPFAN', token: 't' });
  }, { deal, bots });
  await page.waitForSelector('#hand-0 .card', { timeout: 8000 });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const dump = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cards = Array.from(el.querySelectorAll(':scope > .card')).map(c => {
        const b = c.getBoundingClientRect();
        return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height), c.style.transform].join(',');
      });
      const b = el.getBoundingClientRect();
      return { box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], n: cards.length, cards };
    };
    return { top: dump('#hand-2'), left: dump('#hand-3'), right: dump('#hand-1') };
  });
  console.log('=== ' + r.name + ' ' + r.w + 'x' + r.h + ' ===');
  for (const k of ['top', 'left', 'right']) {
    const d = info[k];
    if (!d) { console.log(k, 'MISSING'); continue; }
    console.log(k, 'box', JSON.stringify(d.box), 'n=' + d.n);
    console.log('  first: ', d.cards[0]);
    console.log('  mid:   ', d.cards[Math.floor(d.cards.length / 2)]);
    console.log('  last:  ', d.cards[d.cards.length - 1]);
  }
  await page.screenshot({ path: shots + '/opp-' + r.name + '.png' });
  await ctx.close();
}
await browser.close();
console.log('shots in ' + shots);
