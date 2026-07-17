/**
 * Mobile boot smoke: open site as iPhone, tap Jack In, assert hybrid HUD mounts.
 * Usage: node scripts/smoke-mobile-boot.mjs [url]
 */
import { chromium, devices } from 'playwright';

const url = process.argv[2] || 'https://sectorlords.com/';

const browser = await chromium.launch({ headless: true });
const iPhone = devices['iPhone 12'];
const context = await browser.newContext({ ...iPhone });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

console.log('goto', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(2500);

// Dismiss anything blocking; find play
const play = page.locator('[data-act="play"]').first();
const visible = await play.isVisible().catch(() => false);
console.log('play visible', visible);

if (visible) {
  await play.click({ force: true, timeout: 10000 });
} else {
  // try text
  await page.getByRole('button', { name: /Jack In|New Game/i }).first().click({ force: true });
}

await page.waitForTimeout(8000);

const hasHybrid = await page.locator('#sl-hybrid-root').count();
const hasMenu = await page.locator('#sl-menu-root').count();
const hasBoard = await page.locator('#sl-table-host, #board3d-host').count();
const hasLoading = await page.locator('#sl-loading').count();
const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 400);

console.log(
  JSON.stringify(
    {
      hasHybrid,
      hasMenu,
      hasBoard,
      hasLoading,
      errors,
      bodySnippet: bodyText.replace(/\s+/g, ' ').slice(0, 280),
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(hasHybrid > 0 && hasMenu === 0 ? 0 : 2);
