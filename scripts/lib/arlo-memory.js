// scripts/lib/arlo-memory.js
//
// What Arlo needs to remember between cycles so he stops recommending work that
// is already approved, already shipped, or too fresh to judge.
//
// ⚠️ WHY THIS EXISTS. Measured 2026-11-09 across the 2026-09-27, 10-11, 10-25
// and 11-08 cycles: the same two ideas (rewrite the homepage title, link the
// orphaned posts) came back cycle after cycle. Three causes, all fixed here:
//   1. Approvals live in OPEN approval PRs (claude/approved-arlo-*) until merged,
//      and in commit messages once shipped. Arlo only read experiments.json on
//      main, so an approval waiting for a merge was invisible to him.
//   2. Site-wide recommendations have no target slug, and the old repeat check
//      only matched on slug, so "the homepage title" never matched anything.
//   3. Nothing told him what changed in the last 28 days, so he recommended
//      changing a page again before the first change could be measured.
//
// Everything here is PURE (no git, no network) so it can be tested offline.
// daily-audit.js gathers the inputs and calls these.

// The same similarity the approval gate uses, so the two never disagree.
import { titleSimilarity } from './improvement-governance.js';

export const RECENT_CHANGE_DAYS = 28;
// Below the governance FUZZY_TITLE_THRESHOLD on purpose: a recommendation that
// restates in-flight work is cheap to drop (it comes back after the work is
// measured) and expensive to keep (it costs the owner another decision).
export const HANDLED_TITLE_THRESHOLD = 0.5;

/**
 * A coarse topic for the two families of idea that kept repeating. Titles that
 * share a topic are the same work even when no word overlaps, which is exactly
 * what token similarity misses ("link the 6 orphaned posts" vs "add inbound
 * links to older posts").
 */
export function topicKeyOf({ title = '', what = '', action = null, targetSlug = null } = {}) {
  const t = `${title} ${what}`.toLowerCase();
  // Internal links: the TITLE has to be about links, or the body about orphans.
  // A content recommendation that merely adds "internal links to and from the
  // service page" as one step (ARLO-2026-11-08-04) is not link work.
  const tt = String(title).toLowerCase();
  if (/orphan|internal link|inbound link|link (older|popular|other|existing) posts|related reading/.test(tt)
      || /orphan|no inbound link/.test(String(what).toLowerCase())) {
    return 'internal-links';
  }
  const seoFields = /title tag|title\/meta|meta description|\btitle\b.*\bmeta\b|\bmeta\b.*\btitle\b|<title>|\btitle\b/;
  const homepage = /home ?page|homepage|\bhome page\b|service page|front page/;
  if (homepage.test(t) && seoFields.test(t)) return 'homepage-title';
  // A site-change with no page of its own that rewrites titles is, in practice,
  // the homepage: it is the page that ranks for the head terms (see CLAUDE.md,
  // apex at ~position 1 is the local-pack signature of the homepage).
  if (action === 'site-change' && !targetSlug && /title tag|meta description|title\/meta|titles?\b/.test(t)) {
    return 'homepage-title';
  }
  return null;
}

/**
 * Pull ARLO ids out of a commit subject, including the shorthand people
 * actually write: "ARLO-2026-10-25-01/-02", "ARLO-2026-11-08-03 and -04".
 */
export function parseArloIds(text) {
  const ids = new Set();
  const re = /ARLO-(\d{4}-\d{2}-\d{2})-(\d{2})((?:\s*(?:\/|,|&|and)\s*-?\d{2}\b)*)/gi;
  for (const m of String(text || '').matchAll(re)) {
    ids.add(`ARLO-${m[1]}-${m[2]}`);
    for (const s of (m[3] || '').matchAll(/(\d{2})\b/g)) ids.add(`ARLO-${m[1]}-${s[1]}`);
  }
  return [...ids];
}

/** A commit that only QUEUES an approval is not the change shipping. */
export const QUEUE_COMMIT = /^(Queue approved recommendation|Approved:)/i;

/**
 * Build the "already handled" list from the three places approved work lives.
 *
 * @param {object} p
 * @param {Array}  p.experiments  project/seo/experiments.json
 * @param {Array}  p.openApprovalPrs  [{ number, title, branch, createdOn }] — open PRs on claude/approved-arlo-*
 * @param {Array}  p.commits      [{ date, subject }] — main, last RECENT_CHANGE_DAYS days
 * @param {Array}  p.recommendations  the last recommendations.json entries, for titles of ids seen only in PRs/commits
 */
