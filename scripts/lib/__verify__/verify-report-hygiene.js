// scripts/lib/__verify__/verify-report-hygiene.js
//
// Arlo stage C (2026-11-11): the email says which listing an opportunity is
// about, approving ends in a receipt, and the daily noise is gone. Offline, no
// secrets: Clarity and Resend are stubbed through fetch.
//   node scripts/lib/__verify__/verify-report-hygiene.js

import { readFileSync } from 'fs';
import { labelOpportunityHost, labelOpportunityHosts, hostShare, LEVERS } from '../opportunity-host.js';
import { isLiveSitePage, splitClarityPages, runScheduleLine, SCHEDULED_UTC } from '../report-hygiene.js';
import { parseApprovalLog, idFromTitle, buildReceipt } from '../approval-receipt.js';

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

// ── 1. Opportunities by address ──────────────────────────────────────────────
// The 2026-10-25 shape: one blended "weak CTR at ~3-4" that was really the
// Google profile at ~1.5 and www at ~17.
const hostQueries = [
  { query: 'bronx property management companies', hosts: {
    apex: { clicks: 2, impressions: 140, position: 1.5 },
    www:  { clicks: 1, impressions: 60,  position: 17.2 },
  } },
  { query: 'bronx property management', hosts: {
    www:  { clicks: 3, impressions: 90, position: 14.1 },
    apex: { clicks: 0, impressions: 30, position: 6.0 },
  } },
  { query: 'apex only query', hosts: { apex: { clicks: 0, impressions: 50, position: 2 } } },
  { query: 'empty query', hosts: {} },
];
const weak = { kind: 'weak-ctr', subject: 'Bronx Property Management Companies', evidence: 'Blended evidence.' };
const profile = labelOpportunityHost(weak, hostQueries);
check('profile-led query is labelled google-profile', profile.lever === LEVERS.PROFILE);
check('match is case-insensitive', profile.lever !== LEVERS.UNKNOWN);
check('profile evidence keeps the original text', profile.evidence.startsWith('Blended evidence.'));
check('profile evidence gives the share on the old address', /70% of the impressions are on the old address/.test(profile.evidence));
check('profile evidence quotes www position on its own', /www\) sits at position 17\.2/.test(profile.evidence));
check('profile evidence says the title is not the lever', /will not move the map listing/.test(profile.evidence) && /Google Business Profile is the lever/.test(profile.evidence));
check('the input opportunity is not mutated', weak.lever === undefined && weak.evidence === 'Blended evidence.');

const site = labelOpportunityHost({ kind: 'striking-distance', subject: 'bronx property management', evidence: 'E.' }, hostQueries);
check('www-led query is labelled website', site.lever === LEVERS.WEBSITE);
check('website evidence quotes www position', /www\) sits at position 14\.1/.test(site.evidence));
check('website evidence does not call the profile the lever', !/Google Business Profile is the lever/.test(site.evidence));

const apexOnly = labelOpportunityHost({ kind: 'weak-ctr', subject: 'apex only query', evidence: 'E.' }, hostQueries);
check('apex-only query is the profile', apexOnly.lever === LEVERS.PROFILE);
check('apex-only evidence says www does not appear', /does not appear for it/.test(apexOnly.evidence));

const unknown = labelOpportunityHost({ kind: 'weak-ctr', subject: 'not in the split', evidence: 'E.' }, hostQueries);
check('query missing from the split is unknown', unknown.lever === LEVERS.UNKNOWN);
check('unknown evidence is unchanged', unknown.evidence === 'E.');
check('empty host entry is unknown', labelOpportunityHost({ kind: 'weak-ctr', subject: 'empty query', evidence: 'E.' }, hostQueries).lever === LEVERS.UNKNOWN);
check('no hostQueries at all is unknown, not a crash', labelOpportunityHost({ kind: 'weak-ctr', subject: 'x', evidence: 'E.' }, undefined).lever === LEVERS.UNKNOWN);

