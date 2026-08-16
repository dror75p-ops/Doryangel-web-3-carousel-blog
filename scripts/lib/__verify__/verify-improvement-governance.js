// scripts/lib/__verify__/verify-improvement-governance.js
//
// Governance regression check for Arlo's continuous-improvement loop. Run with:
//   node scripts/lib/__verify__/verify-improvement-governance.js
//
// This is not a unit-test suite for convenience functions. Every check here
// guards a boundary where AUTHORITY changes hands, and each one exists because
// the failure it catches would be silent:
//
//   • analysis that can write the blog index is a publisher, not an analyst
//   • an approval script reachable from CI is not a human gate
//   • a legal flag that can be bypassed is a comment, not a control
//   • a cadence that re-fires re-spends the search budget and overlaps windows
//   • a state file that accumulates fields ends up carrying PII into a public repo
//
// Offline: no network, no API keys, no writes outside a temp directory that is
// removed at the end. content/blog/posts-index.json is only ever read.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  CYCLE_DAYS, ALLOWED_CYCLE_STATE_KEYS, CYCLE_STATE_FILE, POSTS_INDEX_FILE,
  sanitizeCycleState, isCycleDue,
  APPROVED_CATEGORIES, resolveCategory, isApprovedCategory,
  requiresLegalReview, legalReviewReasons,
  findDuplicate, titleSimilarity, validateBrief, findSubjectOverlap, subjectNouns,
  scoreRecommendation, makeRecommendationId, RECOMMENDATION_ID_RE,
  findPII, redactPII, withBlogIndexFrozen, fileFingerprint,
} from '../improvement-governance.js';

const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}
function section(name) { console.log(`\n── ${name}`); }

// ─── 1. The recommendation engine cannot modify posts-index.json ─────────────
//
// Two halves: the runtime guard actually trips, and the source of daily-audit.js
// contains no write to the blog index in the first place.

section('1. Recommendation analysis is read-only w.r.t. the blog index');

const indexBefore = fileFingerprint(POSTS_INDEX_FILE);
check('fileFingerprint reads the real blog index', typeof indexBefore === 'string' && indexBefore.length === 64);

// A well-behaved cycle passes through untouched.
let passedThrough = false;
await withBlogIndexFrozen('read-only analysis', async () => {
  JSON.parse(readFileSync(POSTS_INDEX_FILE, 'utf8'));   // reading is fine
  passedThrough = true;
});
check('a read-only analysis phase completes normally', passedThrough);

// A misbehaving one is caught. The write is made against a real copy of the file
// and reverted in the finally block, so the repo is never left modified.
const original = readFileSync(POSTS_INDEX_FILE);
let tripped = false;
try {
  await withBlogIndexFrozen('a cycle that writes the blog index', async () => {
    writeFileSync(POSTS_INDEX_FILE, original.toString().replace(/\n$/, '') + '\n');
    writeFileSync(POSTS_INDEX_FILE, JSON.stringify([...posts, { slug: 'injected-by-test' }], null, 2));
  });
} catch (e) {
  tripped = /GOVERNANCE VIOLATION/.test(e.message);
} finally {
  writeFileSync(POSTS_INDEX_FILE, original);
}
check('withBlogIndexFrozen throws a GOVERNANCE VIOLATION when the index is written', tripped);
check('the blog index was restored by this test', fileFingerprint(POSTS_INDEX_FILE) === indexBefore);

