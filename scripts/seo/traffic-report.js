// scripts/seo/traffic-report.js  —  Arlo SEO sub-skill #3 (READ-ONLY)
//
// Pulls Vercel Web Analytics — our PRIMARY traffic source post-cutover.
// GA4 is deliberately NOT used here (it's unreliable since the www move;
// see CLAUDE.md). Reports: sessions/visitors, top pages, and % change vs the
// previous period.
//
// Vercel does not publish a long-term-stable public REST spec for Web
// Analytics numbers, so the endpoint is configurable and the parser is
// defensive: if the shape changes or the token is missing, this sub-skill
// SKIPS with a note instead of crashing (hard constraint).
//
// Env:
//   VERCEL_ANALYTICS_TOKEN (or VERCEL_TOKEN)  — Vercel access token
//   VERCEL_PROJECT_ID                          — the project's id/name
//   VERCEL_TEAM_ID                             — optional (team-scoped projects)
//   VERCEL_ANALYTICS_URL                       — optional override of the base
//                                                stats endpoint (advanced)
//   SEO_PERIOD_DAYS  (default 28)

import { ok, skip, fail, isoDaysAgo, pct, fmtPct, runStandalone } from './lib.js';

const PERIOD = parseInt(process.env.SEO_PERIOD_DAYS || '28', 10);

function authToken() { return process.env.VERCEL_ANALYTICS_TOKEN || process.env.VERCEL_TOKEN || null; }

function statsUrl(from, to) {
  const base = process.env.VERCEL_ANALYTICS_URL || 'https://vercel.com/api/web-analytics/stats';
  const params = new URLSearchParams({
    projectId: process.env.VERCEL_PROJECT_ID || '',
    from, to, environment: 'production',
  });
  if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID);
  return `${base}?${params.toString()}`;
}

async function fetchStats(token, from, to) {
  const res = await fetch(statsUrl(from, to), {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Defensive extraction — tolerate several plausible response shapes.
function extract(data) {
  const n = (v) => (typeof v === 'number' ? v : (v && typeof v.total === 'number' ? v.total : null));
  const sessions   = n(data.sessions) ?? n(data.visits) ?? n(data.visitors) ?? null;
  const visitors   = n(data.visitors) ?? n(data.uniqueVisitors) ?? sessions;
  const pageviews  = n(data.pageviews) ?? n(data.views) ?? null;
  let topPages = data.topPages || data.pages || (data.paths && data.paths.data) || [];
  topPages = (Array.isArray(topPages) ? topPages : []).slice(0, 10).map(p => ({
    path: p.path || p.key || p.page || p.href || '(unknown)',
    views: p.views ?? p.total ?? p.count ?? null,
  }));
  return { sessions, visitors, pageviews, topPages };
}

export async function run() {
  const SKILL = 'traffic-report';
  const token = authToken();
  if (!token) return skip(SKILL, 'VERCEL_ANALYTICS_TOKEN (or VERCEL_TOKEN) not set — Vercel Analytics skipped. GA4 is intentionally not used as a fallback.');
  if (!process.env.VERCEL_PROJECT_ID) return skip(SKILL, 'VERCEL_PROJECT_ID not set — cannot query Vercel Analytics.');

  try {
    const curFrom = isoDaysAgo(PERIOD), curTo = isoDaysAgo(1);
    const prevFrom = isoDaysAgo(PERIOD * 2), prevTo = isoDaysAgo(PERIOD + 1);

    const [cur, prev] = await Promise.all([
      fetchStats(token, curFrom, curTo),
      fetchStats(token, prevFrom, prevTo).catch(() => ({})),
    ]);
    const c = extract(cur), p = extract(prev);

    if (c.sessions == null && c.pageviews == null)
      return skip(SKILL, 'Vercel returned an unrecognized shape (no sessions/pageviews found). Set VERCEL_ANALYTICS_URL to the correct stats endpoint for your plan, or check the token scope.');

    const change = {
      sessions: p.sessions != null ? fmtPct(pct(c.sessions, p.sessions)) : 'n/a',
      visitors: p.visitors != null ? fmtPct(pct(c.visitors, p.visitors)) : 'n/a',
      pageviews: p.pageviews != null ? fmtPct(pct(c.pageviews, p.pageviews)) : 'n/a',
    };

    return ok(SKILL, {
      window: `${curFrom} → ${curTo}`,
      previousWindow: `${prevFrom} → ${prevTo}`,
      sessions: c.sessions,
      uniqueVisitors: c.visitors,
      pageviews: c.pageviews,
      changeVsPrev: change,
      topPages: c.topPages,
    });
  } catch (err) {
    return fail(SKILL, `Vercel Analytics query failed (${err.message}). Verify the token, VERCEL_PROJECT_ID/VERCEL_TEAM_ID, and that Web Analytics is enabled for the project.`);
  }
}

runStandalone(import.meta.url, run);
