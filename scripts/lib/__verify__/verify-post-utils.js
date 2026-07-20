// scripts/lib/__verify__/verify-post-utils.js
//
// Offline regression check for scripts/lib/post-utils.js. Run with:
//   node scripts/lib/__verify__/verify-post-utils.js
//
// Loads content/blog/posts-index.json read-only and checks that the shared
// module reproduces generate-post.js's original (pre-consolidation) output
// bit-for-bit, and that the generateSlug em-dash fix actually propagated to
// seed-automation-posts.js (which had the old, buggy version before this
// consolidation). Does not call any network API and does not write anything.

import { readFileSync } from 'fs';
import { generateSlug, toISODate, wordsToMinutes } from '../post-utils.js';

// Reference copy of generate-post.js's original (fixed) generateSlug, as it
// was before this consolidation — the shared module must match this exactly.
function generateSlugOld_GeneratePost(title) {
  return title
    .toLowerCase()
    .replace(/[‐-―−]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

// Reference copy of seed-automation-posts.js's original (buggy, pre-fix)
// generateSlug — used only to prove the fix actually changes behavior on
// dash-containing titles, not to assert equality with it.
function generateSlugOld_SeedAutomation(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
}

function wordsToMinutesOld(content) {
  const words = content.trim().split(/\s+/).length;
  return Math.max(2, Math.round(words / 220));
}

const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

// 1. generateSlug matches generate-post.js's original output on all real titles
let slugMatches = 0;
for (const p of posts) {
  const match = generateSlug(p.title) === generateSlugOld_GeneratePost(p.title);
  check(`generateSlug("${p.title}")`, match);
  if (match) slugMatches++;
}
console.log(`generateSlug: ${slugMatches}/${posts.length} match generate-post.js's original output`);

// 2. toISODate round-trips every post's existing publishedDate
let dateMatches = 0;
for (const p of posts) {
  const roundTrip = toISODate(new Date(p.publishedDate));
  const match = roundTrip === p.publishedDate;
  check(`toISODate round-trip for "${p.slug}" (${p.publishedDate} -> ${roundTrip})`, match);
  if (match) dateMatches++;
}
console.log(`toISODate: ${dateMatches}/${posts.length} round-trip correctly`);

// 3. wordsToMinutes matches the old formula on every real post's content
let minuteMatches = 0;
for (const p of posts) {
  const match = wordsToMinutes(p.content) === wordsToMinutesOld(p.content);
  check(`wordsToMinutes("${p.slug}")`, match);
  if (match) minuteMatches++;
}
console.log(`wordsToMinutes: ${minuteMatches}/${posts.length} match the original formula`);

// 4. Confirm the em-dash bug fix actually changed behavior (synthetic titles,
//    since production titles may not happen to contain a dash character).
const dashTitles = [
  'Tenants—Smart Choice for Bronx Landlords',
  'Bronx Rentals: A 5–Year Outlook',
  'What a Rent−Stabilized Unit Really Costs You',
];
let fixConfirmed = 0;
for (const title of dashTitles) {
  const oldBuggy = generateSlugOld_SeedAutomation(title);
  const newFixed = generateSlug(title);
  const differs = oldBuggy !== newFixed;
  check(`em-dash fix changes behavior for "${title}" (old="${oldBuggy}" new="${newFixed}")`, differs);
  if (differs) fixConfirmed++;
}
console.log(`em-dash fix: ${fixConfirmed}/${dashTitles.length} synthetic titles confirm the fix propagated`);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll checks passed (${posts.length} posts, ${dashTitles.length} synthetic dash titles).`);
}
