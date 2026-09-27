// backfill-internal-links.js — one-time pass for ARLO-2026-09-27-03.
//
// 45 of 86 posts had no inbound body link from any other post (Nave only started
// weaving in-body links on 2026-07-24, and older posts were never linked back to).
// This gives every orphan two inbound contextual links from its most relevant
// sibling posts, as one "Related reading" line per source post.
//
// ⚠️ PLACEMENT IS DELIBERATE: the line goes at the END OF THE INTRO, before the
// first heading. extractFAQs() in build-blog.js folds every line under a
// "…?" heading into that question's FAQPage answer, and almost every section in
// these posts is a question heading — so a link line anywhere below the first
// heading would leak into the structured data Google reads.
//
// Idempotent: a post that already carries a Related-reading line is never used
// as a source again, and an orphan that has gained an inbound link is skipped.
//
// Usage: node scripts/backfill-internal-links.js [--dry-run]
//        then: node scripts/build-blog.js

import { readFileSync, writeFileSync } from 'fs';

const INDEX = './content/blog/posts-index.json';
const MARKER = '> **Related reading:**';
const LINKS_PER_ORPHAN = 2;
const MAX_LINKS_PER_SOURCE = 2; // one line, at most two links — never a link farm
const MIN_SCORE = 2;            // below this a link would be off-topic

const dryRun = process.argv.includes('--dry-run');
const raw = JSON.parse(readFileSync(INDEX, 'utf8'));
const posts = Array.isArray(raw) ? raw : raw.posts;

// Same scoring as getRelatedPosts() in build-blog.js, so "related" means the
// same thing in the body links as in the Continue-reading cards.
const STOP_WORDS = new Set([
  'the','and','for','you','your','are','with','that','this','what','why','how',
  'could','should','does','from','into','when','will','have','has','its','our',
  'bronx','nyc','landlord','landlords','2026','2025','new','york','city',
]);
function topicTokens(post) {
  const text = `${post.title} ${post.excerpt || ''}`.toLowerCase();
  return new Set(text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w)));
}
function relevanceScore(a, aTokens, b) {
  const aTags = new Set(a.hashtags || []);
  const tagScore = (b.hashtags || []).filter(t => aTags.has(t)).length * 3;
  let overlap = 0;
  for (const w of topicTokens(b)) if (aTokens.has(w)) overlap++;
  return tagScore + overlap;
}

// A slug that appears more than once in the index renders as ONE page (the last
// entry build-blog.js writes wins), so the other entries are invisible on the
// live site. Leave those entries out entirely — a link added to an invisible
// entry would never render, and they need a slug fix before anything else.
const slugCount = {};
for (const p of posts) slugCount[p.slug] = (slugCount[p.slug] || 0) + 1;
const eligible = posts.filter(p => slugCount[p.slug] === 1);

const linksIn = (post) => new Set(
  [...String(post.content || '').matchAll(/\/blog\/([a-z0-9-]+)\/?/g)].map(m => m[1]));

const inbound = new Set();
for (const p of posts) for (const s of linksIn(p)) if (s !== p.slug) inbound.add(s);
const orphans = eligible.filter(p => !inbound.has(p.slug));

// Candidate sources per orphan, best first.
const candidates = new Map();
for (const o of orphans) {
  const oTokens = topicTokens(o);
  candidates.set(o.slug, eligible
    .filter(s => s.slug !== o.slug && !String(s.content).includes(MARKER))
    .map(s => ({ s, score: relevanceScore(o, oTokens, s) }))
    .filter(c => c.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score
      || new Date(y.s.publishedDate) - new Date(x.s.publishedDate)));
}

// Greedy assignment, most-constrained orphan first, capped per source.
const assigned = new Map(); // source slug → [orphan posts]
const unplaced = [];
const order = [...orphans].sort((a, b) =>
  candidates.get(a.slug).length - candidates.get(b.slug).length);
for (const o of order) {
  let got = 0;
  for (const { s } of candidates.get(o.slug)) {
    if (got >= LINKS_PER_ORPHAN) break;
    const list = assigned.get(s.slug) || [];
    if (list.length >= MAX_LINKS_PER_SOURCE) continue;
    if (linksIn(s).has(o.slug)) continue;
    list.push(o);
    assigned.set(s.slug, list);
    got++;
  }
  if (got === 0) unplaced.push(o.slug);
}

// Insert one line at the end of the intro (before the first ##/### heading).
function insertRelated(content, targets) {
  const md = `${MARKER} ${targets.map(t => `[${t.title}](/blog/${t.slug}/)`).join(' · ')}`;
  const lines = content.split('\n');
  const firstHeading = lines.findIndex(l => /^#{2,3}\s/.test(l));
  if (firstHeading <= 0) return `${content.trimEnd()}\n\n${md}\n`;
  const before = lines.slice(0, firstHeading).join('\n').trimEnd();
  const after = lines.slice(firstHeading).join('\n');
  return `${before}\n\n${md}\n\n${after}`;
}

for (const [slug, targets] of assigned) {
  const post = posts.find(p => p.slug === slug);
  post.content = insertRelated(post.content, targets);
}

const linkCount = [...assigned.values()].reduce((n, l) => n + l.length, 0);
console.log(`Orphans: ${orphans.length} · links added: ${linkCount} · source posts touched: ${assigned.size}`);
if (unplaced.length) console.log(`No relevant source (score < ${MIN_SCORE}) for: ${unplaced.join(', ')}`);

if (dryRun) {
  for (const [slug, targets] of assigned) console.log(`  ${slug}\n    → ${targets.map(t => t.slug).join('\n    → ')}`);
  console.log('--dry-run: nothing written.');
} else {
  writeFileSync(INDEX, JSON.stringify(raw, null, 2));
  console.log(`Wrote ${INDEX}. Now run: node scripts/build-blog.js`);
}
