// scripts/lib/post-utils.js — shared helpers used across the blog-automation scripts.
//
// Only functions that are true duplicates (byte-identical behavior) live here.
// Anything that looks similar but differs in a script — image-selection strategy,
// error handling, category taxonomies, fallback constants — stays local to that
// script on purpose; see each call site for why.

export function generateSlug(title) {
  return slugify(title, 60);
}

function slugify(title, max) {
  return title
    .toLowerCase()
    .replace(/[‐-―−]/g, ' ')  // em/en/figure dashes + minus → space, so "tenants—smart" → "tenants-smart" not "tenantssmart"
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')                  // trim leading/trailing hyphens before slicing
    .slice(0, max)
    .replace(/-+$/g, '');                     // re-trim if the cut landed on a hyphen
}

// A slug that is NOT already in the index. Two titles that share their first 60
// characters ("Bronx vs. Mount Vernon: Which Landlords Actually Spend Less on…")
// used to get the same slug, and build-blog.js then wrote both to one page — the
// oldest entry won and the newer post never rendered. The words that tell such
// titles apart come after the cut, so extend the slug first; number it only as a
// last resort. Existing slugs are unaffected: a non-colliding title keeps the
// plain 60-char form.
export function uniqueSlug(title, takenSlugs) {
  const taken = new Set(takenSlugs);
  const base = generateSlug(title);
  if (!taken.has(base)) return base;
  const full = slugify(title, 1000);
  const longer = full.length <= 90 ? full : full.slice(0, 90).replace(/-[^-]*$/, ''); // whole words only
  if (!taken.has(longer)) return longer;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Date object -> "YYYY-MM-DD". Not to be confused with build-blog.js's own
// formatDate(iso), which goes the other direction (ISO string -> human display
// date) for a different purpose — that one stays local to build-blog.js.
export function toISODate(date) {
  return date.toISOString().split('T')[0];
}

export function wordsToMinutes(content) {
  const words = content.trim().split(/\s+/).length;
  return Math.max(2, Math.round(words / 220));
}

// Picks which of a category's Unsplash queries to search for, given the post's
// title. The category lists stay local to each script (see the header note) —
// what is shared is this choice, because both scripts had the same bug: they
// picked purely at random, so a roof post could be illustrated with a photo of a
// radiator while its heroImageAlt described a roof. Alt text that contradicts
// the image it labels is worse than useless to a screen reader.
//
// Scores each query by how many of its words appear in the title and returns the
// best match; falls back to a random pick when nothing overlaps, which is the
// old behaviour and the right default for a generic title.
const IMAGE_QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'your', 'you', 'what', 'how', 'why', 'is', 'are', 'do', 'does', 'should',
  'bright', 'modern', 'daylight', 'professional', 'nyc', 'bronx',
]);

export function pickImageQuery(queries, title = '') {
  const titleWords = new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );

  let best = null;
  let bestScore = 0;
  for (const query of queries) {
    const score = query
      .toLowerCase()
      .split(/\s+/)
      .filter(w => !IMAGE_QUERY_STOPWORDS.has(w))
      .filter(w => titleWords.has(w) || titleWords.has(`${w}s`) || titleWords.has(w.replace(/s$/, '')))
      .length;
    if (score > bestScore) { best = query; bestScore = score; }
  }

  return best ?? queries[Math.floor(Math.random() * queries.length)];
}

// Shared Unsplash search primitive. Builds the query, fetches, and returns the
// raw results array (or throws) — it does not pick a photo. Selection strategy
// (random vs. deterministic), width/crop params, and error-handling policy
// (throw / return null / fall back to a constant) are intentionally different
// per caller and stay local to each script.
export async function searchUnsplashPhotos(query) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15&content_filter=high`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
  });
  if (!res.ok) throw new Error(`Unsplash returned ${res.status}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error('No results');
  return data.results;
}

// Title-template repetition check, in code rather than in the prompt. From
// 2026-08-17 to 09-27 Nave opened eight titles with "Bronx vs. Mount Vernon:
// Which Landlords Actually …" — six collided on one slug and never rendered, and
// the semantic dedupe gate passed them all because the SUBJECTS differed. Returns
// the recent title that shares the opening, or null.
export const OPENING_WORDS = 6;
export function titleOpening(title) {
  // Swapping the comparison city is not a new shape: "Bronx vs. Yonkers: Which
  // Landlords Actually…" and "Bronx vs. Mount Vernon: Which Landlords Actually…"
  // both normalise to "bronx vs x which landlords actually". Comparisons stay
  // welcome — they just need a different sentence after the colon.
  return String(title).toLowerCase()
    .replace(/^\s*bronx\s+vs\.?\s+[^:?]{1,40}:/, 'bronx vs x ')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean).slice(0, OPENING_WORDS).join(' ');
}
export function sharedTitleOpening(title, existingPosts, recent = 15) {
  const opening = titleOpening(title);
  if (opening.split(' ').length < OPENING_WORDS) return null;
  const hit = existingPosts.slice(0, recent).find(p => titleOpening(p.title) === opening);
  return hit ? hit.title : null;
}

// Comparison titles ("Bronx vs. <city>: …") were 10 of the 15 posts from
// 2026-09-11 to 10-08 and none of them reached the top pages, so the format is
// capped: at most one in every COMPARISON_WINDOW recent titles.
export const COMPARISON_WINDOW = 5;
const isComparison = t => /^\s*bronx\s+vs\.?\s/i.test(String(t));

// Deterministic title gate, run on the FINAL title (the one that will be
// published), not just on the topic the picker chose: the writer is free to
// reword the title, and the 2026-10-05/10-09 posts slipped through that way.
// Returns a one-line reason, or null when the title is fine.
export function titleClash(title, existingPosts) {
  const hit = sharedTitleOpening(title, existingPosts);
  if (hit) return `its opening repeats the recent post "${hit}"`;
  if (isComparison(title) && existingPosts.slice(0, COMPARISON_WINDOW - 1).some(p => isComparison(p.title))) {
    return `a "Bronx vs. <city>" comparison already ran in the last ${COMPARISON_WINDOW - 1} posts`;
  }
  return null;
}
