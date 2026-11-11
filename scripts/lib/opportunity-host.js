// scripts/lib/opportunity-host.js
//
// Tells Arlo WHICH listing a search opportunity is really about, kept pure so it
// can be tested offline. daily-audit.js calls labelOpportunityHosts() on the
// opportunities findOpportunities() builds, before they reach the email or the
// recommendation prompt.
//
// ⚠️ WHY THIS EXISTS. The query opportunities ("striking-distance", "weak-ctr")
// are built from a query-only Search Console pull, which blends every address
// the site is served under into one position. Measured in the 2026-10-25 cycle:
// "bronx property management companies" read as one result at ~3-4 with a weak
// CTR, and Arlo recommended rewriting the homepage title to lift the CTR. The
// blend hid two different results: the old address http://doryangel.com/ at
// ~1.5 (the website link on the Google Business Profile, so mostly the map
// pack, where people call instead of clicking) and www at ~17. A title rewrite
// cannot move the map pack, and the "weak CTR" was mostly people calling.
//
// The rule: when the old apex address (doryangel.com) carries at least half of
// a query's impressions, the opportunity is labelled lever = 'google-profile'
// and its evidence says the title is not the lever. Otherwise it is labelled
// 'website' and, when the split is known, the evidence quotes www's own
// position, because that is the listing a title or content change can move.
// When the split is unknown (the query is not in the page×query pull) the
// opportunity is left as it was, labelled 'unknown'.
//
// "Mostly the Google profile" is an inference from the link, not a label GSC
// gives; the evidence says so.

export const LEVERS = Object.freeze({
  PROFILE: 'google-profile',
  WEBSITE: 'website',
  UNKNOWN: 'unknown',
});

export const LEVER_LABEL = Object.freeze({
  'google-profile': 'Google profile',
  'website': 'Website',
  'unknown': 'Not split',
});

// Opportunities whose subject is a search query. Page-level kinds already name
// one address, and the orphan kind is about links, not a listing.
const QUERY_KINDS = new Set(['striking-distance', 'weak-ctr']);

export const PROFILE_SHARE = 0.5;

function fmtPos(p) {
  return Number.isFinite(Number(p)) ? Number(p).toFixed(1) : '?';
}

/**
 * Where a query's impressions sit, from a hostQueries entry
 * ({ query, hosts: { www, apex, beta } }).
 * @returns null when the entry is missing or has no impressions.
 */
export function hostShare(entry) {
  if (!entry || !entry.hosts) return null;
  const get = k => entry.hosts[k] || { clicks: 0, impressions: 0, position: null };
  const www = get('www'), apex = get('apex'), beta = get('beta');
  const total = (www.impressions || 0) + (apex.impressions || 0) + (beta.impressions || 0);
  if (!total) return null;
  return { total, www, apex, beta, apexShare: (apex.impressions || 0) / total };
}

/** Label one opportunity. Returns a NEW object; the input is not changed. */
export function labelOpportunityHost(opportunity, hostQueries) {
  const o = { ...opportunity };
  if (!QUERY_KINDS.has(o.kind)) {
    o.lever = o.lever || LEVERS.WEBSITE;
    return o;
  }
  const key = String(o.subject || '').toLowerCase();
  const entry = (hostQueries || []).find(e => String(e.query || '').toLowerCase() === key);
  const share = hostShare(entry);
  if (!share) {
    o.lever = LEVERS.UNKNOWN;
    return o;
  }

  const pct = Math.round(share.apexShare * 100);
  const wwwPart = share.www.impressions
    ? `the website itself (www) sits at position ${fmtPos(share.www.position)} with ${share.www.impressions} impressions and ${share.www.clicks} clicks`
    : 'the website itself (www) does not appear for it';

  if (share.apexShare >= PROFILE_SHARE) {
    o.lever = LEVERS.PROFILE;
    o.evidence = `${o.evidence} Split by address: ${pct}% of the impressions are on the old address doryangel.com at position ${fmtPos(share.apex.position)} (the Google profile's website link, so mostly the map listing, where people call rather than click); ${wwwPart}. A title or content change will not move the map listing; the Google Business Profile is the lever.`;
  } else {
    o.lever = LEVERS.WEBSITE;
    o.evidence = `${o.evidence} Split by address: ${wwwPart}; ${pct}% of the impressions are on the old address doryangel.com.`;
  }
  return o;
}

export function labelOpportunityHosts(opportunities, hostQueries) {
  return (opportunities || []).map(o => labelOpportunityHost(o, hostQueries));
}
