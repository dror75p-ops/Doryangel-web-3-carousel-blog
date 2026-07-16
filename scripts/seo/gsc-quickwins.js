// scripts/seo/gsc-quickwins.js  —  Arlo SEO sub-skill #2 (READ-ONLY)
//
// Pulls Google Search Console (last 28 days) and reports:
//   • QUICK WINS   — queries at position 4–20 with CTR below ~3% (ranking but
//                    under-clicked: a title/meta tweak usually moves these fast)
//   • CANNIBALIZATION — a single query where 2+ of our URLs both rank
//                    (we're competing with ourselves; consolidate/canonicalize)
//
// Auth reuses Arlo's service-account JWT (GOOGLE_SA_KEY, same secret as GA4).
// The service account must be added as a *user* on the GSC property.
//
// Env: GOOGLE_SA_KEY (service-account JSON, raw or base64),
//      GSC_SITE_URL   (property, e.g. "https://www.doryangel.com/" or
//                      "sc-domain:doryangel.com"; default www URL-prefix),
//      GSC_CTR_MAX    (default 0.03), GSC_POS_MIN (4), GSC_POS_MAX (20).
//
// Missing key → skips gracefully and notes it in the report (never crashes).

import {
  getGoogleAccessToken, parseServiceAccount, isoDaysAgo, ok, skip, fail, runStandalone,
} from './lib.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const CTR_MAX = parseFloat(process.env.GSC_CTR_MAX || '0.03');
const POS_MIN = parseFloat(process.env.GSC_POS_MIN || '4');
const POS_MAX = parseFloat(process.env.GSC_POS_MAX || '20');

async function gscQuery(token, siteUrl, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GSC ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.rows || [];
}

export async function run() {
  const SKILL = 'gsc-quickwins';
  const creds = parseServiceAccount(process.env.GOOGLE_SA_KEY);
  if (!creds) return skip(SKILL, 'GOOGLE_SA_KEY not set — GSC quick-wins skipped. Add the service-account JSON and grant it access to the GSC property.');
  const siteUrl = process.env.GSC_SITE_URL || 'https://www.doryangel.com/';

  try {
    const token = await getGoogleAccessToken(creds, SCOPE);
    const startDate = isoDaysAgo(28), endDate = isoDaysAgo(1);

    // 1) query-level rows → quick wins
    const qRows = await gscQuery(token, siteUrl, {
      startDate, endDate, dimensions: ['query'], rowLimit: 1000, dataState: 'all',
    });
    const quickWins = qRows
      .filter(r => r.position >= POS_MIN && r.position <= POS_MAX && r.ctr < CTR_MAX && r.impressions >= 10)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25)
      .map(r => ({
        query: r.keys[0],
        position: +r.position.toFixed(1),
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: +(r.ctr * 100).toFixed(2), // %
      }));

    // 2) query+page rows → cannibalization
    const qpRows = await gscQuery(token, siteUrl, {
      startDate, endDate, dimensions: ['query', 'page'], rowLimit: 5000, dataState: 'all',
    });
    const byQuery = new Map();
    for (const r of qpRows) {
      const [query, page] = r.keys;
      if (r.impressions < 5) continue;
      if (!byQuery.has(query)) byQuery.set(query, []);
      byQuery.get(query).push({ page, position: +r.position.toFixed(1), impressions: r.impressions, clicks: r.clicks });
    }
    const cannibalization = [...byQuery.entries()]
      .filter(([, pages]) => pages.length >= 2)
      .map(([query, pages]) => ({
        query,
        urls: pages.sort((a, b) => a.position - b.position),
        totalImpressions: pages.reduce((s, p) => s + p.impressions, 0),
      }))
      .sort((a, b) => b.totalImpressions - a.totalImpressions)
      .slice(0, 20);

    return ok(SKILL, {
      window: `${startDate} → ${endDate}`,
      siteUrl,
      thresholds: { positionRange: `${POS_MIN}-${POS_MAX}`, ctrMaxPct: CTR_MAX * 100 },
      quickWinsCount: quickWins.length,
      quickWins,
      cannibalizationCount: cannibalization.length,
      cannibalization,
      topQuickWinKeyword: quickWins[0]?.query || null,
    });
  } catch (err) {
    return fail(SKILL, `GSC query failed (${err.message}). Confirm the service account is added to the property and GSC_SITE_URL matches exactly.`);
  }
}

runStandalone(import.meta.url, run);
