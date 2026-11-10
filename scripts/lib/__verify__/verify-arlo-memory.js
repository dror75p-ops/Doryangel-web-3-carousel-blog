// scripts/lib/__verify__/verify-arlo-memory.js
//
// Proves Arlo's memory rules (scripts/lib/arlo-memory.js) on the REAL history
// that produced the repeats: the 2026-11-08 recommendations, the experiments
// ledger, and the commits that shipped earlier approvals. Offline, no secrets.
//   node scripts/lib/__verify__/verify-arlo-memory.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import {
  parseArloIds, topicKeyOf, buildHandledList, screenRecommendation,
  describeHandledForPrompt, extractHeadSeo, QUEUE_COMMIT,
} from '../arlo-memory.js';

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

// ── Id parsing, including the shorthand real commits use ──
check('slash shorthand', JSON.stringify(parseArloIds('Homepage: flat-fee title and niche description (ARLO-2026-10-25-01/-02)'))
  === JSON.stringify(['ARLO-2026-10-25-01', 'ARLO-2026-10-25-02']));
check('"and -04" shorthand', JSON.stringify(parseArloIds('Ship ARLO-2026-11-08-03 and -04: orphan-post links'))
  === JSON.stringify(['ARLO-2026-11-08-03', 'ARLO-2026-11-08-04']));
check('single id', parseArloIds('Backfill internal links (ARLO-2026-09-27-03)').length === 1);
check('no id', parseArloIds('Arlo: rank snapshot 2026-11-09').length === 0);
check('queue commit is not a ship commit', QUEUE_COMMIT.test('Queue approved recommendation ARLO-2026-11-08-04 (#344)'));

// ── Topics: the two ideas that kept coming back ──
const recs1108 = [
  { action: 'site-change', targetSlug: null, title: 'Rewrite homepage/service page title tag & meta description for Bronx property management', what: '' },
  { action: 'site-change', targetSlug: null, title: "Fix title/meta on pages ranking #1 for 'property management company' and 'apartment management company'", what: 'Identify the two pages ranking position 1.0 and rewrite their title tags.' },
  { action: 'site-change', targetSlug: null, title: 'Add internal links from popular posts to the 6 orphaned posts', what: '' },
  { action: 'improve-existing', targetSlug: 'why-your-bronx-rentals-pipes-freeze-before-january-and-what', title: 'Expand the pipe-freeze post with a 24/7 emergency response angle', what: '' },
];
check('homepage title rec → homepage-title', topicKeyOf(recs1108[0]) === 'homepage-title');
check('"pages ranking #1" title rec with no page → homepage-title', topicKeyOf(recs1108[1]) === 'homepage-title');
check('orphan rec → internal-links', topicKeyOf(recs1108[2]) === 'internal-links');
check('pipe-freeze rec has no topic', topicKeyOf(recs1108[3]) === null);
check('a post title rewrite is NOT the homepage', topicKeyOf({ action: 'improve-existing', targetSlug: 'x', title: 'Rewrite the title and meta description on the flat-fee post' }) === null);

