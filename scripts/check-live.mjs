import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const reqs = [];
page.on('response', (res) => {
  const u = res.url();
  if (/sectorlords|assets|pages\.dev/i.test(u)) {
    reqs.push({
      status: res.status(),
      ct: res.headers()['content-type'] || '',
      u: u.slice(0, 160),
    });
  }
});
const errors = [];
page.on('pageerror', (e) => errors.push('page: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

const urls = [
  'https://sectorlords.com/',
  'https://c940d319.sector-lords.pages.dev/',
];
for (const url of urls) {
  reqs.length = 0;
  errors.length = 0;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  const scriptMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
  console.log('\n===', url);
  console.log('script src', scriptMatch?.[1] ?? 'none');
  console.log('canvas', await page.locator('canvas').count());
  console.log(
    'body',
    JSON.stringify((await page.locator('body').innerText()).slice(0, 160)),
  );
  console.log(
    'index asset reqs',
    reqs.filter((r) => r.u.includes('index-')),
  );
  console.log('errors', errors);
}

await browser.close();
