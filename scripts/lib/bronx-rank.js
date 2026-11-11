// scripts/lib/bronx-rank.js
//
// Where DoryAngel ranks for the Bronx searches that bring owner leads, kept PURE
// (no network) so it can be tested offline. daily-audit.js fetches the rows and
// hands them to summariseBronxRank().
//
// ⚠️ WHY THIS EXISTS. Measured 2026-11-10: Arlo's email showed the site-wide
// "Avg position" sliding from ~10 to ~12 over a week, and the owner read it as
// a ranking drop. It was not one. The Bronx property-management searches held
// still the whole time: the Google profile listing at position 1 every day from
// 10-27 to 11-10, the www homepage at ~15-26. What moved the average was
// unrelated searches such as "luxury property management new york" appearing at
// position 80-90. A site-wide average moves whenever Google shows the site for
// something new, so it cannot tell the owner whether the business is ranking
// better or worse on its own. This basket can. The owner chose (2026-11-10) to
// keep BOTH in the email: the site-wide average, labelled "all searches", and
// this basket as the headline.
//
// The basket: a query that names the Bronx AND asks for property management
// (manager, management company, apartment or building management). Job
// searches are left out.
//
// The split, because the two halves rank nothing alike:
//   - profile = the apex homepage (http(s)://doryangel.com/). That is the
//     website link on the Google Business Profile, so its impressions are
//     mostly the local pack. This is an inference from the link, stated as one
//     in the email; GSC itself does not label local-pack results.
//   - site    = any www.doryangel.com page (the organic website result).
//   - other   = anything else (beta.doryangel.com, old apex paths such as /home).
// Never add the halves into one number in the headline. Position is
// impression-weighted within each half.

const PM_INTENT = /property manage|management compan|property manager|apartment management|building management|rental management/;
const NOT_A_CLIENT = /\b(jobs?|careers?|hiring|salary|salaries|resume|intern(ship)?)\b/;

export const HOST_PARTS = Object.freeze([
  { key: 'profile', label: 'Google profile listing', test: u => /^https?:\/\/doryangel\.com\/?$/i.test(u) },
  { key: 'site',    label: 'Website (www)',          test: u => /^https:\/\/www\.doryangel\.com\//i.test(u) },
  { key: 'other',   label: 'Old addresses',          test: () => true },
]);

/** True for a Bronx property-management search. */
export function isBronxTarget(query) {
  const q = String(query || '').toLowerCase();
  if (!/\bbronx\b/.test(q)) return false;
  if (NOT_A_CLIENT.test(q)) return false;
  return PM_INTENT.test(q);
}

export function hostPart(page) {
  return HOST_PARTS.find(h => h.test(String(page || ''))).key;
}

function empty() {
  return { clicks: 0, impressions: 0, weighted: 0 };
}

function finish(b) {
  return {
    clicks: b.clicks,
    impressions: b.impressions,
    position: b.impressions ? Number((b.weighted / b.impressions).toFixed(2)) : null,
  };
}

/**
 * @param rows    GSC rows with keys [date, page, query]
 * @param windows { name: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } }
 * @returns { [name]: { profile, site, other }, queries: string[] (distinct target queries, all windows) }
 */
export function summariseBronxRank(rows, windows) {
  const acc = {};
  for (const name of Object.keys(windows)) {
    acc[name] = Object.fromEntries(HOST_PARTS.map(h => [h.key, empty()]));
  }
  const queries = new Set();

  for (const r of rows || []) {
    const [date, page, query] = r.keys || [];
    if (!isBronxTarget(query)) continue;
    const part = hostPart(page);
    let used = false;
    for (const [name, w] of Object.entries(windows)) {
      if (date < w.from || date > w.to) continue;
      const b = acc[name][part];
      b.clicks += r.clicks || 0;
      b.impressions += r.impressions || 0;
      b.weighted += (r.position || 0) * (r.impressions || 0);
      used = true;
    }
    if (used) queries.add(String(query).toLowerCase());
  }

  const out = { queries: [...queries].sort() };
  for (const [name, parts] of Object.entries(acc)) {
    out[name] = Object.fromEntries(Object.entries(parts).map(([k, b]) => [k, finish(b)]));
  }
  return out;
}

/** Positive = moved up the results. null when either side has no data. */
export function positionMove(now, before) {
  if (now == null || before == null) return null;
  return Number((before - now).toFixed(2));
}

