import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const res = await page.goto('https://sectorlords.com/assets/index-CqjgRDzj.js', {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
});
console.log('status', res?.status());
console.log('ct', res?.headers()['content-type']);
const text = await res?.text();
console.log('len', text?.length);
console.log('start', text?.slice(0, 120));
console.log('isHtml', text?.trimStart().startsWith('<!'));
await browser.close();
