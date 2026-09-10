/**
 * Read-only probe: does a VISIBLE accessibility trigger actually exist on the
 * live site, at desktop and at mobile width?
 *
 * WHY: the repo's CSS parks UserWay's own icon off-screen
 * (#userwayAccessibilityIcon { left:-9999px }) and shows the in-nav button
 * (.a11y-nav-btn) only below 900px. Reading that CSS suggests desktop has no
 * trigger at all — but that conclusion only holds if UserWay still renders an
 * element with that exact id. Newer widget builds may not, in which case the
 * park rule is dead code and UserWay's own button is visible everywhere.
 *
 * The CCR sandbox proxy blocks both the live site and cdn.userway.org (403),
 * so this has to run from a runner. It writes nothing and reads no secrets.
 */
import { chromium } from 'playwright';

const PAGES = [
  ['homepage',        'https://www.doryangel.com/'],
  ['blog post',       'https://www.doryangel.com/blog/5-smart-sensors-every-bronx-landlord-should-install-in-2026/'],
  ['privacy (legal)', 'https://www.doryangel.com/privacy.html'],
];

const VIEWPORTS = [
  ['desktop 1280', { width: 1280, height: 900 }],
  ['mobile 390',   { width: 390,  height: 844 }],
];

// Runs in the page. Returns every plausible accessibility trigger and whether a
// real user could actually see and click it.
function collect() {
  const out = { userwayScript: false, candidates: [] };
  out.userwayScript = !!document.querySelector('script[src*="userway"]');

  const seen = new Set();
  const nodes = [
    ...document.querySelectorAll('[id*="userway" i],[class*="userway" i],[class*="uwy" i]'),
    ...document.querySelectorAll('[aria-label*="accessib" i],[title*="accessib" i]'),
    ...document.querySelectorAll('.a11y-nav-btn'),
  ];

  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const r  = el.getBoundingClientRect();

    // "Visible" means a user can see it: rendered, non-zero box, not parked
    // off-screen, and its centre actually hits this element (not covered).
    const rendered = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
    const hasBox   = r.width > 0 && r.height > 0;
    const onScreen = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    let hitsSelf = false;
    if (rendered && hasBox && onScreen) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      hitsSelf = !!top && (top === el || el.contains(top) || top.contains(el));
    }

    out.candidates.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').toString().slice(0, 70) || null,
      label: el.getAttribute('aria-label') || null,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      clickable: rendered && hasBox && onScreen && hitsSelf,
    });
  }
  return out;
}

const browser = await chromium.launch();
const results = [];

for (const [label, url] of PAGES) {
  for (const [vpName, viewport] of VIEWPORTS) {
    const ctx  = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    let res;
    try {
      // NOT networkidle: index.html carries Retell, Elfsight, Clarity and GA4,
      // which keep the connection busy indefinitely, so networkidle times out and
      // the most important page never gets probed at all. Wait for the document,
      // then give UserWay time to inject.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(6000); // UserWay injects late
      res = await page.evaluate(collect);
    } catch (err) {
      console.log(`\n### ${label} @ ${vpName}\n  LOAD FAILED: ${err.message}`);
      results.push({ label, vpName, loaded: false, visible: 0 });
      await ctx.close();
      continue;
    }

    const visible = res.candidates.filter(c => c.clickable);
    console.log(`\n### ${label} @ ${vpName}  —  ${url}`);
    console.log(`  UserWay script tag present : ${res.userwayScript ? 'YES' : 'NO'}`);
    console.log(`  Accessibility candidates    : ${res.candidates.length}`);
    console.log(`  VISIBLE + CLICKABLE         : ${visible.length}  ${visible.length ? '✅' : '❌ NO REACHABLE TRIGGER'}`);
    for (const c of res.candidates) {
      console.log(`    ${c.clickable ? '✅' : '  '} <${c.tag}${c.id ? ' #' + c.id : ''}${c.cls ? ' .' + c.cls.trim().split(/\s+/).join('.') : ''}>`);
      console.log(`         label=${JSON.stringify(c.label)} display=${c.display} vis=${c.visibility} op=${c.opacity} box=${JSON.stringify(c.box)}`);
    }

    results.push({ label, vpName, loaded: true, visible: visible.length });

    await page.screenshot({ path: `shot-${label.replace(/\W+/g, '-')}-${vpName.replace(/\W+/g, '-')}.png`, fullPage: false });
    await ctx.close();
  }
}

await browser.close();

// A page that never loaded is an untested page, NOT a page without a trigger.
// Conflating the two is how the first run reported "Homepage desktop has NO
// reachable accessibility trigger" when the homepage had simply timed out.
console.log('\n================ VERDICT ================');
let failures = 0;
for (const r of results) {
  const where = `${r.label} @ ${r.vpName}`;
  if (!r.loaded)          console.log(`  ⚠️  NOT TESTED  ${where} — page failed to load, this says nothing about the trigger`);
  else if (r.visible > 0) console.log(`  ✅  OK          ${where} — ${r.visible} reachable trigger(s)`);
  else { failures++;      console.log(`  ❌  NO TRIGGER  ${where} — page loaded and nothing reachable was found`); }
}
const untested = results.filter(r => !r.loaded).length;
console.log(`\n${results.length - untested}/${results.length} page-viewport combinations tested; ${failures} with no reachable trigger.`);
if (untested) console.log(`${untested} could not be loaded — re-run before drawing any conclusion about those.`);
// A run that tested nothing must not pass as a green tick — that is the same
// silent-success trap the verdict wording above exists to close.
if (untested === results.length) {
  console.log('\n::error::Probe tested nothing — every page failed to load. This run proves nothing.');
  process.exitCode = 1;
} else {
  if (untested) console.log(`::warning::${untested} of ${results.length} page-viewport combinations could not be loaded.`);
  process.exitCode = failures > 0 ? 1 : 0;
}
