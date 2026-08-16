#!/usr/bin/env node
// scripts/queue-approved-post.js
//
// THE HUMAN APPROVAL GATE. This is the only bridge between "Arlo recommended
// something" and "work is queued", and it is deliberately a thing a person runs
// with their own hands.
//
//   node scripts/queue-approved-post.js --id ARLO-2026-08-16-02 --approved-by "Dori"
//   node scripts/queue-approved-post.js --id ARLO-2026-08-16-03 --approved-by "Dori" --legal-reviewed
//   node scripts/queue-approved-post.js --id ARLO-2026-08-16-02 --dry-run
//
// ⚠️ THIS SCRIPT MUST NEVER BE CALLED FROM A GITHUB ACTIONS WORKFLOW.
//
// That is not a style preference — it is the entire governance boundary. Arlo
// runs in Actions. If Actions could run this, Arlo could approve its own
// recommendations, and "human approval" would be a comment rather than a
// control. Two things enforce it:
//
//   1. The runtime guard below refuses to run under CI.
//   2. scripts/lib/__verify__/verify-improvement-governance.js greps every file
//      in .github/workflows/ for this filename and fails if it appears.
//
// If you ever find yourself wanting to automate this step, the answer is no.
// Automating it removes the only thing standing between a model's opinion and
// the company's published content.
//
// What it does, in order:
//   1. refuses to run in CI
//   2. loads the named recommendation from project/seo/recommendations.json
//   3. validates it — legal review, category, schema, duplicates — and REFUSES
//      on any failure. Nothing is written until every check passes.
//   4. appends a brief to content/blog/approved-queue.json (Nave's input)
//   5. records the experiment + its baseline in project/seo/experiments.json
//      so Arlo can measure the result in a later cycle
//   6. commits to a branch and opens a PR with the full audit trail
//
// It never merges. It never pushes to main.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import {
  RECOMMENDATIONS_FILE, EXPERIMENTS_FILE, APPROVED_QUEUE_FILE, POSTS_INDEX_FILE,
  RECOMMENDATION_ID_RE, APPROVED_CATEGORIES, resolveCategory,
  requiresLegalReview, legalReviewReasons,
  validateBrief, findDuplicate, findSubjectOverlap, findPII,
} from './lib/improvement-governance.js';

const REPO = 'dror75p-ops/Doryangel-web-3-carousel-blog';

// ─── 1. The CI guard ──────────────────────────────────────────────────────────

function refuseUnderCI() {
  // GITHUB_ACTIONS is set to "true" by every Actions runner; CI is set by
  // essentially every other runner as well. Either is disqualifying.
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const inCI = String(process.env.CI || '').toLowerCase() === 'true';
  if (inActions || inCI) {
    console.error(
      '\nREFUSED: queue-approved-post.js cannot run in CI.\n\n' +
      'This script is the human approval gate for Arlo\'s recommendations.\n' +
      'Running it from an automated workflow would let the agent approve its own\n' +
      'work, which is the one thing the design forbids. Run it from a terminal,\n' +
      'as a person, after reading the recommendation.\n'
    );
    process.exit(2);
  }
}

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    id: null, approvedBy: null, legalReviewed: false,
    allowSubjectOverlap: false, dryRun: false, noPr: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') args.id = argv[++i];
    else if (a === '--approved-by') args.approvedBy = argv[++i];
    else if (a === '--legal-reviewed') args.legalReviewed = true;
    else if (a === '--allow-subject-overlap') args.allowSubjectOverlap = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-pr') args.noPr = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

