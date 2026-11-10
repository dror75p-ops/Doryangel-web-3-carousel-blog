// scripts/lib/__verify__/verify-bronx-rank.js
//
// Proves the Bronx ranking basket (scripts/lib/bronx-rank.js) on the shape that
// misled the owner on 2026-11-10: the Bronx searches held still while an
// unrelated "luxury property management new york" query at position ~85 pulled
// the site-wide average from ~10 to ~12. Offline, no secrets.
//   node scripts/lib/__verify__/verify-bronx-rank.js

import { readFileSync } from 'fs';
import { isBronxTarget, hostPart, summariseBronxRank, positionMove } from '../bronx-rank.js';

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

// ── Which searches count ──
for (const q of [
  'property management bronx', 'property management companies bronx', 'property management bronx ny',
  'bronx property management', 'property management in the bronx', 'Bronx Property Management Companies',
  'bronx property manager', 'bronx apartment management companies', 'property management company bronx ny',
]) check(`"${q}" is a Bronx target`, isBronxTarget(q));
for (const q of [
  'luxury property management new york', 'nyc property management', 'property management queens',
  'bronx apartments for rent', '2050 grand concourse bronx', 'doryangel',
  'property management jobs bronx', 'bronx property manager salary', '', null,
]) check(`"${q}" is not a Bronx target`, !isBronxTarget(q));

// ── Which half of the result a page belongs to ──
check('apex homepage (http) is the profile listing', hostPart('http://doryangel.com/') === 'profile');
check('apex homepage (https) is the profile listing', hostPart('https://doryangel.com/') === 'profile');
check('www homepage is the website', hostPart('https://www.doryangel.com/') === 'site');
check('www blog post is the website', hostPart('https://www.doryangel.com/blog/x/') === 'site');
check('old apex path is "other", not the profile', hostPart('http://doryangel.com/home') === 'other');
check('beta is "other"', hostPart('https://beta.doryangel.com/blog/x/') === 'other');

// ── The 2026-11-10 shape ──
const row = (date, page, query, impressions, position, clicks = 0) =>
  ({ keys: [date, page, query], impressions, position, clicks });
const P = 'http://doryangel.com/', W = 'https://www.doryangel.com/';
const rows = [];
// Two steady weeks for the Bronx searches.
for (const d of ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
                 '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) {
  rows.push(row(d, P, 'property management bronx', 10, 1, 1));
  rows.push(row(d, W, 'property management bronx', 6, 18));
  rows.push(row(d, W, 'bronx property management', 4, 22));
}
// The unrelated query that moved the site average, only in the second week.
for (const d of ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'])
  rows.push(row(d, W, 'luxury property management new york', 30, 85));

const windows = {
  month: { from: '2026-10-13', to: '2026-11-09' },
  week: { from: '2026-11-03', to: '2026-11-09' },
  prevWeek: { from: '2026-10-27', to: '2026-11-02' },
};
const b = summariseBronxRank(rows, windows);
check('profile position is 1 in both weeks', b.week.profile.position === 1 && b.prevWeek.profile.position === 1);
check('website position is impression-weighted (6@18 + 4@22 = 19.6)', b.week.site.position === 19.6);
check('the luxury NY query does not move the website number', b.week.site.position === b.prevWeek.site.position);
check('no move in either half', positionMove(b.week.profile.position, b.prevWeek.profile.position) === 0
  && positionMove(b.week.site.position, b.prevWeek.site.position) === 0);
check('only Bronx searches are listed', b.queries.length === 2 && !b.queries.some(q => q.includes('luxury')));
check('7-day impressions per half', b.week.profile.impressions === 70 && b.week.site.impressions === 70);
check('clicks are summed', b.week.profile.clicks === 7);
check('the 28-day window covers both weeks', b.month.profile.impressions === 140);
check('"other" is empty, not mixed in', b.week.other.impressions === 0 && b.week.other.position === null);

// The trap itself: a blended site average over the same rows DOES move.
const blend = (from, to) => {
  const r = rows.filter(x => x.keys[0] >= from && x.keys[0] <= to);
  const i = r.reduce((n, x) => n + x.impressions, 0);
  return r.reduce((n, x) => n + x.position * x.impressions, 0) / i;
};
check('a blended average over the same data would have shown a fall',
  blend(windows.week.from, windows.week.to) - blend(windows.prevWeek.from, windows.prevWeek.to) > 10);

// ── Moves and empties ──
check('moving from 3 to 1 is +2 (up)', positionMove(1, 3) === 2);
check('moving from 1 to 3 is -2 (down)', positionMove(3, 1) === -2);
check('no data on one side is null, not 0', positionMove(null, 4) === null && positionMove(4, null) === null);
const none = summariseBronxRank([], windows);
check('no rows gives null positions, not 0', none.week.profile.position === null && none.week.site.position === null);
check('no rows gives an empty query list', none.queries.length === 0);

// ── Wiring in daily-audit.js ──
const audit = readFileSync('./scripts/daily-audit.js', 'utf8');
const fetchSrc = audit.slice(audit.indexOf('async function fetchBronxRank'), audit.indexOf('// Sums a slice of the daily series.'));
check('the fetch uses one filter with groupType "and"', /groupType:\s*'and'/.test(fetchSrc) && (fetchSrc.match(/dimension:\s*'query'/g) || []).length === 1);
check('the fetch splits by date, page and query', /dimensions:\s*\['date',\s*'page',\s*'query'\]/.test(fetchSrc));
check('a failed fetch fails soft', /Bronx basket unavailable/.test(audit));
check('the email leads with the Bronx searches', /Bronx property-management searches: position/.test(audit));
check('the email shows profile and website apart', /bronxHalf\('Google profile listing'/.test(audit) && /bronxHalf\('Website/.test(audit));
check('the 7-vs-7 table no longer prints the site-wide average', !/>Avg position</.test(audit));
check('the email says why the site-wide average is gone', /Site-wide average position is not shown on purpose/.test(audit));

console.log(`verify-bronx-rank: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
