/**
 * One-off diagnostic: reproduce the Retell chat widget "not responding" issue.
 * Loads the LIVE site in headless Chrome, discovers the v2 widget's mount point,
 * opens the chat, sends a message, and logs every Retell network call.
 * Run inside GitHub Actions (see .github/workflows/retell-debug.yml).
 */
import { chromium } from 'playwright-core';

const TARGET = process.env.TARGET_URL || 'https://www.doryangel.com/';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();

page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('requestfailed', (r) => {
  if (/retell/i.test(r.url())) console.log('[requestfailed]', r.method(), r.url(), '=>', r.failure()?.errorText);
});
page.on('request', (r) => {
  if (/retell/i.test(r.url()) && !/\.(js|css|png|woff2?)(\?|$)/.test(r.url())) {
    console.log('[request]', r.method(), r.url());
    const pd = r.postData();
    if (pd) console.log('  [post-data]', pd.slice(0, 600));
  }
});
page.on('response', async (r) => {
  const u = r.url();
  const isRetell = /retell/i.test(u) && !/\.(js|css|png|woff2?)(\?|$)/.test(u);
  const isErr = r.status() >= 400;
  if (isRetell || (isErr && !/challenges\.cloudflare|_vercel|elfsight|google/i.test(u))) {
    let body = '';
    try {
      body = (await r.text()).slice(0, 1200);
    } catch {
      body = '<body unavailable>';
    }
    console.log('[response]', r.status(), u);
    console.log('  [body]', body.replace(/\n/g, ' '));
  }
});
page.on('websocket', (ws) => {
  if (!/retell/i.test(ws.url())) return;
  console.log('[websocket-open]', ws.url());
  ws.on('framesent', (f) => console.log('[ws-sent]', String(f.payload).slice(0, 400)));
  ws.on('framereceived', (f) => console.log('[ws-recv]', String(f.payload).slice(0, 400)));
  ws.on('close', () => console.log('[websocket-close]'));
});

console.log('=== NAVIGATING TO', TARGET, '===');
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(10000); // widget popup fires at 8s

// ── Discover what the v2 widget mounted ──
const survey = await page.evaluate(() => {
  const custom = [...new Set([...document.querySelectorAll('*')].filter((e) => e.tagName.includes('-')).map((e) => e.tagName.toLowerCase()))];
  const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: (f.src || '').slice(0, 120), id: f.id, cls: String(f.className).slice(0, 60) }));
  const retellNodes = [...document.querySelectorAll('[id*="retell" i], [class*="retell" i]')].map(
    (e) => `${e.tagName}#${e.id}.${String(e.className).slice(0, 60)}`
  );
  // last 5 direct children of <body> — widgets usually append themselves there
  const tail = [...document.body.children].slice(-5).map((e) => e.outerHTML.slice(0, 300));
  return { custom, iframes, retellNodes, tail };
});
console.log('=== WIDGET SURVEY ===');
console.log(JSON.stringify(survey, null, 1));

const dumpWidget = async (label) => {
  const html = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('*')].filter((e) => e.tagName.includes('-') && /retell|chat/i.test(e.tagName));
    return sel
      .map((host) => {
        const inner = host.shadowRoot ? host.shadowRoot.innerHTML : host.innerHTML;
        return `<<${host.tagName}>> shadow=${!!host.shadowRoot} :: ${inner.slice(0, 4000)}`;
      })
      .join('\n---\n');
  });
  console.log(`=== WIDGET DOM (${label}) ===`);
  console.log(html || '(no retell/chat custom element found)');
  const txt = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('*')].filter((e) => e.tagName.includes('-') && /retell|chat/i.test(e.tagName));
    return sel.map((h) => (h.shadowRoot ? h.shadowRoot.textContent : h.textContent)).join(' | ');
  });
  console.log(`=== WIDGET TEXT (${label}) ===`, (txt || '').replace(/\s+/g, ' ').slice(0, 1500));
};
await dumpWidget('initial');

// ── Open the chat ──
console.log('=== OPENING CHAT ===');
let opened = false;
// Strategy 1: click a button inside any retell/chat custom element or iframe
for (const sel of [
  'iframe[src*="retell" i]',
  '[id*="retell" i] button',
  '[class*="retell" i] button',
]) {
  try {
    if (sel.startsWith('iframe')) {
      const fl = page.frameLocator(sel);
      await fl.locator('button, [role="button"]').first().click({ timeout: 4000 });
    } else {
      await page.locator(sel).first().click({ timeout: 4000 });
    }
    console.log('opened via selector:', sel);
    opened = true;
    break;
  } catch {}
}
// Strategy 2: custom elements matching retell/chat — click their first button (pierces shadow DOM)
if (!opened) {
  try {
    const tag = await page.evaluate(
      () => [...document.querySelectorAll('*')].find((e) => e.tagName.includes('-') && /retell|chat/i.test(e.tagName))?.tagName.toLowerCase() || null
    );
    if (tag) {
      await page.locator(`${tag} button, ${tag} [role="button"], ${tag} div[class*="bubble" i]`).first().click({ timeout: 4000 });
      console.log('opened via custom element:', tag);
      opened = true;
    }
  } catch {}
}
// Strategy 3: raw coordinate click where the bubble lives (bottom-left, per CSS: left 20 / bottom 20)
if (!opened) {
  console.log('falling back to coordinate click at (45, 795)');
  await page.mouse.click(45, 795);
}
await page.waitForTimeout(5000);
await dumpWidget('after-open');

// ── Send a message ──
console.log('=== SENDING TEST MESSAGE ===');
try {
  let input = page.locator('input[type="text"], textarea, [contenteditable="true"]').last();
  const frames = page.frames().filter((f) => /retell/i.test(f.url()));
  if (frames.length) input = frames[0].locator('input, textarea, [contenteditable="true"]').first();
  await input.fill('Hi, this is an automated diagnostic test.', { timeout: 8000 });
  await input.press('Enter');
  console.log('message sent, waiting 20s for agent reply / API traffic...');
  await page.waitForTimeout(20000);
} catch (e) {
  console.log('could not type message:', String(e).slice(0, 300));
}
await dumpWidget('after-message');

await browser.close();
console.log('=== DONE ===');
