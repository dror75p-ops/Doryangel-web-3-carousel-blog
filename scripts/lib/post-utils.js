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