// ── The scenario that actually happened: cycle of 2026-11-08 ──
// Known to Arlo then: the homepage title shipped 10-28 by commit naming
// ARLO-2026-10-25-01/-02; the 10-11 orphan approval sat in open PR #323.
const handledThen = buildHandledList({
  experiments: [{ id: 'ARLO-2026-09-13-01', action: 'improve-existing', targetSlug: 'flat-fee-property-management-vs-percentage', status: 'implemented', title: 'Rewrite title and meta description for flat-fee vs percentage post' }],
  openApprovalPrs: [{ number: 323, title: 'Approved: Add internal links to the 3 orphaned posts', branch: 'claude/approved-arlo-2026-10-11-04' }],
  commits: [
    { date: '2026-10-28', subject: 'Homepage: flat-fee title and niche description (ARLO-2026-10-25-01/-02)' },
  ],
});
const ctxThen = { handled: handledThen, recentChanges: { changedSlugs: [], homepageSeoChangedOn: '2026-10-28' } };
check('11-08-01 (homepage title) would have been dropped', screenRecommendation(recs1108[0], ctxThen) !== null);
check('11-08-02 (title on #1 pages) would have been dropped', screenRecommendation(recs1108[1], ctxThen) !== null);
check('11-08-03 (orphans) would have been dropped — PR #323 was waiting', /#323/.test(screenRecommendation(recs1108[2], ctxThen) || ''));
check('11-08-04 (pipe-freeze, genuinely new) is kept', screenRecommendation(recs1108[3], ctxThen) === null);

// ── Today: 11-08-03/-04 shipped by #346 and are queued in the ledger ──
const handledNow = buildHandledList({
  experiments: JSON.parse(readFileSync('./project/seo/experiments.json', 'utf8')),
  openApprovalPrs: [],
  commits: [
    { date: '2026-11-09', subject: 'Ship ARLO-2026-11-08-03 and -04: orphan-post links + 2 a.m. burst section (#346)' },
    { date: '2026-11-09', subject: 'Queue approved recommendation ARLO-2026-11-08-04 (#344)' },
  ],
});
const h03 = handledNow.find(h => h.id === 'ARLO-2026-11-08-03');
check('a commit-only id takes its title from the ledger, not the commit', h03 && /orphaned/.test(h03.title));
check('shipped work is in flight until measured', h03 && h03.inFlight === true);
check('a repeat of the pipe-freeze post is dropped (same page)',
  screenRecommendation({ action: 'improve-existing', targetSlug: 'why-your-bronx-rentals-pipes-freeze-before-january-and-what', title: 'Add an FAQ to the frozen pipes post' }, { handled: handledNow }) !== null);
check('a reworded orphan idea is dropped',
  screenRecommendation({ action: 'site-change', targetSlug: null, title: 'Link older posts back to recent ones that have no inbound links' }, { handled: handledNow }) !== null);
check('an unrelated new post is kept',
  screenRecommendation({ action: 'new-content', targetSlug: 'bronx-boiler-no-heat-first-hour', title: 'No Heat in Your Bronx Building at 2 a.m.: The First Hour' }, { handled: handledNow }) === null);

// ── A measured experiment no longer blocks (a different approach may follow) ──
const measured = buildHandledList({ experiments: [{ id: 'ARLO-2026-01-01-01', action: 'improve-existing', targetSlug: 'p', status: 'measured', title: 'Old idea' }] });
check('measured experiment is not in flight', measured[0].inFlight === false);
check('measured experiment does not block its page', screenRecommendation({ action: 'improve-existing', targetSlug: 'p', title: 'New idea' }, { handled: measured }) === null);
const measuredWithCommit = buildHandledList({
  experiments: [{ id: 'ARLO-2026-01-01-01', status: 'measured', title: 'Old idea', targetSlug: 'p' }],
  commits: [{ date: '2026-01-02', subject: 'Ship ARLO-2026-01-01-01' }],
});
check('a recent ship commit does not re-open a measured experiment', measuredWithCommit[0].inFlight === false);

// ── Recently changed posts ──
check('a post changed in the window is not recommended again',
  screenRecommendation({ action: 'improve-existing', targetSlug: 'p', title: 'x' }, { recentChanges: { changedSlugs: ['p'] } }) !== null);
check('a new post may still be proposed on a fresh slug list',
  screenRecommendation({ action: 'new-content', targetSlug: 'p', title: 'x' }, { recentChanges: { changedSlugs: ['p'] } }) === null);
check('homepage title is allowed once 28 days have passed',
  screenRecommendation(recs1108[0], { handled: [], recentChanges: { homepageSeoChangedOn: null } }) === null);

// ── Prompt block ──
const block = describeHandledForPrompt(handledNow, { changedSlugs: ['a-post'], homepageSeoChangedOn: '2026-10-28' });
check('prompt names the in-flight ids', /ARLO-2026-11-08-03/.test(block) && /ARLO-2026-11-08-04/.test(block));
check('prompt names the homepage change', /homepage title\/meta description \(changed 2026-10-28\)/.test(block));
check('prompt is empty when nothing is known', describeHandledForPrompt([], {}) === '');

// ── Homepage head extraction on the real file ──
const head = extractHeadSeo(readFileSync('./index.html', 'utf8'));
check('real homepage has a title and a description', head.split('\u0001').every(x => x.length > 10));

// ── The real git history, as Arlo will read it (skipped on a shallow clone) ──
let full = true;
try { full = execSync('git rev-parse --is-shallow-repository').toString().trim() === 'false'; } catch { full = false; }
if (full) {
  const log = execSync('git log --since="120 days ago" --format=%cs%x09%s -i --grep=ARLO-').toString().trim()
    .split('\n').filter(Boolean).map(l => { const [date, subject = ''] = l.split('\t'); return { date, subject }; });
  const ids = new Set(buildHandledList({ commits: log }).map(h => h.id));
  check('real history: the homepage title commit is found', ids.has('ARLO-2026-10-25-01') && ids.has('ARLO-2026-10-25-02'));
  check('real history: #346 shipped both 11-08 approvals', ids.has('ARLO-2026-11-08-03') && ids.has('ARLO-2026-11-08-04'));
}

console.log(failures
  ? `\n${failures} of ${checks} Arlo memory checks FAILED`
  : `All ${checks} Arlo memory checks passed.`);
process.exit(failures ? 1 : 0);