const page = labelOpportunityHost({ kind: 'impressions-no-clicks', subject: 'https://www.doryangel.com/blog/x/', evidence: 'P.' }, hostQueries);
check('page-level opportunity is website and untouched', page.lever === LEVERS.WEBSITE && page.evidence === 'P.');
check('orphan-links opportunity is website', labelOpportunityHost({ kind: 'missing-internal-links', subject: '5 posts', evidence: 'O.' }, hostQueries).lever === LEVERS.WEBSITE);
check('labelOpportunityHosts maps every item', labelOpportunityHosts([weak, page], hostQueries).length === 2);
check('labelOpportunityHosts tolerates null', labelOpportunityHosts(null, hostQueries).length === 0);
check('hostShare: exactly half on apex counts as the profile',
  labelOpportunityHost({ kind: 'weak-ctr', subject: 'q', evidence: 'E.' },
    [{ query: 'q', hosts: { apex: { impressions: 50, clicks: 0, position: 2 }, www: { impressions: 50, clicks: 0, position: 20 } } }]).lever === LEVERS.PROFILE);
check('hostShare counts beta in the total', Math.round(hostShare({ hosts: { apex: { impressions: 40 }, www: { impressions: 40 }, beta: { impressions: 20 } } }).apexShare * 100) === 40);

// ── 2. Clarity without Vercel previews ───────────────────────────────────────
check('www page is live', isLiveSitePage('https://www.doryangel.com/'));
check('apex page is live', isLiveSitePage('http://doryangel.com/blog/x'));
check('host without scheme is live', isLiveSitePage('www.doryangel.com/faq/'));
check('vercel preview is not live', !isLiveSitePage('https://doryangel-web-3-carousel-blog-git-x-dror.vercel.app/'));
check('look-alike host is not live', !isLiveSitePage('https://doryangel.com.evil.example/'));
check('beta is not live', !isLiveSitePage('https://beta.doryangel.com/'));
check('empty url is not live', !isLiveSitePage('') && !isLiveSitePage(null));
const split = splitClarityPages([
  { url: 'https://www.doryangel.com/', visits: 20 },
  { url: 'https://abc-dror.vercel.app/', visits: 5 },
  { url: 'https://www.doryangel.com/blog/x/', visits: 7 },
  { url: 'https://def-dror.vercel.app/blog/', visits: 2 },
]);
check('the 2026-11-09 shape: 7 preview visits are excluded', split.excludedVisits === 7);
check('live pages are kept', split.live.length === 2);