const USAGE = `
Approve one Arlo recommendation and open a pull request for it.

  node scripts/queue-approved-post.js --id <ARLO-ID> [options]

  --id <ARLO-YYYY-MM-DD-NN>   the recommendation to approve (required)
  --approved-by "<name>"      who approved it; recorded in the PR audit trail
  --legal-reviewed            required when the recommendation is flagged for
                              legal review. Means: a human has actually checked
                              the regulatory claims. Do not pass it to get past
                              the error message.
  --allow-subject-overlap     required when the proposed post covers the same
                              building system / subject as an existing post in
                              the same category. Means: you looked, and this is
                              genuinely a different angle.
  --dry-run                   run every validation and print the result; write
                              nothing, commit nothing, open nothing
  --no-pr                     commit to the branch but do not open the PR
                              (useful when GH_TOKEN is not set)

Recommendations live in ${RECOMMENDATIONS_FILE} and arrive by email every 14 days.
Nothing is written until every validation passes. No PR is ever merged for you.
`;

// ─── Small helpers ────────────────────────────────────────────────────────────

const readJson = (path, fallback) => {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is unreadable: ${e.message}`);
  }
};

const writeJson = (path, value) => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
};

// execFileSync, not execSync: arguments are passed as an array, so a branch name
// or a title containing shell metacharacters cannot become a command.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const fail = (msg) => {
  console.error(`\nREFUSED: ${msg}\n`);
  process.exit(1);
};

function slugFromTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[‐-―−]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  refuseUnderCI();

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help || !args.id) {
    console.log(USAGE);
    process.exit(args.id ? 0 : 2);
  }
  if (!RECOMMENDATION_ID_RE.test(args.id)) {
    fail(`"${args.id}" is not a recommendation ID. Expected the form ARLO-YYYY-MM-DD-NN, exactly as it appears in Arlo's email.`);
  }

  // ── Load the recommendation ────────────────────────────────────────────────
  const report = readJson(RECOMMENDATIONS_FILE, null);
  if (!report) {
    fail(`${RECOMMENDATIONS_FILE} does not exist yet. Arlo writes it when the 14-day cycle runs; pull the latest main first.`);
  }
  const rec = (report.recommendations || []).find(r => r.id === args.id);
  if (!rec) {
    const available = (report.recommendations || []).map(r => r.id).join(', ') || 'none';
    fail(`No recommendation "${args.id}" in ${RECOMMENDATIONS_FILE} (report date ${report.reportDate}).\n         Available in this report: ${available}\n         If the ID is from an older email, that cycle has been superseded — Arlo keeps only the current one.`);
  }

  // ⚠️ Already approved? Refuse. Without this, running the command twice — a
  // scrolled-back terminal, a re-read email, two people acting on the same
  // digest — queues the same brief twice, and Nave publishes the same post
  // twice on consecutive runs. The ID is the idempotency key.
  const existingQueue = readJson(APPROVED_QUEUE_FILE, []);
  const alreadyQueued = existingQueue.find(e => e?.recommendationId === args.id);
  if (alreadyQueued) {
    fail(
      `${args.id} has already been approved (on ${alreadyQueued.approvedOn}${alreadyQueued.approvedBy ? ` by ${alreadyQueued.approvedBy}` : ''}, status "${alreadyQueued.status}").\n` +
      `         Approving it again would queue the same work twice. If the first attempt did not\n` +
      `         produce a PR, push the existing branch instead of re-running this.`
    );
  }
  const alreadyTracked = readJson(EXPERIMENTS_FILE, []).find(e => e?.id === args.id);
  if (alreadyTracked) {
    fail(`${args.id} is already in the experiment ledger (status "${alreadyTracked.status}"). It has been approved before.`);
  }

  const posts = readJson(POSTS_INDEX_FILE, []);
  console.log(`\nRecommendation ${rec.id} — ${rec.title}`);
  console.log(`  action:   ${rec.action}${rec.targetSlug ? ` (${rec.targetSlug})` : ''}`);
  console.log(`  from:     Arlo report ${rec.reportDate}`);
  console.log(`  priority: ${rec.priority} (impact ${rec.impact} × confidence ${rec.confidence} / effort ${rec.effort})`);

  // ── VALIDATION. Every check runs before anything is written. ───────────────

  // 1. LEGAL — the blocking control.
  //
  // ⚠️ The recommendation's own flag is not trusted on its own. It is OR-ed with
  // a fresh classification of the title, action and evidence, so a model that
  // forgot to set the flag cannot open the gate by omission.
  const legalByRule = requiresLegalReview(rec.title, rec.what, rec.why);
  const legalRequired = Boolean(rec.legal_review_required) || legalByRule;
  if (legalRequired && !args.legalReviewed) {
    const reasons = legalReviewReasons(rec.title, rec.what, rec.why);
    fail(
      `${rec.id} requires legal review and --legal-reviewed was not supplied.\n\n` +
      `         Flagged because it touches: ${reasons.join(', ') || 'a regulated subject'}\n` +
      `         ${rec.legal_review_required ? 'Arlo flagged it' : 'Arlo did NOT flag it — the classifier did'}.\n\n` +
      `         This is a blocking control, not a warning. Housing, tax and tenancy claims on\n` +
      `         DoryAngel pages carry the real business NAP, and the company explicitly separates\n` +
      `         itself from licensed brokerage activity (disclaimer.html:60).\n\n` +
      `         Have a human check the regulatory claims, then re-run with --legal-reviewed.`
    );
  }

  // 2. CATEGORY — allowlist only, no silent creation.
  let category = null;
  if (rec.action === 'new-content') {
    category = resolveCategory(rec.category);
    if (!category) {
      fail(
        `"${rec.category}" is not an approved category for queued content.\n` +
        `         Approved: ${APPROVED_CATEGORIES.join(', ')}\n` +
        `         Categories are never created here. Widening the list is a reviewed change to\n` +
        `         scripts/lib/improvement-governance.js, not something an approval can do.`
      );
    }
  }

  // 3. DUPLICATES + 4. SCHEMA — only meaningful for new content.
  let brief = null;
  if (rec.action === 'new-content') {
    const slug = rec.targetSlug || slugFromTitle(rec.title);
    brief = {
      slug,
      title: rec.title,
      category,
      excerpt: rec.what,
      author: 'DoryAngel Team',
      featured: false,
    };
    const { ok, errors, duplicate } = validateBrief(brief, posts);
    if (!ok) {
      fail(
        `${rec.id} failed validation:\n` +
        errors.map(e => `           • ${e}`).join('\n') +
        (duplicate && duplicate.kind === 'fuzzy-title'
          ? `\n\n         The underlying opportunity may still be real — consider approving an\n         improve-existing recommendation against ${duplicate.slug} instead.`
          : '')
      );
    }
    // Layer 4 — same category, same physical subject, different words. This is
    // the case Dice similarity provably cannot catch (see SUBJECT_NOUNS in
    // improvement-governance.js). It stops and asks rather than deciding.
    const overlap = findSubjectOverlap(posts, { ...brief, category });
    if (overlap.length && !args.allowSubjectOverlap) {
      fail(
        `${rec.id} covers a subject already published in the same category.\n\n` +
        overlap.slice(0, 4).map(o => `           • ${o.shared.join(', ')} — "${o.title}" (${o.slug})`).join('\n') +
        `\n\n         Word-overlap alone would not have caught this; the shared subject did.\n` +
        `         Two posts on the same system compete for the same queries — that is how\n` +
        `         "Bronx vs. Mt. Vernon HVAC" and "Bronx vs. Queens AC Repair Costs" shipped\n` +
        `         two days apart in 2026.\n\n` +
        `         Either approve an improve-existing recommendation against one of the posts\n` +
        `         above, or — if this genuinely is a different angle — re-run with\n` +
        `         --allow-subject-overlap.`
      );
    }
    if (overlap.length) {
      console.log(`  subject:  overlaps ${overlap.length} published post(s) — acknowledged via --allow-subject-overlap`);
    }

    console.log(`  category: ${category}`);
    console.log(`  slug:     ${slug}`);
  } else if (rec.targetSlug) {
    // improve-existing / site-change: the target has to exist to be improved.
    const exists = posts.some(p => p.slug === rec.targetSlug);
    if (rec.action === 'improve-existing' && !exists) {
      fail(`${rec.id} proposes improving "${rec.targetSlug}", which is not in ${POSTS_INDEX_FILE}.`);
    }
  }

  // 5. PII — a backstop. Nothing in a recommendation should carry personal data,
  //    and this file is committed to a public repository.
  const pii = findPII([rec.title, rec.what, rec.why, rec.expectedResult].join(' '));
  if (pii.length) {
    fail(`${rec.id} contains what looks like personal data (${pii.map(p => p.kind).join(', ')}) and will not be committed. Report this — Arlo redacts on write, so a hit here means the redaction was bypassed.`);
  }

  console.log(`  legal:    ${legalRequired ? `required — confirmed by --legal-reviewed` : 'not required'}`);
  console.log('\nAll validations passed.');

  if (args.dryRun) {
    console.log('\n--dry-run: nothing written, nothing committed, no PR opened.');
    if (brief) console.log(`\nWould queue:\n${JSON.stringify(brief, null, 2)}`);
    process.exit(0);
  }

  // ── WRITE. Only reached once every check above has passed. ─────────────────

  const approvedOn = new Date().toISOString().split('T')[0];
  const approvedBy = args.approvedBy || null;

  // The queue Nave reads. Briefs only — no bodies, no personal data. It lives in
  // content/ (which IS deployed), so it must never carry anything private.
  const queue = readJson(APPROVED_QUEUE_FILE, []);
  const queueEntry = {
    recommendationId: rec.id,
    reportDate: rec.reportDate,
    approvedOn,
    approvedBy,
    legalReviewed: legalRequired ? true : undefined,
    action: rec.action,
    status: 'pending',
    targetSlug: rec.targetSlug || null,
    note: rec.what,
    brief: brief || undefined,
  };
  queue.push(queueEntry);
  writeJson(APPROVED_QUEUE_FILE, queue);

  // The experiment ledger — this is what closes the loop. Arlo reads it on a
  // later cycle, notices the change shipped, waits out the measurement window
  // and reports whether it worked.
  const experiments = readJson(EXPERIMENTS_FILE, []);
  experiments.push({
    id: rec.id,
    title: rec.title,
    action: rec.action,
    targetSlug: (brief?.slug) || rec.targetSlug || null,
    recommendedOn: rec.reportDate,
    approvedOn,
    approvedBy,
    legalReviewed: legalRequired,
    metric: rec.metric,
    expectedResult: rec.expectedResult,
    baseline: rec.baseline,
    status: 'queued',
    implementedOn: null,
    measureAfter: null,
    result: null,
  });
  writeJson(EXPERIMENTS_FILE, experiments);

  console.log(`\nQueued  → ${APPROVED_QUEUE_FILE}`);
  console.log(`Tracked → ${EXPERIMENTS_FILE}`);

  // ── COMMIT + PR. Never a merge, never a push to main. ──────────────────────
  const branch = `claude/approved-${rec.id.toLowerCase()}`;
  const prBody = buildPrBody(rec, { approvedOn, approvedBy, legalRequired, legalByRule, brief });

  try {
    const current = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (current === 'main') {
      git('checkout', '-b', branch);
    } else {
      console.log(`(already on ${current} — committing here rather than branching off it)`);
    }
    git('add', APPROVED_QUEUE_FILE, EXPERIMENTS_FILE);
    git('commit', '-m', `Queue approved recommendation ${rec.id}\n\n${rec.title}\n\nApproved manually by ${approvedBy || 'an unnamed human'} on ${approvedOn}.\nOrigin: Arlo report ${rec.reportDate}.`);
    console.log(`Committed on ${git('rev-parse', '--abbrev-ref', 'HEAD')}`);
  } catch (e) {
    console.error(`\nCommit failed: ${e.message}`);
    console.error('The queue and experiment files were still written — commit them by hand.');
    process.exit(1);
  }

  if (args.noPr) {
    console.log('\n--no-pr: push the branch and open the PR yourself. Suggested body:\n');
    console.log(prBody);
    process.exit(0);
  }

  openPullRequest(branch, `Approved: ${rec.title}`, prBody).catch(e => {
    console.error(`\nCould not open the PR automatically: ${e.message}`);
    console.error('The commit is on the branch — push it and open the PR by hand. Body:\n');
    console.error(prBody);
    process.exit(1);
  });
}