// Static half: nothing in the cycle section of daily-audit.js writes the index.
const auditSrc = readFileSync('./scripts/daily-audit.js', 'utf8');
const cycleStart = auditSrc.indexOf('CONTINUOUS IMPROVEMENT CYCLE');
const cycleEnd = auditSrc.indexOf('─── Auto-implementable improvements');
check('the improvement-cycle section is present in daily-audit.js', cycleStart > 0 && cycleEnd > cycleStart);
const cycleSrc = auditSrc.slice(cycleStart, cycleEnd);
check('no write to posts-index.json inside the improvement cycle',
  !/writeFileSync\s*\(\s*[^)]*posts-index/i.test(cycleSrc) && !/writeJsonFile\s*\(\s*POSTS_INDEX_FILE/.test(cycleSrc));
// Mentioning the approval script in a comment is fine and in fact desirable —
// what must not exist is a code path that RUNS it. Strip comments, then look for
// any execution or import of it.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const cycleCode = stripComments(cycleSrc);
check('the improvement cycle never invokes the approval script',
  !/queue-approved-post/.test(cycleCode));
check('the improvement cycle shells out to nothing that could publish',
  !/exec(File)?Sync\([^)]*queue-approved/.test(cycleCode) && !/import\([^)]*queue-approved/.test(cycleCode));
check('daily-audit.js wraps the cycle in withBlogIndexFrozen',
  /withBlogIndexFrozen\(\s*\n?\s*'the 14-day improvement cycle'/.test(auditSrc));

// ─── 2. queue-approved-post.js is absent from every workflow ─────────────────
//
// Checked TWICE, by two independent methods, because this is the check that
// would let an agent approve its own work if it ever silently stopped working.

section('2. The approval script is unreachable from GitHub Actions (checked twice)');

const workflowDir = '.github/workflows';
const workflowFiles = readdirSync(workflowDir).filter(f => /\.ya?ml(\.disabled)?$/.test(f));
check('workflow directory contains workflows to scan', workflowFiles.length > 0);

// Method A — read each workflow file and search its full text.
const offendersA = workflowFiles.filter(f =>
  readFileSync(join(workflowDir, f), 'utf8').includes('queue-approved-post')
);
check(`CHECK #1 — no workflow file mentions queue-approved-post.js (scanned ${workflowFiles.length})`, offendersA.length === 0);
if (offendersA.length) console.error(`       offending workflows: ${offendersA.join(', ')}`);

// Method B — concatenate every file under .github/ (workflows, actions, anything
// added later) and search the whole blob. Deliberately a different traversal, so
// a bug in one does not hide a breach from the other.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const allGithubFiles = walk('.github');
const blob = allGithubFiles.map(p => readFileSync(p, 'utf8')).join('\n');
check(`CHECK #2 — nothing anywhere under .github/ references it (scanned ${allGithubFiles.length} files)`,
  !blob.includes('queue-approved-post'));

// And the runtime guard is present in the script itself.
const approvalSrc = readFileSync('./scripts/queue-approved-post.js', 'utf8');
check('the approval script refuses to run when GITHUB_ACTIONS is set',
  /GITHUB_ACTIONS/.test(approvalSrc) && /refuseUnderCI\(\)/.test(approvalSrc));
const approvalCode = stripComments(approvalSrc);
check('the approval script never merges a pull request',
  !/\/merge\b/.test(approvalCode) && !/merge_method/.test(approvalCode));
check('the approval script never pushes to main',
  !/git\('push'[^)]*'main'/.test(approvalCode) && !/push[^\n;]*\bmain\b/.test(approvalCode));
check('every git push targets the approval branch',
  [...approvalCode.matchAll(/git\('push',([^)]*)\)/g)].every(m => /branch/.test(m[1])));

// ─── 3. Legal review is a blocking control ───────────────────────────────────

section('3. Legal-review classification and gate');

const legalSubjects = [
  'How to handle an HPD violation on your Bronx building',
  'What Bronx landlords owe tenants during an eviction',
  'Local Law 97 compliance deadlines for small Bronx buildings',
  'Rent-stabilized renewals: what Good Cause changed',
  'Bronx landlord tax deductions you are probably missing',
  'What happens in NYC housing court when a tenant stops paying',
];
for (const s of legalSubjects) check(`legal flag fires on "${s.slice(0, 45)}…"`, requiresLegalReview(s));
check('legal reasons are reported, not just a boolean', legalReviewReasons(legalSubjects[0]).length > 0);

const nonLegalSubjects = [
  'What should a Bronx landlord check on the roof before fall hits?',
  'Bronx vs. Yonkers: which boiler service contract costs less?',
  'How to photograph a vacant Bronx apartment so it rents faster',
];
for (const s of nonLegalSubjects) check(`legal flag stays off for "${s.slice(0, 45)}…"`, !requiresLegalReview(s));

// The gate itself: the approval script must refuse without --legal-reviewed.
check('the approval script blocks on legal review unless --legal-reviewed is passed',
  /legalRequired\s*&&\s*!args\.legalReviewed/.test(approvalSrc));
check('the approval script recomputes the legal flag rather than trusting the recommendation',
  /requiresLegalReview\(rec\.title/.test(approvalSrc) && /Boolean\(rec\.legal_review_required\)\s*\|\|\s*legalByRule/.test(approvalSrc));

// ─── 4. Category allowlist ───────────────────────────────────────────────────

section('4. Category allowlist');

check('exactly three categories are queueable', APPROVED_CATEGORIES.length === 3);
for (const c of APPROVED_CATEGORIES) check(`"${c}" is approved`, isApprovedCategory(c));
for (const c of ['property-automation', 'broker-partnerships', 'seo', 'news', '', null, undefined, 'DIY-PROPERTY-MGMT']) {
  check(`"${c}" is rejected`, !isApprovedCategory(c));
}
check('the "PM" alias resolves to the real slug', resolveCategory('PM') === 'property-management');
check('the "DIY" alias resolves to the real slug', resolveCategory('DIY') === 'diy-property-management');
check('every approved category exists in the live catalogue',
  APPROVED_CATEGORIES.every(c => posts.some(p => p.category === c)));

// ─── 5. Schema validation ────────────────────────────────────────────────────

section('5. Brief schema validation');

const goodBrief = {
  slug: 'how-much-does-a-bronx-super-actually-save-you-each-winter',
  title: 'How Much Does a Bronx Super Actually Save You Each Winter?',
  category: 'property-management',
  excerpt: 'A live-in super costs money every month. Here is the arithmetic on whether one pays for itself in a small Bronx building.',
  author: 'DoryAngel Team',
  featured: false,
};
check('a well-formed brief validates', validateBrief(goodBrief, posts).ok);

const badBriefs = [
  ['missing required field', { title: 'A title', category: 'investments', excerpt: 'x' }],
  ['invalid category', { ...goodBrief, slug: 'unique-slug-a', category: 'property-automation' }],
  ['unknown field', { ...goodBrief, slug: 'unique-slug-b', tags: ['x'] }],
  ['carries a Nave-owned field', { ...goodBrief, slug: 'unique-slug-c', content: '# body' }],
  ['carries a publish date', { ...goodBrief, slug: 'unique-slug-d', publishedDate: '2026-08-16' }],
  ['bad slug shape', { ...goodBrief, slug: 'Not A Slug' }],
  ['seoTitle too long', { ...goodBrief, slug: 'unique-slug-e', seoTitle: 'x'.repeat(60) + ' | DoryAngel' }],
  ['seoTitle missing the suffix', { ...goodBrief, slug: 'unique-slug-f', seoTitle: 'A perfectly short title' }],
  ['seoDescription too long', { ...goodBrief, slug: 'unique-slug-g', seoDescription: 'x'.repeat(156) }],
  ['hashtags not an array', { ...goodBrief, slug: 'unique-slug-h', hashtags: 'bronx' }],
  ['wrong author', { ...goodBrief, slug: 'unique-slug-i', author: 'Anonymous' }],
  ['not an object', 'a string'],
];
for (const [label, brief] of badBriefs) {
  check(`schema rejects: ${label}`, !validateBrief(brief, posts).ok);
}

// ─── 6 & 7. Duplicate detection: slug, exact title, fuzzy title ──────────────

section('6/7. Duplicate detection');

const realPost = posts[0];
check('duplicate slug is caught', findDuplicate(posts, { slug: realPost.slug, title: 'A totally different headline' })?.kind === 'slug');
check('exact title is caught (even with a fresh slug)',
  findDuplicate(posts, { slug: 'a-brand-new-unused-slug-here', title: realPost.title })?.kind === 'exact-title');
check('exact title is caught through punctuation/case differences',
  ['exact-title', 'fuzzy-title'].includes(
    findDuplicate(posts, { slug: 'another-unused-slug', title: realPost.title.toUpperCase().replace(/[.,:]/g, '') })?.kind
  ));
check('a genuinely new topic is not flagged',
  findDuplicate(posts, { slug: 'bronx-elevator-inspection-costs-for-six-unit-walkups', title: 'What Does an Elevator Modernization Quote Actually Include in the Bronx?' }) === null);

// Fuzzy matching catches a REWORDING of the same headline...
const reworded = realPost.title.replace(/\bYour\b/i, 'A').replace(/\?$/, ' — the real numbers?');
check('fuzzy match catches a reworded version of a published title',
  findDuplicate(posts, { slug: 'a-fresh-unused-slug-for-this-test', title: reworded })?.kind === 'fuzzy-title');

// ...but it provably CANNOT catch a restatement, and the test says so rather
// than pretending otherwise. These two shipped two days apart in 2026 and
// competed for the same queries; they share two tokens and score ~0.33. The
// threshold that would catch them flags 152 of 2,016 published pairs.
const hvacA = 'Bronx vs. Mt. Vernon HVAC: Who Pays Less?';
const hvacB = 'Bronx vs. Queens AC Repair Costs';
const hvacScore = titleSimilarity(hvacA, hvacB);
console.log(`   the 2026 HVAC/AC duplicate pair scores ${hvacScore.toFixed(2)} on token overlap — below any usable threshold`);
check('the documented limitation is real: token overlap does NOT catch that pair', hvacScore < 0.55);

// Layer 4 is what catches it: same category, same physical subject.
check('subject overlap catches the real 2026 duplicate pair',
  findSubjectOverlap(
    [{ slug: 'a', title: hvacA, category: 'diy-property-management' }],
    { slug: 'b', title: hvacB, category: 'diy-property-management' }
  ).length === 1);
check('subject overlap does not fire across different categories',
  findSubjectOverlap(
    [{ slug: 'a', title: hvacA, category: 'investments' }],
    { slug: 'b', title: hvacB, category: 'diy-property-management' }
  ).length === 0);
check('subject overlap ignores a title naming no building system',
  findSubjectOverlap(posts, { slug: 'x', title: 'What Should You Ask a Bronx Property Manager on the First Call?', category: 'property-management' }).length === 0);

// And it stays quiet enough on the live catalogue to be usable as a gate.
const pairCount = (posts.length * (posts.length - 1)) / 2;
let subjectPairs = 0;
for (let i = 0; i < posts.length; i++) {
  for (let j = i + 1; j < posts.length; j++) {
    if (posts[i].category !== posts[j].category) continue;
    const shared = [...subjectNouns(posts[i].title)].filter(n => subjectNouns(posts[j].title).has(n));
    if (shared.length) subjectPairs++;
  }
}
console.log(`   subject overlap flags ${subjectPairs}/${pairCount} published pairs`);
check('subject overlap flags under 3% of published pairs', subjectPairs / pairCount < 0.03);
check('the approval script blocks on subject overlap unless acknowledged',
  /overlap\.length\s*&&\s*!args\.allowSubjectOverlap/.test(approvalCode));

// And does NOT collapse distinct posts in the same category — the failure mode
// that would make the whole gate useless by rejecting everything.
let falsePositives = 0;
for (let i = 0; i < posts.length; i++) {
  for (let j = i + 1; j < posts.length; j++) {
    if (titleSimilarity(posts[i].title, posts[j].title) >= 0.55) falsePositives++;
  }
}
console.log(`   fuzzy threshold flags ${falsePositives}/${pairCount} published pairs as near-duplicates`);
check('the fuzzy threshold does not collapse the existing catalogue (<2% of pairs)',
  falsePositives / pairCount < 0.02);

// ─── 8. Duplicate 14-day invocation is a no-op ───────────────────────────────

section('8. Cadence enforcement');

check('a cycle that has never run is due', isCycleDue({}, '2026-08-16'));
check('a cycle that ran today is NOT due again today', !isCycleDue({ lastCycleDate: '2026-08-16' }, '2026-08-16'));
check('a second invocation on the same day is a no-op', !isCycleDue({ lastCycleDate: '2026-08-16' }, '2026-08-16'));
check(`${CYCLE_DAYS - 1} days later is still not due`, !isCycleDue({ lastCycleDate: '2026-08-16' }, '2026-08-29'));
check(`${CYCLE_DAYS} days later is due`, isCycleDue({ lastCycleDate: '2026-08-16' }, '2026-08-30'));
check('a clock that went backwards does not re-trigger', !isCycleDue({ lastCycleDate: '2026-08-16' }, '2026-08-10'));
check('a corrupt state file is treated as never-run rather than crashing', isCycleDue({ lastCycleDate: 'garbage' }, '2026-08-16'));
check('the cadence is enforced in code, not by cron alone', /isCycleDue\(state, todayISO\)/.test(auditSrc));

// ─── 9. The state file carries only minimal state ────────────────────────────

section('9. Cadence state file is minimal');

check('exactly one key is allowed', ALLOWED_CYCLE_STATE_KEYS.length === 1 && ALLOWED_CYCLE_STATE_KEYS[0] === 'lastCycleDate');
const dirtyState = {
  lastCycleDate: '2026-08-16',
  apiToken: 'sk-ant-not-a-real-key',
  leads: [{ name: 'A Real Person', email: 'person@example.com', phone: '718-555-0134' }],
  lastGscResponse: { rows: [1, 2, 3] },
};
const cleaned = sanitizeCycleState(dirtyState);
check('sanitize drops everything except lastCycleDate', Object.keys(cleaned).length === 1 && cleaned.lastCycleDate === '2026-08-16');
check('sanitize drops credentials', !('apiToken' in cleaned));
check('sanitize drops lead data', !('leads' in cleaned));
check('sanitize drops raw API payloads', !('lastGscResponse' in cleaned));
check('sanitize rejects a malformed date', !('lastCycleDate' in sanitizeCycleState({ lastCycleDate: 'yesterday' })));
check('sanitize survives junk input', Object.keys(sanitizeCycleState(null)).length === 0 && Object.keys(sanitizeCycleState([1, 2])).length === 0);

// If a state file exists on disk, it must obey the same rule.
if (existsSync(CYCLE_STATE_FILE)) {
  const onDisk = JSON.parse(readFileSync(CYCLE_STATE_FILE, 'utf8'));
  check('the committed state file has no unexpected keys',
    Object.keys(onDisk).every(k => ALLOWED_CYCLE_STATE_KEYS.includes(k)));
}

// ─── 10. Reports contain no lead PII ─────────────────────────────────────────

section('10. PII handling');

check('an email address is detected', findPII('contact sarah.jones@gmail.com about the unit').length === 1);
check('a phone number is detected', findPII('call 718-555-0134 tomorrow').length === 1);
check('the business\'s own published address is not treated as a leak', findPII('email office@doryangel.com').length === 0);
check('redaction removes the address', !redactPII('write to sarah.jones@gmail.com').includes('sarah.jones@gmail.com'));
check('redaction leaves ordinary prose intact', redactPII('impressions rose 14% on /blog/bronx-roof-check/') === 'impressions rose 14% on /blog/bronx-roof-check/');
check('the cycle redacts model output before storing it', /redactPII\(/.test(cycleSrc));
check('the approval script refuses to commit anything carrying PII', /findPII\(/.test(approvalSrc));

// Lead reporting must stay aggregate: getMakeStats returns counts, never rows.
const makeStart = auditSrc.indexOf('async function getMakeStats');
const makeSrc = auditSrc.slice(makeStart, auditSrc.indexOf('async function getClarityStats'));
check('lead stats return counts only — no name/email/phone values are propagated',
  !/out\.(name|email|phone)\s*=/.test(makeSrc) && !/rows\.map\(r => r\[sheet\.(name|email|phone)Col\]\)/.test(makeSrc));

// ─── 11. No secrets in source, reports, state or logs ────────────────────────

section('11. Secret handling');

const sources = {
  'daily-audit.js': auditSrc,
  'queue-approved-post.js': approvalSrc,
  'improvement-governance.js': readFileSync('./scripts/lib/improvement-governance.js', 'utf8'),
};
// Real key shapes, not the words. Deliberately narrow so the comments that
// *discuss* secrets by name do not trip it.
const SECRET_SHAPES = [
  /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"private_key"\s*:\s*"[^"]{40,}"/,
  /AIza[0-9A-Za-z_-]{30,}/,
];
for (const [name, src] of Object.entries(sources)) {
  for (const re of SECRET_SHAPES) check(`${name} contains no hardcoded secret (${re.source.slice(0, 22)}…)`, !re.test(src));
  check(`${name} reads credentials from process.env only`,
    !/(?:API_KEY|SA_KEY|TOKEN|SECRET)\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]/.test(src));
}
check('no token or key is ever logged by the cycle',
  !/console\.log\([^)]*(process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)|credentials\.private_key)/.test(cycleSrc));
check('the cadence state file is written with a literal single key, not a spread',
  /writeJsonFile\(CYCLE_STATE_FILE,\s*\{\s*lastCycleDate: dateISO\s*\}\)/.test(auditSrc));

// ─── 12. Approval produces a PR, never an automatic merge ────────────────────

section('12. Approval opens a PR and stops');

check('the approval script creates a branch', /git\('checkout', '-b', branch\)/.test(approvalSrc));
check('the approval script opens a pull request against main', /base: 'main'/.test(approvalSrc));
check('the approval script states the PR is NOT merged', /NOT merged/.test(approvalSrc));
check('the PR body carries the recommendation ID', /Recommendation ID/.test(approvalSrc));
check('the PR body carries the report date', /Arlo report date/.test(approvalSrc));
check('the PR body records manual approval', /Manual approval/.test(approvalSrc));
check('the PR body records the approver', /Approved by/.test(approvalSrc));
check('the PR body records the legal-review outcome', /Legal review/.test(approvalSrc));
check('nothing is written before validation passes',
  approvalSrc.indexOf('All validations passed') < approvalSrc.indexOf('writeJson(APPROVED_QUEUE_FILE'));

// ─── 13. The recommendation email contains no approval mechanism ─────────────

section('13. No auto-approval path in the email');

const emailStart = auditSrc.indexOf('function renderImprovementSections');
const emailSrc = auditSrc.slice(emailStart, auditSrc.indexOf('async function sendDigest'));
check('the recommendation block has no approve/webhook URL',
  !/https?:\/\/[^\s"']*(approve|webhook|hook\.)/i.test(emailSrc));
check('the recommendation block tells the reader nothing was queued', /Nothing has been queued/.test(emailSrc));
check('the recommendation block names the manual command', /queue-approved-post\.js --id/.test(emailSrc));

// ─── 14. Scoring, IDs and cost cap ───────────────────────────────────────────

section('14. Prioritisation, IDs, cost cap');

check('a high-impact, cheap, well-evidenced item scores high', scoreRecommendation({ impact: 5, confidence: 5, effort: 1 }).priority === 'high');
check('a low-impact, expensive, speculative item scores low', scoreRecommendation({ impact: 1, confidence: 1, effort: 5 }).priority === 'low');
check('missing scores fall back to the middle rather than throwing', scoreRecommendation({}).priority === 'medium');
check('out-of-range scores are clamped', scoreRecommendation({ impact: 99, confidence: -4, effort: 0 }).impact === 5);
check('recommendation IDs match the documented shape', RECOMMENDATION_ID_RE.test(makeRecommendationId('2026-08-16', 2)));
check('recommendation IDs are zero-padded', makeRecommendationId('2026-08-16', 2) === 'ARLO-2026-08-16-02');
check('the external search budget is capped at 5', /SCOUT_SEARCH_BUDGET\s*=\s*5\b/.test(auditSrc));
check('the cap is passed to the search tool as max_uses', /max_uses:\s*SCOUT_SEARCH_BUDGET/.test(auditSrc));
check('the search count is read back from usage, not assumed',
  /usage\?\.server_tool_use\?\.web_search_requests/.test(auditSrc));
check('the report states how many searches were used', /External Scout searches/.test(emailSrc));

// ─── 15. The runner must commit what the cycle writes ────────────────────────
//
// The category-plan.json lesson: anything written on the runner and not added to
// a git add line is discarded with the container. For improvement-state.json
// that means the 14-day cadence resets and the expensive cycle runs every day.

section('15. Cycle output is committed by the workflow');

const auditWorkflow = readFileSync('.github/workflows/daily-website-audit.yml', 'utf8');
for (const f of ['improvement-state.json', 'recommendations.json', 'experiments.json']) {
  check(`daily-website-audit.yml commits project/seo/${f}`, auditWorkflow.includes(`project/seo/${f}`));
}
const publishWorkflow = readFileSync('.github/workflows/blog-autopublish.yml', 'utf8');
check('blog-autopublish.yml commits content/blog/approved-queue.json',
  publishWorkflow.includes('content/blog/approved-queue.json'));

// ─── 16. The approval gate, run for real ─────────────────────────────────────
//
// Every check above reads the approval script's source. These RUN it, as a
// subprocess, in a throwaway git repo — because a gate that is correct in source
// and broken in execution is still a broken gate. --dry-run is used so nothing
// is committed; the validations all run before the dry-run exit.

section('16. The approval gate, executed');

const gate = mkdtempSync(join(tmpdir(), 'arlo-gate-'));
mkdirSync(join(gate, 'content/blog'), { recursive: true });
mkdirSync(join(gate, 'project/seo'), { recursive: true });
mkdirSync(join(gate, 'scripts/lib'), { recursive: true });
writeFileSync(join(gate, 'content/blog/posts-index.json'), JSON.stringify(posts, null, 2));
cpSync('./scripts/queue-approved-post.js', join(gate, 'scripts/queue-approved-post.js'));
cpSync('./scripts/lib/improvement-governance.js', join(gate, 'scripts/lib/improvement-governance.js'));

// A recommendation set covering every refusal path plus one clean approval.
const cleanTitle = 'How Do You Vet a Bronx Elevator Modernization Quote Before Signing?';
writeFileSync(join(gate, 'project/seo/recommendations.json'), JSON.stringify({
  reportDate: '2026-08-16', cycleDays: 14, scoutSearchesUsed: 3, scoutSearchBudget: 5,
  recommendations: [
    { id: 'ARLO-2026-08-16-01', reportDate: '2026-08-16', action: 'new-content',
      targetSlug: 'how-do-you-vet-a-bronx-elevator-modernization-quote-before',
      title: cleanTitle, what: 'A walkthrough of what belongs in a modernization quote.',
      why: 'Related searches earn 140 impressions at position 16.',
      expectedResult: 'page-one entry', metric: 'position', measurementWindow: '28 days',
      category: 'property-management', baseline: null,
      impact: 4, confidence: 3, effort: 2, score: 6, priority: 'high',
      legal_review_required: false, legalReasons: [], duplicateOf: null, previouslyTried: null },

    { id: 'ARLO-2026-08-16-02', reportDate: '2026-08-16', action: 'new-content',
      targetSlug: 'what-a-bronx-landlord-owes-after-an-hpd-class-c-violation',
      title: 'What Does a Bronx Landlord Owe After an HPD Class C Violation?',
      what: 'The penalty schedule in plain English.', why: '180 impressions at position 14.',
      expectedResult: 'page-one entry', metric: 'position', measurementWindow: '28 days',
      category: 'property-management', baseline: null,
      impact: 5, confidence: 3, effort: 3, score: 5, priority: 'medium',
      legal_review_required: true, legalReasons: ['hpd'], duplicateOf: null, previouslyTried: null },

    { id: 'ARLO-2026-08-16-03', reportDate: '2026-08-16', action: 'new-content',
      targetSlug: 'a-bronx-listing-photo-automation-playbook',
      title: 'How Should a Bronx Landlord Automate Listing Photos?',
      what: 'A workflow post.', why: '60 impressions.',
      expectedResult: 'more clicks', metric: 'clicks', measurementWindow: '28 days',
      category: 'property-automation', baseline: null,          // ← not an approved category
      impact: 2, confidence: 2, effort: 4, score: 1, priority: 'low',
      legal_review_required: false, legalReasons: [], duplicateOf: null, previouslyTried: null },

    { id: 'ARLO-2026-08-16-04', reportDate: '2026-08-16', action: 'new-content',
      targetSlug: 'a-completely-unused-slug-for-the-duplicate-test',
      title: posts[0].title,                                     // ← duplicate of a published post
      what: 'Write it again.', why: 'It ranks.',
      expectedResult: 'more clicks', metric: 'clicks', measurementWindow: '28 days',
      category: posts[0].category, baseline: null,
      impact: 3, confidence: 2, effort: 3, score: 2, priority: 'low',
      legal_review_required: false, legalReasons: [], duplicateOf: null, previouslyTried: null },
  ],
}, null, 2));

const runGate = (args, env = {}) => {
  try {
    const stdout = execFileSync('node', ['scripts/queue-approved-post.js', ...args], {
      cwd: gate, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '', GITHUB_ACTIONS: '', ...env },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

// The CI refusal — the single most important behaviour in this file.
const inActions = runGate(['--id', 'ARLO-2026-08-16-01', '--dry-run'], { GITHUB_ACTIONS: 'true' });
check('running under GITHUB_ACTIONS is REFUSED', inActions.code === 2);
check('...with an explanation of why', /REFUSED[\s\S]*human approval gate/.test(inActions.out));
const inCI = runGate(['--id', 'ARLO-2026-08-16-01', '--dry-run'], { CI: 'true' });
check('running under a generic CI=true is REFUSED', inCI.code === 2);

// Legal gate.
const legalNoFlag = runGate(['--id', 'ARLO-2026-08-16-02', '--dry-run']);
check('a legal-review recommendation is REFUSED without --legal-reviewed', legalNoFlag.code === 1);
check('...and the refusal names the trigger', /hpd/i.test(legalNoFlag.out));
const legalWithFlag = runGate(['--id', 'ARLO-2026-08-16-02', '--legal-reviewed', '--dry-run']);
check('...and is accepted with --legal-reviewed', legalWithFlag.code === 0);
check('...recording that the confirmation was supplied', /confirmed by --legal-reviewed/.test(legalWithFlag.out));

// A recommendation the model did NOT flag, but whose text is regulated, must
// still be blocked — the classifier, not the model, holds the gate.
const unflaggedLegal = runGate(['--id', 'ARLO-2026-08-16-01', '--dry-run']);
check('a clean recommendation passes without the legal flag', unflaggedLegal.code === 0);

// Category allowlist.
const badCategory = runGate(['--id', 'ARLO-2026-08-16-03', '--dry-run']);
check('an unapproved category is REFUSED', badCategory.code === 1);
check('...naming the approved list', /diy-property-management/.test(badCategory.out));
check('...and refusing to create the category', /never created here/.test(badCategory.out));

// Duplicates.
const dup = runGate(['--id', 'ARLO-2026-08-16-04', '--dry-run']);
check('a duplicate title is REFUSED', dup.code === 1);

// Unknown ID and malformed ID.
check('an unknown recommendation ID is REFUSED', runGate(['--id', 'ARLO-2026-01-01-99', '--dry-run']).code === 1);
check('a malformed recommendation ID is REFUSED', runGate(['--id', 'not-an-id', '--dry-run']).code === 1);
check('no --id at all prints usage and exits non-zero', runGate([]).code === 2);

// Nothing was written by any of the above — every one used --dry-run.
check('no queue file was created during dry runs', !existsSync(join(gate, 'content/blog/approved-queue.json')));
check('no experiment ledger was created during dry runs', !existsSync(join(gate, 'project/seo/experiments.json')));
check('the sandbox blog index is untouched',
  JSON.parse(readFileSync(join(gate, 'content/blog/posts-index.json'), 'utf8')).length === posts.length);

// The full write path, in a real git repo, with --no-pr so nothing leaves the box.
// -b main so the "never commit to main, always branch" path is the one tested.
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: gate });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: gate });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fixture'], { cwd: gate });
const approved = runGate(['--id', 'ARLO-2026-08-16-01', '--approved-by', 'Dori', '--no-pr'], {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});
check('an approved recommendation completes', approved.code === 0);
check('...writing the approved queue', existsSync(join(gate, 'content/blog/approved-queue.json')));
check('...and the experiment ledger', existsSync(join(gate, 'project/seo/experiments.json')));

const queued = JSON.parse(readFileSync(join(gate, 'content/blog/approved-queue.json'), 'utf8'));
check('the queue entry records the recommendation ID', queued[0].recommendationId === 'ARLO-2026-08-16-01');
check('the queue entry records who approved it', queued[0].approvedBy === 'Dori');
check('the queue entry starts as pending', queued[0].status === 'pending');
check('the queued brief carries only blog-schema fields', validateBrief(queued[0].brief, []).ok);
check('the queue carries no personal data', findPII(readFileSync(join(gate, 'content/blog/approved-queue.json'), 'utf8')).length === 0);

// The integration seam: what the approval script writes must be exactly what
// Nave's nextApprovedBrief() looks for. These two live in different files and
// nothing else connects them, so a rename on either side would silently mean
// approved work is never published — and the failure would look like "Nave just
// didn't pick it up".
const naveSrc = readFileSync('./scripts/generate-post.js', 'utf8');
const naveCategories = [...(naveSrc.match(/const CATEGORIES = \[([^\]]*)\]/)?.[1] ?? '')
  .matchAll(/'([a-z-]+)'/g)].map(m => m[1]);
check('Nave\'s category list was found', naveCategories.length === 5);
check('Nave reads the same queue file the approval script writes',
  naveSrc.includes("'./content/blog/approved-queue.json'"));
check('Nave looks for the status the approval script writes', /status\s*!==\s*'pending'/.test(naveSrc));
check('Nave looks for the action the approval script writes', /action\s*!==\s*'new-content'/.test(naveSrc));
check('the queued brief\'s category is one Nave will accept', naveCategories.includes(queued[0].brief.category));
check('every approvable category is one Nave accepts',
  APPROVED_CATEGORIES.every(c => naveCategories.includes(c)));
check('Nave marks the brief consumed only after the index write',
  naveSrc.indexOf('posts.unshift(postForIndex)') < naveSrc.indexOf('consumeApprovedBrief(approvedId'));

const ledger = JSON.parse(readFileSync(join(gate, 'project/seo/experiments.json'), 'utf8'));
check('the experiment is recorded for later measurement', ledger[0].id === 'ARLO-2026-08-16-01');
check('...with a status the cycle can pick up', ledger[0].status === 'queued');
check('...and no result yet', ledger[0].result === null);

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: gate, encoding: 'utf8' }).trim();
check('the work landed on a branch, not on the checked-out main', branch !== 'main' && branch.includes('arlo-2026-08-16-01'));
check('the blog index was NOT modified by the approval',
  execFileSync('git', ['diff', 'HEAD~1', '--name-only'], { cwd: gate, encoding: 'utf8' })
    .split('\n').filter(Boolean).every(f => f !== 'content/blog/posts-index.json'));
check('the PR body printed by --no-pr carries the audit trail',
  /Recommendation ID/.test(approved.out) && /Manual approval/.test(approved.out) && /Dori/.test(approved.out));

// Re-approving the same ID must not silently double-queue.
const second = runGate(['--id', 'ARLO-2026-08-16-01', '--approved-by', 'Dori', '--no-pr'], {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
});
check('approving the same ID twice is REFUSED', second.code === 1);
check('...naming it as already approved', /already been approved/.test(second.out));
check('...and the queue still holds exactly one entry',
  JSON.parse(readFileSync(join(gate, 'content/blog/approved-queue.json'), 'utf8')).length === 1);

rmSync(gate, { recursive: true, force: true });

// ─── Done ────────────────────────────────────────────────────────────────────

console.log('');
if (failures > 0) {
  console.error(`${failures} of ${checks} governance check(s) FAILED.`);
  process.exit(1);
}
console.log(`All ${checks} governance checks passed (${posts.length} live posts, ${workflowFiles.length} workflows scanned).`);
