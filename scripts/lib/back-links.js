// scripts/lib/back-links.js
//
// Gives every NEW post inbound links from older posts, so orphans stop coming
// back. Pure (no I/O), so it is tested offline by
// scripts/lib/__verify__/verify-back-links.js. Used by Nave (generate-post.js)
// right before the new post is written to the index.
//
// ⚠️ WHY THIS EXISTS. Nave links OUT of a new post to older ones (rule 15 in its
// prompt), but nothing ever linked BACK to the new post. So every new post was
// born an orphan: 45 of 86 posts by 2026-09-27 (fixed once by
// backfill-internal-links.js), and Arlo recommended "link the orphans" again in
// the 11-08 cycle (ARLO-2026-11-08-03). This makes the fix permanent instead of
// a recurring clean-up.
//
// ⚠️ THE LINK GOES IN ONE PLACE ONLY: the post's single "Related reading" line
// at the END OF THE INTRO, before the first heading. extractFAQs() in
// build-blog.js folds every line under a "…?" heading into the FAQPage answer,
// so a link anywhere lower leaks into the structured data Google reads. When a
// source post already has the line, the new link is appended to it; when it
// has none, the line is created in that same spot. Never a second line.
//
// ⚠️ ARLO MUST NOT READ THIS AS AN EDIT. Arlo fingerprints each post's SEO
// fields and body to tell whether an approved change shipped, and to skip pages
// changed in the last 28 days. A back-link would trip both, so his fingerprint
// hashes the body through stripRelatedReading() below.

export const MARKER = '> **Related reading:**';
export const BACK_LINKS_PER_NEW_POST = 2;
export const MAX_LINKS_PER_LINE = 3;   // one short line, never a link farm
export const MIN_SCORE = 2;            // below this the link would be off-topic

// Same scoring as getRelatedPosts() in build-blog.js and the 09-27 backfill, so
// "related" means the same thing everywhere on the blog.
const STOP_WORDS = new Set([
  'the','and','for','you','your','are','with','that','this','what','why','how',
  'could','should','does','from','into','when','will','have','has','its','our',
  'bronx','nyc','landlord','landlords','2026','2025','new','york','city',
]);

export function topicTokens(post) {
  const text = `${post.title} ${post.excerpt || ''}`.toLowerCase();
  return new Set(text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w)));
}

export function relevanceScore(a, b) {
  const aTags = new Set(a.hashtags || []);
  const tagScore = (b.hashtags || []).filter(t => aTags.has(t)).length * 3;
  const aTokens = topicTokens(a);
  let overlap = 0;
  for (const w of topicTokens(b)) if (aTokens.has(w)) overlap++;
  return tagScore + overlap;
}

/** Slugs this post's body links to. */
export function linkedSlugs(content) {
  return new Set([...String(content || '').matchAll(/\/blog\/([a-z0-9-]+)\/?/g)].map(m => m[1]));
}

/** Number of links already on the post's Related-reading line (0 when it has none). */
export function relatedLinkCount(content) {
  const line = String(content || '').split('\n').find(l => l.startsWith(MARKER));
  return line ? (line.match(/\]\(\/blog\//g) || []).length : 0;
}

/**
 * The body without its Related-reading line, with blank lines normalised.
 * Arlo hashes this, so adding or extending the line is never read as an edit.
 */
export function stripRelatedReading(content) {
  return String(content || '')
    .split('\n').filter(l => !l.startsWith(MARKER)).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mdLink(post) {
  // A "]" in a title would close the link text early.
  return `[${String(post.title).replace(/[[\]]/g, '')}](/blog/${post.slug}/)`;
}

/** Adds one link to the source body's Related-reading line, creating the line if needed. */
export function addRelatedLink(content, target) {
  const text = String(content || '');
  const lines = text.split('\n');
  const at = lines.findIndex(l => l.startsWith(MARKER));
  if (at >= 0) {
    lines[at] = `${lines[at].trimEnd()} · ${mdLink(target)}`;
    return lines.join('\n');
  }
  const md = `${MARKER} ${mdLink(target)}`;
  const firstHeading = lines.findIndex(l => /^#{2,3}\s/.test(l));
  if (firstHeading <= 0) return `${text.trimEnd()}\n\n${md}\n`;
  const before = lines.slice(0, firstHeading).join('\n').trimEnd();
  const after = lines.slice(firstHeading).join('\n');
  return `${before}\n\n${md}\n\n${after}`;
}

/**
 * Picks the older posts that should link to `newPost`, best first.
 * Skips: the post itself, any slug that appears more than once in the index
 * (only one of those entries renders), posts that already link to it, posts
 * whose line is full, and off-topic posts. Ties go to the post with fewer
 * links on its line, then to the newer post.
 */
export function pickBackLinkSources(posts, newPost, n = BACK_LINKS_PER_NEW_POST) {
  const count = {};
  for (const p of posts) count[p.slug] = (count[p.slug] || 0) + 1;
  return posts
    .filter(p => p.slug !== newPost.slug && count[p.slug] === 1)
    .filter(p => !linkedSlugs(p.content).has(newPost.slug))
    .filter(p => relatedLinkCount(p.content) < MAX_LINKS_PER_LINE)
    .map(p => ({ p, score: relevanceScore(newPost, p) }))
    .filter(c => c.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score
      || relatedLinkCount(x.p.content) - relatedLinkCount(y.p.content)
      || new Date(y.p.publishedDate) - new Date(x.p.publishedDate))
    .slice(0, n)
    .map(c => c.p);
}

/**
 * Links `newPost` from up to BACK_LINKS_PER_NEW_POST older posts. Changes the
 * chosen posts' content in place (the caller writes the index once) and
 * returns them. Returns [] when nothing is relevant enough.
 */
export function addBackLinks(posts, newPost, n = BACK_LINKS_PER_NEW_POST) {
  const sources = pickBackLinkSources(posts, newPost, n);
  for (const s of sources) s.content = addRelatedLink(s.content, newPost);
  return sources;
}