// ⚠️ THE AUDIT TRAIL. Git history + PR history IS the approval record — there is
// deliberately no approval database. That means this body has to carry enough to
// reconstruct the decision months later: which recommendation, from which
// report, approved by whom, and whether legal review was confirmed.
function buildPrBody(rec, { approvedOn, approvedBy, legalRequired, legalByRule, brief }) {
  return `## Origin

| | |
|---|---|
| **Recommendation ID** | \`${rec.id}\` |
| **Arlo report date** | ${rec.reportDate} |
| **Manual approval** | Yes — \`scripts/queue-approved-post.js\` |
| **Approved by** | ${approvedBy || '_not supplied at invocation_'} |
| **Approved on** | ${approvedOn} |
| **Legal review** | ${legalRequired ? `Required (${legalByRule ? 'classifier' : 'Arlo'}-flagged) — **confirmed** via \`--legal-reviewed\`` : 'Not required'} |

## What Arlo recommended

**${rec.title}** — \`${rec.action}\`${rec.targetSlug ? ` on \`${rec.targetSlug}\`` : ''}

- **What:** ${rec.what}
- **Why:** ${rec.why}
- **Expected result:** ${rec.expectedResult}
- **Baseline:** ${rec.baseline
    ? `${rec.baseline.clicks} clicks / ${rec.baseline.impressions} impressions${rec.baseline.position != null ? ` at position ${Number(rec.baseline.position).toFixed(1)}` : ''} — 28 days to ${rec.baseline.capturedOn}`
    : '_no measured baseline_'}