export function buildHandledList({ experiments = [], openApprovalPrs = [], commits = [], recommendations = [] } = {}) {
  const byId = new Map();
  const titleFor = (id) =>
    experiments.find(e => e.id === id)?.title || recommendations.find(r => r.id === id)?.title || null;
  const metaFor = (id) => {
    const e = experiments.find(x => x.id === id) || recommendations.find(x => x.id === id);
    return e ? { action: e.action || null, targetSlug: e.targetSlug || null, what: e.what || '' } : {};
  };
  const put = (id, fields) => {
    const prev = byId.get(id) || { id, sources: [] };
    byId.set(id, { ...prev, ...fields, sources: [...new Set([...prev.sources, fields.source])] });
  };

  for (const e of experiments) {
    if (!e?.id) continue;
    const inFlight = e.status === 'queued' || e.status === 'implemented';
    put(e.id, {
      title: e.title || null, action: e.action || null, targetSlug: e.targetSlug || null,
      what: e.what || '', status: e.status, inFlight, source: 'experiment',
    });
  }

  for (const pr of openApprovalPrs) {
    const m = String(pr.branch || '').match(/approved-arlo-(\d{4}-\d{2}-\d{2}-\d{2})/i);
    if (!m) continue;
    const id = `ARLO-${m[1]}`;
    const meta = metaFor(id);
    put(id, {
      title: titleFor(id) || String(pr.title || '').replace(/^Approved:\s*/i, '') || null,
      ...meta, inFlight: true, source: `open approval PR #${pr.number}`,
    });
  }

  for (const c of commits) {
    if (QUEUE_COMMIT.test(c.subject || '')) continue;
    for (const id of parseArloIds(c.subject)) {
      const meta = metaFor(id);
      const existing = byId.get(id);
      put(id, {
        title: existing?.title || titleFor(id) || c.subject,
        ...meta,
        // Shipped within the window: give it time to be measured. A measured
        // experiment stays NOT in flight even if its commit is recent.
        inFlight: existing?.status === 'measured' ? false : true,
        shippedOn: c.date, source: 'commit',
      });
    }
  }

  return [...byId.values()].map(h => ({ ...h, topic: topicKeyOf(h) }));
}

/**
 * Should this recommendation be dropped because the work is already handled or
 * the page changed too recently to judge? Returns null to keep it, or a
 * one-line reason (shown in the log and the recommendations file).
 *
 * @param {object} rec  { id?, title, what, action, targetSlug }
 * @param {object} ctx  { handled, recentChanges: { changedSlugs: string[], homepageSeoChangedOn: string|null } }
 */
export function screenRecommendation(rec, { handled = [], recentChanges = {} } = {}) {
  const topic = topicKeyOf(rec);
  const slug = rec.targetSlug || null;

  for (const h of handled) {
    if (!h.inFlight) continue;
    if (slug && h.targetSlug && slug === h.targetSlug) {
      return `same page as ${h.id} (${h.sources.join(', ')}), which is not measured yet`;
    }
    if (topic && h.topic === topic) {
      return `same work as ${h.id} (${h.sources.join(', ')}), which is not measured yet`;
    }
    if (h.title && rec.title && titleSimilarity(rec.title, h.title) >= HANDLED_TITLE_THRESHOLD) {
      return `restates ${h.id} (${h.sources.join(', ')})`;
    }
  }

  const changedSlugs = new Set(recentChanges.changedSlugs || []);
  if (slug && changedSlugs.has(slug) && rec.action !== 'new-content') {
    return `that post changed in the last ${RECENT_CHANGE_DAYS} days; wait for data first`;
  }
  if (topic === 'homepage-title' && recentChanges.homepageSeoChangedOn) {
    return `the homepage title/description changed on ${recentChanges.homepageSeoChangedOn}; wait ${RECENT_CHANGE_DAYS} days for data first`;
  }
  return null;
}

/** The prompt block that tells the model the same thing up front. */
export function describeHandledForPrompt(handled = [], recentChanges = {}) {
  const live = handled.filter(h => h.inFlight);
  const lines = [];
  if (live.length) {
    lines.push('ALREADY APPROVED OR SHIPPED, NOT MEASURED YET — do NOT recommend these again, or anything that restates them in other words:');
    for (const h of live.slice(0, 15)) {
      lines.push(`- ${h.id}: ${h.title || '(no title)'}${h.targetSlug ? ` [page: ${h.targetSlug}]` : ''} — ${h.sources.join(', ')}`);
    }
  }
  const changed = recentChanges.changedSlugs || [];
  if (recentChanges.homepageSeoChangedOn || changed.length) {
    lines.push(`CHANGED IN THE LAST ${RECENT_CHANGE_DAYS} DAYS — too fresh to judge, do NOT recommend changing these again yet:`);
    if (recentChanges.homepageSeoChangedOn) lines.push(`- the homepage title/meta description (changed ${recentChanges.homepageSeoChangedOn})`);
    for (const s of changed.slice(0, 20)) lines.push(`- post: ${s}`);
  }
  return lines.join('\n');
}

/** <title> and meta description out of a page, for the homepage SEO change check. */
export function extractHeadSeo(html) {
  const s = String(html || '');
  const title = (s.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (s.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [])[1] || '';
  return `${title.trim()}\u0001${desc.trim()}`;
}
