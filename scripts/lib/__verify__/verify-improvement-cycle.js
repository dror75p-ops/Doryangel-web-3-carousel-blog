// scripts/lib/__verify__/verify-improvement-cycle.js
//
// End-to-end check of Arlo's 14-day improvement cycle against STUBBED APIs.
// Run with:
//   node scripts/lib/__verify__/verify-improvement-cycle.js
//
// Companion to verify-improvement-governance.js: that one proves the rules are
// right, this one proves the cycle actually behaves as designed when it runs.
//
// ⚠️ WHAT THIS CAN AND CANNOT PROVE. The CCR sandbox has no ANTHROPIC_API_KEY
// and no GOOGLE_SA_KEY (both are Actions secrets), and its proxy blocks Google
// and Anthropic. So this harness stubs global fetch and drives the real cycle
// code against synthetic responses. It proves the LOGIC is self-consistent — the
// cadence holds, the budget is reported, the blog index is untouched, the email
// renders — but not that the API contracts are right. That was the same limit
// the 2026-08-03 Search Console work ran into, and the groupType bug it wrote:
// check the first real Actions run for `Improvement cycle: RAN` before trusting
// the first committed recommendations.
//
// Runs entirely inside a temp directory (process.chdir) so the real repo is
// never written to. The real posts-index.json is copied in read-only.

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createServer } from 'http';

const repoRoot = process.cwd();
const realPosts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}
function section(name) { console.log(`\n── ${name}`); }

// ─── Fixture ──────────────────────────────────────────────────────────────────

const sandbox = mkdtempSync(join(tmpdir(), 'arlo-cycle-'));
mkdirSync(join(sandbox, 'content/blog'), { recursive: true });
mkdirSync(join(sandbox, 'project/seo'), { recursive: true });
writeFileSync(join(sandbox, 'content/blog/posts-index.json'), JSON.stringify(realPosts, null, 2));
// buildAnnotations() and detectImplementation() shell out to git; give them a repo.
execFileSync('git', ['init', '-q'], { cwd: sandbox });
execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: sandbox });

// ─── API stubs ────────────────────────────────────────────────────────────────
//
// A fetch stub for the Google hosts, plus a local HTTP server for Anthropic
// (see the note above anthropicStubResponse). Each records how Each records how
// often it was called so the cost claims in the report can be checked rather
// than trusted.

const calls = { googleToken: 0, gsc: 0, anthropic: 0, webSearches: 0 };

