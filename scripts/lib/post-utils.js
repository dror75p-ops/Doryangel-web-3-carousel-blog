// scripts/lib/post-utils.js — shared helpers used across the blog-automation scripts.
//
// Only functions that are true duplicates (byte-identical behavior) live here.
// Anything that looks similar but differs in a script — image-selection strategy,
// error handling, category taxonomies, fallback constants — stays local to that
// script on purpose; see each call site for why.

export function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[‐-―−]/g, ' ')  // em/en/figure dashes + minus → space, so "tenants—smart" → "tenants-smart" not "tenantssmart"
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')                  // trim leading/trailing hyphens before slicing
    .slice(0, 60)
    .replace(/-+$/g, '');                     // re-trim if the 60-char cut landed on a hyphen
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