- **Metric to watch:** ${rec.metric}
- **Measurement window:** ${rec.measurementWindow}
- **Priority:** ${rec.priority} (impact ${rec.impact} × confidence ${rec.confidence} / effort ${rec.effort})

## What this PR changes

- \`${APPROVED_QUEUE_FILE}\` — adds the approved brief to the queue${brief ? ` (\`${brief.slug}\`, ${brief.category})` : ''}
- \`${EXPERIMENTS_FILE}\` — records the experiment and its baseline so Arlo can measure the result in a later cycle

No blog content is published by this PR. ${brief ? 'Nave picks the brief up on its next scheduled run once this is merged.' : 'The change itself is implemented separately.'}

## How this was approved

Arlo generated this recommendation automatically and emailed it. It was **not** queued automatically — a human read it and ran the approval script by hand. Arlo has no path to publishing: it cannot queue, approve, merge or modify blog content on its own recommendation.

---
_Generated by [Claude Code](https://claude.ai/code)_`;
}

async function openPullRequest(branch, title, body) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('\nNo GH_TOKEN in the environment — pushing the branch and printing the PR body instead.');
    git('push', '-u', 'origin', branch);
    console.log(`\nBranch pushed. Open the PR here:\n  https://github.com/${REPO}/compare/${branch}?expand=1\n\nBody:\n\n${body}`);
    return;
  }

  git('push', '-u', 'origin', branch);

  const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head: branch, base: 'main' }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const pr = await res.json();

  // ⚠️ No auto-merge, no merge call, not even a suggestion of one. The PR is
  // where a human reviews the approved work; merging it is their second
  // deliberate action, and the second half of the approval gate.
  console.log(`\nPull request opened (NOT merged): ${pr.html_url}`);
  console.log('Review and merge it yourself when you are happy with it.');
}

main();