// ── 3. The footer states the real schedule ───────────────────────────────────
const wf = readFileSync('.github/workflows/daily-website-audit.yml', 'utf8');
const cron = wf.match(/cron:\s*['"]?(\d+)\s+(\d+)\s/);
check('the audit workflow has a cron', Boolean(cron));
check('SCHEDULED_UTC matches the workflow cron',
  cron && SCHEDULED_UTC === `${String(cron[2]).padStart(2, '0')}:${String(cron[1]).padStart(2, '0')}`);
const line = runScheduleLine(new Date('2026-11-11T22:30:00Z'));
check('schedule line names UTC', /14:00 UTC/.test(line));
check('schedule line warns runs start late', /hours late/.test(line));
check('schedule line gives the New York build time', /11\/11 17:30 New York/.test(line));
check('schedule line gives the Israel build time', /12\/11 00:30 Israel/.test(line));
const auditSrc = readFileSync('scripts/daily-audit.js', 'utf8');
check('the old "9 AM EST" claim is gone', !/9 AM EST/.test(auditSrc));

// ── 4. The approval receipt ──────────────────────────────────────────────────
const okLog = 'Authenticated owner approval verified for ARLO-2026-11-22-02.\nAll validations passed.\n\nPull request opened (NOT merged): https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog/pull/361\nReview and merge it yourself';
const badLog = 'Authenticated owner approval verified for ARLO-2026-11-22-03.\n\nREFUSED: ARLO-2026-11-22-03 is already approved.\n';
check('PR url is read from the log', parseApprovalLog(okLog).prUrl === 'https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog/pull/361');
check('refusal reason is read from the log', parseApprovalLog(badLog).refusal === 'ARLO-2026-11-22-03 is already approved.');
check('the bridge refusal shape is read too', parseApprovalLog('REFUSED: actor must be dror75p-ops').refusal === 'actor must be dror75p-ops');
check('an empty log gives no PR and no reason', !parseApprovalLog('').prUrl && !parseApprovalLog(null).refusal);
check('id is read from the issue title', idFromTitle('Arlo approval: ARLO-2026-11-22-02') === 'ARLO-2026-11-22-02');
check('a bad title gives no id', idFromTitle('Arlo approval: something') === null);

const okR = buildReceipt({ outcome: 'success', id: 'ARLO-2026-11-22-02', issueUrl: 'https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog/issues/360', log: okLog });
check('success subject says approval received', /approval received for ARLO-2026-11-22-02/.test(okR.subject));
check('success body links the PR', okR.html.includes('/pull/361'));
check('success body says merge is still manual', /until you merge it/.test(okR.html));
const badR = buildReceipt({ outcome: 'failure', id: 'ARLO-2026-11-22-03', issueUrl: '', log: badLog });
check('failure subject says NOT accepted', /NOT accepted for ARLO-2026-11-22-03/.test(badR.subject));
check('failure body gives the reason', badR.html.includes('is already approved'));
check('failure with no log still explains', /failed before giving a reason/.test(buildReceipt({ outcome: 'failure', log: '' }).html));
check('the receipt carries no approve link', ![okR.html, badR.html].some(h => /href="[^"]*(approve|webhook|hook\.)/i.test(h)));
check('the receipt escapes the refusal text', !buildReceipt({ outcome: 'failure', log: 'REFUSED: <script>x</script>' }).html.includes('<script>'));

const gw = readFileSync('.github/workflows/arlo-owner-approval.yml', 'utf8');
check('approval workflow sends the receipt', /node scripts\/arlo-approval-receipt\.js/.test(gw));
check('receipt step runs on success and failure', /if: always\(\) && steps\.gate\.outcome != 'skipped'/.test(gw));
check('approval step keeps its exit code through tee', /set -o pipefail/.test(gw));
check('issue title reaches the receipt through env, not shell interpolation', /ISSUE_TITLE: \$\{\{ github\.event\.issue\.title \}\}/.test(gw) && !/run:[^\n]*github\.event\.issue\.title/.test(gw));
const receiptSrc = readFileSync('scripts/arlo-approval-receipt.js', 'utf8');
check('receipt script never touches the repository', !/execFileSync|execSync|git\b|api\.github\.com/.test(receiptSrc.replace(/^\/\/.*$/gm, '')));
const page2 = readFileSync('arlo-approve.html', 'utf8');
check('approval page tells the owner to press Create', /green <strong>Create<\/strong> button/.test(page2));
check('approval page says no email means no approval', /No email means nothing was approved/.test(page2));
check('prefilled issue body still starts with APPROVE', /const body='APPROVE '\+id/.test(page2));
const reminder = readFileSync('scripts/arlo-approval-reminder.js', 'utf8');
check('decision email names the Create step and the receipt', /green <strong>Create<\/strong>/.test(reminder) && /approval received/.test(reminder));

// ── 5. The rendered daily email ──────────────────────────────────────────────
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('resend')) { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: 'x' }), { status: 200 }); }
  if (u.includes('clarity.ms')) {
    return new Response(JSON.stringify([
      { metricName: 'Traffic', information: [{ totalSessionCount: 34, distinctUserCount: 30 }] },
      { metricName: 'PopularPages', information: [
        { url: 'https://www.doryangel.com/', visitsCount: 20 },
        { url: 'https://doryangel-web-3-carousel-blog-git-a-dror.vercel.app/', visitsCount: 5 },
        { url: 'https://www.doryangel.com/broker-partner.html', visitsCount: 7 },
        { url: 'https://doryangel-web-3-carousel-blog-b-dror.vercel.app/blog/', visitsCount: 2 },
      ] },
    ]), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
process.env.RESEND_API_KEY = 're_test';
process.env.CLARITY_API_TOKEN = 'stub';
const m = await import('../../daily-audit.js');

const clarity = await m.getClarityStats();
check('Clarity stats come back', Boolean(clarity));
check('Clarity top pages hold no Vercel address', clarity && clarity.topPages.every(p => !/vercel\.app/.test(p.url)));
check('Clarity counts the excluded preview visits', clarity && clarity.previewVisits === 7);

const state = { stats: { posts: { day: 0, week: 0, month: 0, total: 1 }, commits: { day: 0, week: 0, month: 0 } }, categoryCounts: {}, postCount: 1, recentPosts: [] };
const base = { taskLabel: 'Build a cost calculator hub', taskWhy: 'Today\'s idea overlapped the open issue "Cost hub", so nothing was filed.', resultLink: 'https://github.com/x/issues', state, ga4: null, make: null, clarity, gsc: null, improvement: null };
await m.sendDigest({ ...base, resultType: 'deduped' });
await m.sendDigest({ ...base, resultType: 'issue', taskWhy: 'A real reason.' });
const [dedupedMail, issueMail] = sent;
check('deduped day: neutral subject', dedupedMail && /daily report$/.test(dedupedMail.subject) && !dedupedMail.subject.includes('cost calculator'));
check('deduped day: no "Today:" headline', dedupedMail && !dedupedMail.html.includes('Today: Build a cost calculator hub'));
check('deduped day: one grey line says no new task', dedupedMail && /No new task today\./.test(dedupedMail.html));
check('deduped day: no "Issue created" box', dedupedMail && !dedupedMail.html.includes('GitHub Issue created'));
check('issue day: headline and box still render', issueMail && issueMail.html.includes('Today: Build a cost calculator hub') && issueMail.html.includes('GitHub Issue created'));
check('issue day: subject still names the task', issueMail && issueMail.subject.includes('Build a cost calculator hub'));
check('footer states the real schedule', dedupedMail && /scheduled for 14:00 UTC/.test(dedupedMail.html) && !/9 AM EST/.test(dedupedMail.html));
check('Clarity note discloses the preview visits', dedupedMail && /leave out 7 visits to Vercel test/.test(dedupedMail.html));
check('Clarity table shows no Vercel address', dedupedMail && !/vercel\.app/.test(dedupedMail.html));

const html = m.renderImprovementSections({
  ran: true, reportDate: '2026-11-22', recommendations: [{ id: 'ARLO-2026-11-22-01', priority: 'high', action: 'site-change', title: 't', what: 'w', why: 'y', expectedResult: 'e', metric: 'm', measurementWindow: '28d', baseline: null }],
  experiments: [], scout: { used: 0 }, gscCalls: 0,
  opportunities: labelOpportunityHosts([weak, { kind: 'striking-distance', subject: 'bronx property management', evidence: 'E.' }], hostQueries),
});
check('opportunity table shows the Google profile label', html.includes('>Google profile</span>'));
check('opportunity table shows the Website label', html.includes('>Website</span>'));
check('daily email points to the decision email first', /use the separate "ACTION REQUIRED" email/.test(html));
check('daily email explains the Create step and the receipt', /green <strong>Create<\/strong>/.test(html) && /approval received/.test(html));
check('the terminal command is kept only as a backup', /Backup for a legal-review item/.test(html) && html.indexOf('ACTION REQUIRED') < html.indexOf('queue-approved-post.js --id'));
check('still no approval URL in the daily email', !/href="[^"]*(approve|webhook|hook\.make|hook\.eu1)/i.test(html));

globalThis.fetch = realFetch;
console.log(`Report hygiene: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