const gscPageRow = (url, clicks, impressions, position) => ({
  keys: [url], clicks, impressions, ctr: impressions ? clicks / impressions : 0, position,
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (body) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

  if (u.includes('oauth2.googleapis.com/token')) {
    calls.googleToken++;
    return json({ access_token: 'stub-token', expires_in: 3600 });
  }

  if (u.includes('searchconsole.googleapis.com')) {
    calls.gsc++;
    // The only GSC call the cycle itself makes is the per-page experiment
    // measurement. Return an improvement so the classifier has something to say.
    return json({ rows: [gscPageRow('https://www.doryangel.com/blog/x/', 12, 400, 9.1)] });
  }

  throw new Error(`unstubbed fetch to ${u}`);
};

// ─── The Anthropic stub ───────────────────────────────────────────────────────
//
// ⚠️ The SDK does NOT go through globalThis.fetch — it uses its own Node shim,
// so overriding global fetch silently lets the call through to the real API.
// (First run of this harness did exactly that and got a real 401.) The reliable
// seam is ANTHROPIC_BASE_URL, which the client reads at construction: point it
// at a local server and the real SDK code path is exercised end to end.
function anthropicStubResponse(body) {
  const isScout = Array.isArray(body.tools) && body.tools.some(t => t.name === 'web_search');
  if (isScout) {
    // Assert the cap is actually sent to the API, not merely intended.
    const tool = body.tools.find(t => t.name === 'web_search');
    check('the web_search tool carries max_uses = 5', tool.max_uses === 5);
    return {
      content: [{ type: 'text', text: 'Competitors cover generic NYC compliance; nobody prices Bronx-specific boiler service.' }],
      usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 4 } },
    };
  }
  // The recommendation call. Deliberately returns a mix that exercises every
  // post-processing path: a clean item, one the model forgot to flag as legal,
  // one that duplicates a published post, and one with an unapproved category.
  return {
    content: [{
      type: 'text', text: JSON.stringify([
        {
          action: 'improve-existing', target_slug: realPosts[3].slug,
          title: 'Tighten the title and meta description on the flat-fee comparison',
          what: 'Rewrite the title tag to lead with the price.',
          why: 'It earns 420 impressions at position 9.4 with a 0.7% CTR.',
          expected_result: 'CTR from 0.7% toward 2%', metric: 'CTR',
          category: null, impact: 4, confidence: 4, effort: 1,
          legal_review_required: false,
        },
        {
          action: 'new-content', target_slug: 'what-bronx-landlords-owe-after-an-hpd-class-c-violation',
          title: 'What Does a Bronx Landlord Owe After an HPD Class C Violation?',
          what: 'A plain-English walkthrough of the penalty schedule.',
          why: 'Related queries earn 180 impressions at position 14.',
          expected_result: 'a page-one entry for the violation queries', metric: 'position',
          category: 'property-management', impact: 5, confidence: 3, effort: 3,
          legal_review_required: false,          // the model forgot. The classifier must catch it.
        },
        {
          action: 'new-content', target_slug: 'a-fresh-slug-entirely',
          title: realPosts[0].title,             // an exact duplicate of a published post
          what: 'Write it again.', why: 'It ranks well.',
          expected_result: 'more clicks', metric: 'clicks',
          category: 'investments', impact: 3, confidence: 2, effort: 3,
          legal_review_required: false,
        },
        {
          action: 'new-content', target_slug: 'bronx-landlord-instagram-automation-playbook',
          title: 'How Should a Bronx Landlord Automate Listing Photos?',
          what: 'A workflow post.', why: 'Automation queries earn 60 impressions.',
          expected_result: 'more clicks', metric: 'clicks',
          category: 'property-automation',       // not an approved category
          impact: 2, confidence: 2, effort: 4,
          legal_review_required: false,
        },
      ]),
    }],
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const anthropicServer = createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    calls.anthropic++;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(anthropicStubResponse(body)));
  });
});
await new Promise(r => anthropicServer.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${anthropicServer.address().port}`;
// The sandbox routes outbound traffic through an agent proxy; without this the
// SDK would try to reach the loopback stub through it and fail.
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';


// Credentials the cycle looks for. The harness only needs them to exist so the
// code takes the "configured" branch — the token exchange itself is stubbed.
//
// getGoogleAccessToken() signs a real JWT with crypto.createSign, and ESM
// exports cannot be monkeypatched, so the key has to be genuinely well-formed.
// It is generated here, held in memory, used only to satisfy the signer, and
// never written to disk or printed. It authenticates nothing: the only endpoint
// that would see it is the stubbed fetch above.
const { generateKeyPairSync } = await import('crypto');
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.GOOGLE_SA_KEY = JSON.stringify({
  client_email: 'stub@example.iam.gserviceaccount.com',
  project_id: 'stub-project',
  private_key: privateKey,
});
process.env.ANTHROPIC_API_KEY = 'sk-ant-stub';
// The Resend client is constructed at module load and throws without a key.
// Nothing here sends email — renderImprovementSections() is called directly and
// sendDigest() never runs.
process.env.RESEND_API_KEY = 're_stub_not_a_real_key';

process.chdir(sandbox);
const audit = await import(join(repoRoot, 'scripts/daily-audit.js'));

// Synthetic Search Console snapshot in the shape getSearchConsoleStats() returns.
const gsc = {
  snapshot: {
    totals: { clicks: 92, impressions: 6200, ctr: 0.0148, position: 28.4 },
    topQueries: [
      { key: 'bronx property management', clicks: 6, impressions: 240, ctr: 0.025, position: 19.4 },
    ],
    topByImpressions: [
      { key: 'bronx property management companies', clicks: 1, impressions: 310, ctr: 0.003, position: 12.1 },
      { key: 'flat fee property management bronx', clicks: 0, impressions: 96, ctr: 0, position: 8.8 },
      { key: 'bronx property manager reviews', clicks: 0, impressions: 44, ctr: 0, position: 6.2 },
      { key: 'bronx property management', clicks: 6, impressions: 240, ctr: 0.025, position: 19.4 },
    ],
    topPages: [],
    topPagesByImpressions: [
      { key: `https://www.doryangel.com/blog/${realPosts[3].slug}/`, clicks: 0, impressions: 420, ctr: 0, position: 9.4 },
      { key: 'https://www.doryangel.com/', clicks: 26, impressions: 2100, ctr: 0.012, position: 34.0 },
    ],
    queryMix: [{ key: 'commercial', clicks: 12, impressions: 2443 }],
    hosts: [],
  },
};

// ─── 1. First run: the cycle is due and does its work ────────────────────────

section('1. First cycle');

const indexBefore = readFileSync('./content/blog/posts-index.json', 'utf8');
const run1 = await audit.runImprovementCycle({
  posts: realPosts, gsc, ga4: null, clarity: null, todayISO: '2026-08-16',
});

