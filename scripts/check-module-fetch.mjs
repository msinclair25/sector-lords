import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('response', async (res) => {
  if (!res.url().includes('index-CqjgRDzj')) return;
  const ct = res.headers()['content-type'] || '';
  const buf = await res.body().catch(() => null);
  const text = buf ? buf.toString('utf8').slice(0, 100) : '';
  console.log({
    url: res.url(),
    status: res.status(),
    ct,
    fromServiceWorker: res.fromServiceWorker(),
    start: text,
  });
});

await page.goto('https://sectorlords.com/', {
  waitUntil: 'networkidle',
  timeout: 40000,
});
await page.waitForTimeout(1500);

// Also request via page.evaluate fetch
const viaFetch = await page.evaluate(async () => {
  const r = await fetch('/assets/index-CqjgRDzj.js');
  const t = await r.text();
  return {
    status: r.status,
    ct: r.headers.get('content-type'),
    start: t.slice(0, 100),
  };
});
console.log('page.fetch', viaFetch);

await browser.close();
