// Guards the contract-accuracy facts from Issue #313 against drifting back.
// Scans the hand-written pages, the blog generator templates and Nave's prompt for
// claims that contradict the confirmed business rules. Offline, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
function check(name, ok, detail) {
  if (ok) return;
  failed++;
  console.error('FAIL: ' + name + (detail ? '\n  ' + detail : ''));
}
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Phrases that must not appear anywhere on a live, hand-written page or template.
const FORBIDDEN = [
  [/online rent collection/i, 'DoryAngel does not collect rent; tenants pay owners directly'],
  [/owner disbursements?/i, 'DoryAngel does not disburse funds'],
  [/automated monthly rent collection/i, 'DoryAngel does not collect rent'],
  [/Ideal for single-unit owners/i, '$99 applies to 10+ units in one agreement'],
  [/"@type":\s*"RealEstateAgent"|"RealEstateAgent"/, 'DoryAngel is not a real estate agent; brokerage is done by licensed partners'],
  [/Licensed\s*(?:&|&amp;)\s*Insured/i, 'only insurance is substantiated'],
  [/Licensed Property Manager/i, 'licence claim is not substantiated'],
  [/\$99[^<"]{0,40}(?:per|\/)\s*unit[^<"]{0,15}(?:\/|per)\s*month[^<"]{0,3}<\/strong>\s*—\s*no hidden fees/i, 'blog CTA must not claim a universal $99 or "no hidden fees"'],
  [/lease renewal fee<\/td><td[^>]*>[^<]*<\/td><td[^>]*>\s*Included/i, '$100 per completed renewal is an extra fee'],
  [/\bno hidden fees\b/i, 'extras exist ($100 renewal, brokerage, vendor costs); say they are disclosed up front'],
  [/\$2,000[–-]\$8,000/, 'unsubstantiated savings range'],
];
const PAGES = [
  'index.html', 'faq/index.html', 'flat-fee-vs-commission/index.html',
  'scripts/build-blog.js',
];
for (const f of PAGES) {
  const txt = read(f);
  for (const [re, why] of FORBIDDEN) {
    const m = txt.match(re);
    check(`${f} has no ${re}`, !m, m ? `found "${m[0].slice(0, 80)}" — ${why}` : '');
  }
}

// Every generated blog page carries the same CTA, so one sample per run is enough,
// but scan them all: it is cheap and catches a stale rebuild.
const blogDir = path.join(root, 'blog');
let pages = 0;
for (const d of fs.readdirSync(blogDir)) {
  const f = path.join(blogDir, d, 'index.html');
  if (!fs.existsSync(f)) continue;
  pages++;
  const t = fs.readFileSync(f, 'utf8');
  check(`blog/${d} CTA is current`, !/no hidden fees, no percentage tricks/i.test(t) && !/from \$99\/month/i.test(t), 'stale CTA — rerun node scripts/build-blog.js');
}
check('blog pages were scanned', pages > 0);

// Facts that MUST be present.
const idx = read('index.html');
check('index.html shows the Bronx meeting office', idx.includes('440 E 140th St, Bronx, NY 10454'));
check('index.html keeps 557 Grand Concourse as Headquarters', /Headquarters<\/div>\s*<div class="contact-detail-val">557 Grand Concourse #4123/.test(idx));
check('440 E 140th is labelled as appointment-only meetings, not HQ', /Bronx Office Meetings<\/div>/.test(idx) && /Face-to-face meetings by appointment only/.test(idx));
check('index.html states the 10+ unit threshold next to $99', /\$99<span>\/occupied unit\/mo<\/span>/.test(idx) && /10 or more units/.test(idx));
check('index.html states the $100 renewal fee', /\$100 per completed (?:lease )?renewal/.test(idx));
check('index.html says rent is paid directly to the owner', /Your Rent Goes Directly to You/.test(idx));
check('hero CTA stays Free Rental Analysis', /Get My Free Rental Analysis/.test(idx));
check('Nave prompt carries the 10+ rule', /ONLY when at least 10 units/.test(read('scripts/generate-post.js')));


// Batch 2: the online-enrollment teaser is an interest test only.
check('teaser says coming soon with no payment or agreement', /Coming soon\. No payment or agreement is processed here yet\./.test(idx));
check('teaser CTA is Notify Me, not Enroll', /I&rsquo;m Interested &mdash; Notify Me/.test(idx) && !/Enroll Now|Sign Up Now|Pay Now/i.test(idx));
const modal = (idx.match(/id="enrollOverlay"[\s\S]*?<!-- Property P&L Dashboard checkout modal -->/) || [''])[0];
check('interest form is tagged with a source and interest', /name="source" value="website_online_enrollment_preview"/.test(modal) && /name="interest" value="online_enrollment_preview/.test(modal));
check('interest form uses the Web3Forms honeypot (botcheck), not _honey', /name="botcheck"/.test(modal) && !/_honey/.test(modal));
check('interest form keeps call/text consent optional', /name="tcpa_consent"/.test(modal) && !/name="tcpa_consent"[^>]*required/.test(modal));
check('interest form does not hit the Make webhook', !/hook\.eu1\.make\.com/.test((idx.match(/Online enrollment interest: open[\s\S]*?<\/script>/) || [''])[0]));
check('teaser states eligibility, $150 after six months only with owner agreement, and written confirmation', /of any size/.test(idx) && /\$150 per occupied unit per month only with your agreement/.test(idx) && /Then: \$150\/occupied unit\/mo, with your agreement/.test(idx));
check('teaser GA4 events are wired', /online_enrollment_interest_open/.test(idx) && /online_enrollment_interest_submit/.test(idx));

check('hero keeps the office card and trust strip', /class="hero-office"/.test(idx) && /class="hero-trust"/.test(idx));
check('hero no longer ships the eager portal screenshot', !/class="hero-shot"/.test(idx.split('<!-- DIRECT RENT -->')[0].split('id="hero-promise"')[1] || ''));

// Calculator must never compute $99 below 10 units.
const calc = read('flat-fee-vs-commission/index.html');
check('calculator has no unconditional units*99', !/units\s*\*\s*99/.test(calc));
check('calculator gates the standard rate at 10 units', /MIN_UNITS\s*=\s*10/.test(calc) && /units\s*>=\s*MIN_UNITS/.test(calc));

if (failed) { console.error(`${failed} site-fact check(s) FAILED.`); process.exit(1); }
console.log('All site-fact checks passed.');