check('the cycle ran', run1.ran === true);
check('opportunities were derived from Search Console data', run1.opportunities.length > 0);
check('striking-distance queries were found', run1.opportunities.some(o => o.kind === 'striking-distance'));
check('a weak-CTR query was found', run1.opportunities.some(o => o.kind === 'weak-ctr'));
check('a page with impressions and no clicks was found', run1.opportunities.some(o => o.kind === 'impressions-no-clicks'));
console.log(`   ${run1.opportunities.length} opportunities: ${[...new Set(run1.opportunities.map(o => o.kind))].join(', ')}`);

check('external search usage is read back from the API response', run1.scout.used === 4);
check('the reported usage never exceeds the budget', run1.scout.used <= 5);

// ─── 2. Post-processing of what the model returned ───────────────────────────

section('2. Recommendation post-processing');

const recs = run1.recommendations;
console.log(`   ${recs.length} recommendations: ${recs.map(r => `${r.id}(${r.action},${r.priority})`).join(' ')}`);
check('between 3 and 5 recommendations are returned', recs.length >= 3 && recs.length <= 5);
check('every recommendation has a stable ID', recs.every(r => /^ARLO-2026-08-16-\d{2}$/.test(r.id)));
check('IDs are unique', new Set(recs.map(r => r.id)).size === recs.length);
check('they are sorted by score, highest first',
  recs.every((r, i) => i === 0 || recs[i - 1].score >= r.score));

const hpd = recs.find(r => /HPD/i.test(r.title));
check('the HPD recommendation survived', Boolean(hpd));
check('⚠️ the classifier overrode the model\'s missing legal flag', hpd?.legal_review_required === true);
check('the legal flag says why', (hpd?.legalReasons || []).length > 0);

const dupRec = recs.find(r => r.duplicateOf);
check('an exact-duplicate "new post" was detected', Boolean(dupRec));
check('...and re-framed as improve-existing rather than dropped', dupRec?.action === 'improve-existing');
check('...pointing at the post it duplicates', dupRec?.targetSlug === realPosts[0].slug);

const badCat = recs.find(r => /Listing Photos/i.test(r.title));
check('an unapproved category is nulled rather than invented', badCat ? badCat.category === null : true);
check('no recommendation carries a category outside the allowlist',
  recs.every(r => r.category === null || ['diy-property-management', 'property-management', 'investments'].includes(r.category)));

const improve = recs.find(r => r.targetSlug === realPosts[3].slug && !r.duplicateOf);
check('a baseline was attached from real measured data', Boolean(improve?.baseline));
check('the baseline came from Search Console, not the model', improve?.baseline?.impressions === 420);

// ─── 3. Files written, and the blog index untouched ──────────────────────────

section('3. Side effects');

check('the blog index is byte-identical after the cycle',
  readFileSync('./content/blog/posts-index.json', 'utf8') === indexBefore);
check('the cadence state file was written', existsSync('./project/seo/improvement-state.json'));
check('the recommendations file was written', existsSync('./project/seo/recommendations.json'));

const stateOnDisk = JSON.parse(readFileSync('./project/seo/improvement-state.json', 'utf8'));
check('the state file holds exactly one key', Object.keys(stateOnDisk).length === 1);
check('...and it is lastCycleDate', stateOnDisk.lastCycleDate === '2026-08-16');

const recFile = readFileSync('./project/seo/recommendations.json', 'utf8');
check('the recommendations file records the search budget', JSON.parse(recFile).scoutSearchBudget === 5);
check('the recommendations file records what was actually used', JSON.parse(recFile).scoutSearchesUsed === 4);
check('no credential appears in any written file',
  !recFile.includes('PRIVATE KEY') && !recFile.includes('sk-ant') && !recFile.includes('stub-token') &&
  !JSON.stringify(stateOnDisk).includes('sk-ant'));

// ─── 4. The cadence holds ────────────────────────────────────────────────────

section('4. Cadence');

const callsAfterFirst = { ...calls };
const run2 = await audit.runImprovementCycle({
  posts: realPosts, gsc, ga4: null, clarity: null, todayISO: '2026-08-16',
});
check('a second invocation on the same day does NOT run the cycle', run2.ran === false);
check('...and says why', /already ran today/.test(run2.reason));
check('...and spends nothing: no Anthropic calls', calls.anthropic === callsAfterFirst.anthropic);
check('...and no Search Console calls', calls.gsc === callsAfterFirst.gsc);

