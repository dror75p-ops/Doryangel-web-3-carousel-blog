/**
 * One-off diagnostic: reproduce the Retell chat widget "not responding" issue.
 * Loads the site in headless Chrome, opens the chat, sends a message, and logs
 * every Retell network call + the widget's shadow-DOM contents.
 * Run inside GitHub Actions (see .github/workflows/retell-debug.yml).
 */
import { chromium } from 'playwright-core';

const TARGET = process.env.TARGET_URL || 'http://localhost:8080/';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();

page.on('console', (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 500)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
page.on('requestfailed', (r) =>
  console.log('[requestfailed]', r.method(), r.url().slice(0, 200), '=>', r.failure()?.errorText)
);
page.on('request', (r) => {
  if (/retell/i.test(r.url())) {
    console.log('[request]', r.method(), r.url());
    const pd = r.postData();
    if (pd) console.log('  [post-data]', pd.slice(0, 600));
  }
});
page.on('response', async (r) => {
  if (/retell/i.test(r.url())) {
    let body = '';
    try {
      body = (await r.text()).slice(0, 1000);
    } catch {
      body = '<body unavailable>';
    }
    console.log('[response]', r.status(), r.url());
    if (!/\.js(\?|$)/.test(r.url())) console.log('  [body]', body.replace(/\n/g, ' '));
  }
});
// WebSocket traffic — the chat may run over WS
page.on('websocket', (ws) => {
  console.log('[websocket-open]', ws.url());
  ws.on('framesent', (f) => console.log('[ws-sent]', String(f.payload).slice(0, 300)));
  ws.on('framereceived', (f) => console.log('[ws-recv]', String(f.payload).slice(0, 300)));
  ws.on('close', () => console.log('[websocket-close]', ws.url()));
});

console.log('=== NAVIGATING TO', TARGET, '===');
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000); // let the widget boot (popup appears at 8s)

const dumpShadow = async (label) => {
  const html = await page.evaluate(() => {
    const host = document.querySelector('retell-chat-web-component');
    if (!host) return 'NO <retell-chat-web-component> IN DOM';
    if (!host.shadowRoot) return 'HOST PRESENT, NO OPEN SHADOW ROOT';
    return host.shadowRoot.innerHTML;
  });
  console.log(`=== SHADOW DOM (${label}) ${html.length} chars ===`);
  console.log(html.slice(0, 6000));
  const text = await page.evaluate(() => {
    const host = document.querySelector('retell-chat-web-component');
    return host?.shadowRoot ? host.shadowRoot.textContent : '';
  });
  console.log(`=== SHADOW TEXT (${label}) ===`);
  console.log((text || '').replace(/\s+/g, ' ').slice(0, 2000));
};

await dumpShadow('initial');

// Open the chat — click the bubble inside the shadow DOM (Playwright pierces open shadow roots)
console.log('=== CLICKING CHAT BUBBLE ===');
try {
  const bubble = page.locator('retell-chat-web-component >> [class*=bubble], retell-chat-web-component >> button').first();
  await bubble.click({ timeout: 5000 });
} catch {
  console.log('bubble locator failed, clicking host element center');
  try {
    await page.locator('retell-chat-web-component').click({ timeout: 5000, position: { x: 30, y: 30 } });
  } catch (e) {
    console.log('host click also failed:', String(e).slice(0, 200));
  }
}
await page.waitForTimeout(4000);
await dumpShadow('after-open');

// Type a message and send
console.log('=== SENDING TEST MESSAGE ===');
try {
  const input = page
    .locator('retell-chat-web-component >> input, retell-chat-web-component >> textarea, retell-chat-web-component >> [contenteditable="true"]')
    .first();
  await input.fill('Hi there, can you help me?', { timeout: 8000 });
  await input.press('Enter');
  console.log('message sent, waiting 15s for a reply...');
  await page.waitForTimeout(15000);
} catch (e) {
  console.log('could not type message:', String(e).slice(0, 300));
}
await dumpShadow('after-message');

await browser.close();
console.log('=== DONE ===');