const run3 = await audit.runImprovementCycle({
  posts: realPosts, gsc, ga4: null, clarity: null, todayISO: '2026-08-29',
});
check('13 days later it is still not due', run3.ran === false);

const run4 = await audit.runImprovementCycle({
  posts: realPosts, gsc, ga4: null, clarity: null, todayISO: '2026-08-30',
});
check('14 days later it runs again', run4.ran === true);
check('...and records the previous cycle date', run4.previousCycle === '2026-08-16');

// ─── 5. Closing the loop: an approved change gets measured ───────────────────

section('5. Experiment measurement');

writeFileSync('./project/seo/experiments.json', JSON.stringify([
  {
    id: 'ARLO-2026-06-01-01', title: 'An earlier approved change',
    action: 'improve-existing', targetSlug: realPosts[3].slug,
    recommendedOn: '2026-06-01', approvedOn: '2026-06-02', approvedBy: 'Dori',
    metric: 'clicks', baseline: { days: 28, clicks: 2, impressions: 300, ctr: 0.006, position: 14.2, capturedOn: '2026-06-01' },
    status: 'implemented', implementedOn: '2026-06-05', measureAfter: '2026-07-06', result: null,
  },
], null, 2));

const run5 = await audit.runImprovementCycle({
  posts: realPosts, gsc, ga4: null, clarity: null, todayISO: '2026-09-13',
});
const measured = run5.experiments.find(e => e.id === 'ARLO-2026-06-01-01');
check('the overdue experiment was measured', measured?.status === 'measured');
check('...with a verdict', ['improving', 'neutral', 'underperforming'].includes(measured?.result?.verdict));
check('...that reads as improving on the stubbed data', measured?.result?.verdict === 'improving');
check('...worded as association, not causation', /association, not proof of cause/.test(measured?.result?.reason || ''));
check('the verdict was persisted to the ledger',
  JSON.parse(readFileSync('./project/seo/experiments.json', 'utf8'))[0].result?.verdict === 'improving');
console.log(`   verdict: ${measured?.result?.verdict} — ${measured?.result?.reason}`);

// Insufficient data must not be dressed up as a result.
const thin = audit.classifyExperiment(
  { clicks: 0, impressions: 12, position: 30 },
  { clicks: 1, impressions: 20, position: 28 }
);
check('a thin-traffic experiment is reported as insufficient evidence',
  thin.verdict === 'neutral' && /insufficient evidence/.test(thin.reason));
const worse = audit.classifyExperiment(
  { clicks: 30, impressions: 900, position: 8 },
  { clicks: 9, impressions: 400, position: 15 }
);
check('a regression is reported as underperforming', worse.verdict === 'underperforming');

// ─── 6. The email renders, and contains no approval mechanism ────────────────

section('6. Report rendering');

const html = audit.renderImprovementSections(run1);
check('the 14-day performance review block renders', html.includes('14-day performance review'));
check('the previous-experiments block renders', html.includes('Previous experiments'));
check('the new-recommendations block renders', html.includes('New recommendations'));
check('the cost block renders', html.includes('Cycle cost'));
check('the search count is stated', /4 of 5 allowed/.test(html));
check('every recommendation ID appears', recs.every(r => html.includes(r.id)));
check('the legal requirement is visible on the flagged item', html.includes('Legal review required'));
check('the reader is told nothing was queued', html.includes('Nothing has been queued'));
check('the manual approval command is shown', html.includes('queue-approved-post.js --id'));

// ⚠️ The check that matters most in this section.
check('there is no approval URL, webhook or one-click mechanism',
  !/href="[^"]*(approve|webhook|hook\.make|hook\.eu1)/i.test(html));
check('no PII appears in the rendered report', !/\b[A-Za-z0-9._%+-]+@(?!doryangel\.com|resend\.dev)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(html));
check('no credential appears in the rendered report',
  !html.includes('sk-ant') && !html.includes('stub-token') && !html.includes('PRIVATE KEY'));

const notDue = audit.renderImprovementSections({ ran: false, reason: 'next cycle in 6 day(s)' });
check('an off-cycle day renders a one-line note instead of a stale report',
  notDue.includes('not due today') && !notDue.includes('New recommendations'));

// ─── Done ────────────────────────────────────────────────────────────────────

process.chdir(repoRoot);
rmSync(sandbox, { recursive: true, force: true });
anthropicServer.close();

console.log(`\nStub call counts: ${JSON.stringify(calls)}`);
if (failures > 0) {
  console.error(`\n${failures} of ${checks} cycle check(s) FAILED.`);
  process.exit(1);
}
console.log(`\nAll ${checks} improvement-cycle checks passed (stubbed APIs — see the header for what this does not prove).`);
