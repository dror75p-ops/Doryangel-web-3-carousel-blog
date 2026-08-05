// scripts/daily-audit.js
// Daily website improvement automation:
//   1. Reads current state (HTML, blog posts, git log, open issues)
//   2. If any auto-task is needed → implements it and signals the workflow to commit + PR
//   3. Otherwise → asks Claude to generate a fresh GitHub Issue idea
//   4. Emails the owner a daily digest

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { createSign } from 'crypto';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFY_EMAIL = 'dror75p@gmail.com';
const REPO = 'dror75p-ops/Doryangel-web-3-carousel-blog';
// Prefer the workflow's built-in GITHUB_TOKEN (auto-provisioned, never expires,
// scoped by the workflow's `permissions` block) and fall back to a PAT if set.
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const AGENT_NAME = 'Arlo';

function today() { return new Date().toISOString().split('T')[0]; }

// ─── Shared Google credential health ─────────────────────────────────────────
//
// ⚠️ GA4, Search Console AND all five lead Sheets authenticate with the SAME
// GOOGLE_SA_KEY service account. When that one credential dies, three sections
// of this report fail at once — and each of them used to print its own
// "not connected — add the secret / add the user" card. That advice is wrong
// twice over: the secret IS set, and the grants were never revoked, so the
// owner spends the morning re-doing access that was already correct.
//
// That is exactly what happened on 2026-08-03: the service account's Google
// Cloud project was deleted, every Google call started returning 403, and the
// email told the owner to go add a user in Search Console ("2 minutes to fix").
// The real fix was in the Cloud console, and nothing in the email pointed there.
//
// classifyGoogleFailure() turns a raw API error into one cause so the report can
// name it once, at the top, instead of guessing three times:
//   'project-deleted' — the GCP project behind the key is gone (fatal, shared)
//   'sa-invalid'      — key revoked / SA deleted / clock skew (fatal, shared)
//   'api-disabled'    — that one API is off in the project (per-service)
//   'access'          — genuinely not granted on that property/sheet (per-service)
//   'unknown'         — anything else; the raw message is shown verbatim
const FATAL_CREDENTIAL_KINDS = new Set(['project-deleted', 'sa-invalid']);

function classifyGoogleFailure(message = '') {
  const m = String(message);
  if (/CONSUMER_INVALID|has been deleted|project.*deleted/i.test(m)) return 'project-deleted';
  if (/invalid_grant|invalid_client|Invalid JWT|account not found|unauthorized_client/i.test(m)) return 'sa-invalid';
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(m)) return 'api-disabled';
  if (/\b40[134]\b|PERMISSION_DENIED|permission|forbidden|not authori[sz]ed/i.test(m)) return 'access';
  return 'unknown';
}

function googleFailure(message, extra = {}) {
  return { kind: classifyGoogleFailure(message), message: String(message).slice(0, 400), ...extra };
}

// Parsed once so the report can name the exact service account and project the
// owner has to go fix, without every caller re-parsing the key.
function readServiceAccount() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) return null;
  try { return JSON.parse(saKey); } catch { return null; }
}

// ─── State ────────────────────────────────────────────────────────────────────

function readState() {
  const html = readFileSync('./index.html', 'utf8');
  const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));

  const now = new Date();
  const msDay = 86400000;

  const catCounts = {};
  posts.forEach(p => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });

  // Time-bucketed post counts
  const postsDay   = posts.filter(p => new Date(p.publishedDate) >= new Date(now - msDay)).length;
  const postsWeek  = posts.filter(p => new Date(p.publishedDate) >= new Date(now - 7 * msDay)).length;
  const postsMonth = posts.filter(p => new Date(p.publishedDate) >= new Date(now - 30 * msDay)).length;

  // Time-bucketed commit counts
  let commitsDay = 0, commitsWeek = 0, commitsMonth = 0;
  try {
    commitsDay   = parseInt(execSync('git log --oneline --since="1 day ago" | wc -l').toString()) || 0;
    commitsWeek  = parseInt(execSync('git log --oneline --since="7 days ago" | wc -l').toString()) || 0;
    commitsMonth = parseInt(execSync('git log --oneline --since="30 days ago" | wc -l').toString()) || 0;
  } catch {}

  let gitLog = '';
  try { gitLog = execSync('git log --oneline -20').toString().trim(); } catch {}

  const headEnd = html.indexOf('</head>');
  const head = html.slice(0, headEnd);

  // Detect the unconditional clarity block specifically (before <style>)
  const preStyleHead = head.slice(0, head.indexOf('<style'));
  const hasUnconditionalClarity = /\(function\(c,l,a,r,i,t,y\)/.test(preStyleHead);

  return {
    html,
    postCount: posts.length,
    categoryCounts: catCounts,
    recentPosts: posts.slice(0, 5).map(p => ({ title: p.title, date: p.publishedDate, category: p.category })),
    gitLog,
    stats: {
      posts:   { day: postsDay,   week: postsWeek,   month: postsMonth,   total: posts.length },
      commits: { day: commitsDay, week: commitsWeek, month: commitsMonth },
    },
    checks: {
      clarityGdprViolation: hasUnconditionalClarity,
      hasDnsPrefetch: html.includes('dns-prefetch'),
      hasFaqSchema: html.includes('"FAQPage"'),
      hasServiceSchema: html.includes('"Service"') || html.includes('"Product"'),
      hasBreadcrumbInBlog: false, // checked separately in build-blog.js
    },
  };
}

async function getOpenIssues() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&labels=automation&per_page=30`, {
      headers: {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) return [];
    const issues = await res.json();
    return issues.map(i => i.title);
  } catch {
    return [];
  }
}

// ─── Google Analytics 4 ───────────────────────────────────────────────────────

async function getGoogleAccessToken(credentials, scope = 'https://www.googleapis.com/auth/analytics.readonly') {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const toSign = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(credentials.private_key, 'base64url');
  const jwt = `${toSign}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`GA4 token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Returns the stats object on success, `null` when the integration is genuinely
// unconfigured, and `{ error }` when it IS configured but the call failed — the
// email renders a different (and honest) card for each of those three states.
async function getGA4Stats() {
  const saKey      = process.env.GOOGLE_SA_KEY;
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!saKey || !propertyId) return null;

  try {
    const credentials = JSON.parse(saKey);
    const token = await getGoogleAccessToken(credentials);

    // Fetch sessions + users + pageviews across 3 date ranges in one call
    const reportRes = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [
            { startDate: 'today',      endDate: 'today',      name: 'day'   },
            { startDate: '7daysAgo',   endDate: 'today',      name: 'week'  },
            { startDate: '30daysAgo',  endDate: 'today',      name: 'month' },
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
          ],
        }),
      }
    );
    const report = await reportRes.json();
    if (!report.rows) throw new Error(`GA4 report error: ${JSON.stringify(report)}`);

    // rows are indexed by dateRange: 0=day, 1=week, 2=month
    const byRange = {};
    report.rows.forEach(row => {
      byRange[row.dimensionValues?.[0]?.value] = {
        sessions:  parseInt(row.metricValues[0].value) || 0,
        users:     parseInt(row.metricValues[1].value) || 0,
        pageviews: parseInt(row.metricValues[2].value) || 0,
      };
    });

    // Fetch top 5 pages by sessions (last 30 days)
    const pagesRes = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 5,
        }),
      }
    );
    const pagesReport = await pagesRes.json();
    const topPages = (pagesReport.rows || []).map(r => ({
      path:     r.dimensionValues[0].value,
      sessions: parseInt(r.metricValues[0].value) || 0,
    }));

    return {
      sessions:  { day: byRange['day']?.sessions  ?? 0, week: byRange['week']?.sessions  ?? 0, month: byRange['month']?.sessions  ?? 0 },
      users:     { day: byRange['day']?.users      ?? 0, week: byRange['week']?.users      ?? 0, month: byRange['month']?.users      ?? 0 },
      pageviews: { day: byRange['day']?.pageviews  ?? 0, week: byRange['week']?.pageviews  ?? 0, month: byRange['month']?.pageviews  ?? 0 },
      topPages,
    };
  } catch (err) {
    // A warning annotation, not a bare console.warn: this used to scroll past in
    // a green run while the email claimed GA4 was simply "not connected".
    console.log(`::warning title=${AGENT_NAME}::GA4 fetch failed: ${err.message}`);
    return { error: googleFailure(err.message) };
  }
}

// ─── Google Search Console — where we actually rank ──────────────────────────
//
// Lives here rather than in its own script on purpose: Arlo already runs daily,
// already holds GOOGLE_SA_KEY, already sends this email, and getGoogleAccessToken
// above is already generic over `scope`. A separate rank-tracking agent would
// have duplicated a cron, a workflow, an email sender and this auth helper to
// deliver one more table.
//
// ⚠️ siteUrl MUST be the `sc-domain:` form. The owner's property is a Domain
// property covering apex + www; a URL-prefix value like
// "https://www.doryangel.com/" returns 403 against it.
//
// Uses the official Search Console API with owner-granted access. Never scrape
// Google results for rankings instead — that breaks Google's Terms of Service.
const GSC_SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:doryangel.com';

// The terms the business actually competes on. Kept local to this script per the
// lib philosophy in post-utils.js — this is data, not shared behaviour.
const WATCH_TERMS = [
  'bronx property management',
  'property management bronx',
  'property management bronx ny',
  'bronx property manager',
  'property management company bronx',
  'nyc property management',
  'flat fee property management',
  'flat fee property management nyc',
];

const RANK_HISTORY_FILE = './project/seo/rank-history.json';
const DAILY_SERIES_FILE = './project/seo/daily-series.json';
const QUERY_SERIES_FILE = './project/seo/query-series.json';
const ANNOTATIONS_FILE  = './project/seo/annotations.json';

// ⚠️ WHY THE DAILY SERIES EXISTS, AND WHY THE 28-DAY SNAPSHOT IS NOT ENOUGH.
//
// rank-history.json stores one 28-day aggregate per run. Consecutive runs
// therefore share 27 of their 28 days — 96% of the same data — so a "change"
// between two snapshots is three days rolling in and three rolling out,
// diluted by 28. A real one-day move shows up as ~1/28th of itself, smeared
// across the following four weeks. That is enough to see the current standing;
// it can never attribute a move to a cause.
//
// GSC keeps ~16 months and will return it broken down by date. One extra call
// with dimensions:['date'] therefore backfills the entire history RETROACTIVELY
// on the first run, instead of waiting months for daily snapshots to pile up.
// Do not "simplify" these back into the 28-day snapshot — the aggregate is the
// thing they exist to compensate for.
const SERIES_BACKFILL_DAYS = 480;   // GSC retains ~16 months
const SERIES_RESETTLE_DAYS = 14;    // refetch this tail each run — GSC revises it
const SERIES_KEEP_DAYS     = 540;

// The homepage is reported by GSC under three different hosts at once, and they
// rank very differently (measured 2026-08-03: apex ~5.9, www ~40). Averaging
// them together is what makes the site-wide "avg position" unreadable, so every
// series is also split by host. Both non-www hosts 308-redirect to www at the
// edge — verified against Vercel — so anything still showing under them is
// Google serving a URL it has not yet consolidated, not a live duplicate.
const HOST_BUCKETS = [
  { key: 'www',  label: 'www.doryangel.com',  regex: '^https://www\\.doryangel\\.com/' },
  { key: 'apex', label: 'doryangel.com',      regex: '^https?://doryangel\\.com/' },
  { key: 'beta', label: 'beta.doryangel.com', regex: '^https?://beta\\.doryangel\\.com/' },
];

// project/, not content/ — .vercelignore excludes project/ but NOT content/,
// and blog-loader.js fetches content/ client-side. A history file under content/
// would publish the full keyword export at a guessable public URL.
function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, value) {
  try {
    mkdirSync('./project/seo', { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
    return true;
  } catch (e) {
    console.log(`::warning title=${AGENT_NAME}::Could not write ${path}: ${e.message}`);
    return false;
  }
}

function readRankHistory() {
  try {
    if (!existsSync(RANK_HISTORY_FILE)) return [];
    const parsed = JSON.parse(readFileSync(RANK_HISTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRankHistory(history) {
  try {
    mkdirSync('./project/seo', { recursive: true });
    // ~2 years of daily snapshots is plenty and keeps the file reviewable.
    writeFileSync(RANK_HISTORY_FILE, JSON.stringify(history.slice(-730), null, 2) + '\n');
    return true;
  } catch (e) {
    console.log(`::warning title=${AGENT_NAME}::Could not write ${RANK_HISTORY_FILE}: ${e.message}`);
    return false;
  }
}

async function querySearchConsole(token, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json.rows || [];
}

const isoDay = d => d.toISOString().split('T')[0];
const dayOffset = n => isoDay(new Date(Date.now() - n * 864e5));

// Stored as [clicks, impressions, position] tuples rather than objects: eight
// watch terms over 16 months is ~3,800 data points, and one line each keeps the
// file diffable in a PR. ctr is omitted because it is clicks/impressions.
const tuple = r => [r.clicks, r.impressions, Number(r.position.toFixed(2))];

// ─── Daily series (the retroactive one) ──────────────────────────────────────
//
// Fetches site totals per day plus the same split three ways by host, merging
// into whatever is already on disk. First run pulls SERIES_BACKFILL_DAYS; every
// run after that re-pulls only the unsettled tail, because GSC keeps revising
// roughly the last two weeks after it first publishes them.
async function fetchDailySeries(token, endDate) {
  const store = readJsonFile(DAILY_SERIES_FILE, null);
  const days = store?.days && typeof store.days === 'object' ? store.days : {};
  const known = Object.keys(days).sort();
  const startDate = known.length
    ? [dayOffset(SERIES_RESETTLE_DAYS), known[known.length - 1]].sort()[0]
    : dayOffset(SERIES_BACKFILL_DAYS);

  if (startDate > endDate) return { days, backfilled: false };

  const base = { startDate, endDate, dataState: 'final', type: 'web', rowLimit: 25000 };
  const hostFilter = regex => ({
    dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: regex }] }],
  });

  const [totalRows, ...hostRows] = await Promise.all([
    querySearchConsole(token, { ...base, dimensions: ['date'] }),
    ...HOST_BUCKETS.map(h =>
      querySearchConsole(token, { ...base, dimensions: ['date'], ...hostFilter(h.regex) })
        // A malformed regex or a host with no data must not cost us the totals.
        .catch(e => { console.log(`::warning title=${AGENT_NAME}::Host series "${h.key}" failed: ${e.message}`); return []; })
    ),
  ]);

  for (const r of totalRows) days[r.keys[0]] = { total: tuple(r) };
  HOST_BUCKETS.forEach((h, i) => {
    for (const r of hostRows[i]) {
      const day = days[r.keys[0]] || (days[r.keys[0]] = {});
      day[h.key] = tuple(r);
    }
  });

  const trimmed = Object.fromEntries(
    Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-SERIES_KEEP_DAYS)
  );

  writeJsonFile(DAILY_SERIES_FILE, {
    format: 'days[YYYY-MM-DD] = { total|www|apex|beta: [clicks, impressions, avgPosition] }',
    note: 'Per-day, non-overlapping. Use this — not rank-history.json — to attribute a change to a date.',
    updatedAt: today(),
    fetchedFrom: startDate,
    fetchedTo: endDate,
    days: trimmed,
  });

  return { days: trimmed, backfilled: known.length === 0 };
}

// Per-day position for each watch term. Filtered to WATCH_TERMS so the response
// stays small — an unfiltered date×query pull would be tens of thousands of rows
// of one-impression address searches.
async function fetchWatchSeries(token, endDate) {
  const store = readJsonFile(QUERY_SERIES_FILE, null);
  const queries = store?.queries && typeof store.queries === 'object' ? store.queries : {};
  const seen = Object.values(queries).flatMap(v => Object.keys(v)).sort();
  const startDate = seen.length
    ? [dayOffset(SERIES_RESETTLE_DAYS), seen[seen.length - 1]].sort()[0]
    : dayOffset(SERIES_BACKFILL_DAYS);

  if (startDate > endDate) return queries;

  // ⚠️ ONE REQUEST PER TERM, EACH WITH A SINGLE FILTER — do not "optimise" this
  // into one call carrying all eight. The obvious way to write that is a filter
  // group of eight `equals` with groupType:'or', and the Search Console API only
  // supports groupType 'and': eight equals-filters ANDed together mean "a query
  // that is all eight terms at once", which matches nothing. It returns 200 with
  // an empty row set, so the failure is completely silent — this file would just
  // be written empty every day. Eight small requests are unambiguous instead.
  const perTerm = await Promise.all(WATCH_TERMS.map(term =>
    querySearchConsole(token, {
      startDate, endDate, dataState: 'final', type: 'web', rowLimit: 25000,
      dimensions: ['date'],
      dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression: term }] }],
    })
      // A term with no data is normal; a term whose request fails must not cost
      // us the other seven.
      .then(rows => [term, rows])
      .catch(e => {
        console.log(`::warning title=${AGENT_NAME}::Watch-term series "${term}" failed: ${e.message}`);
        return [term, []];
      })
  ));

  let rowCount = 0;
  for (const [term, rows] of perTerm) {
    for (const r of rows) {
      (queries[term] || (queries[term] = {}))[r.keys[0]] = tuple(r);
      rowCount++;
    }
  }

  // Every watch term drawing zero rows over a multi-month backfill is not a
  // plausible ranking result — it means the filter or the terms are wrong. Say
  // so, rather than committing an empty file that looks like a finding.
  if (rowCount === 0) {
    console.log(`::warning title=${AGENT_NAME}::No watch-term rows for ${startDate}..${endDate}. Every term returned empty — check WATCH_TERMS against the queries in rank-history.json before trusting this.`);
  }

  for (const q of Object.keys(queries)) {
    queries[q] = Object.fromEntries(
      Object.entries(queries[q]).sort(([a], [b]) => a.localeCompare(b)).slice(-SERIES_KEEP_DAYS)
    );
  }

  writeJsonFile(QUERY_SERIES_FILE, {
    format: 'queries[term][YYYY-MM-DD] = [clicks, impressions, avgPosition]',
    note: 'A missing date means the term drew no impressions that day — that is signal, not a gap.',
    updatedAt: today(),
    queries,
  });

  return queries;
}

// ─── Query mix ───────────────────────────────────────────────────────────────
//
// ⚠️ WHY THIS EXISTS: `topQueries` is `queryRows.slice(0, 25)`, and GSC returns
// rows sorted by CLICKS descending. So those 25 rows are the top 25 by clicks —
// a handful with clicks, then whichever zero-click rows sort alphabetically
// first (numeric strings win, which is why they read as a wall of street
// addresses). The other 475 rows were fetched and discarded.
//
// On 2026-08-03 that cost a whole strategic read: the discarded rows were
// mistaken for "the tail", and a claim that 93% of impressions were address
// searches was built on what is actually an alphabetical artifact. Nothing about
// the tail's real composition was ever measured. These buckets measure it, over
// every row returned.
const QUERY_BUCKETS = [
  // A leading house number, or a street/building word — someone looking up a
  // specific building, not shopping for a manager.
  { key: 'address',    label: 'Building / address lookups', test: q =>
      /^\s*\d+[\s-]/.test(q) || /\b(ave|avenue|st|street|rd|road|blvd|boulevard|concourse|parkway|pkwy|terrace|plaza)\b/.test(q) },
  { key: 'branded',    label: 'Brand searches',             test: q => /dory\s*angel|doryangel/.test(q) },
  // The queries the business actually competes on.
  { key: 'commercial', label: 'Property-management intent', test: q =>
      /property manage|management compan|property manager|rental manage|landlord service/.test(q) },
  { key: 'other',      label: 'Everything else',            test: () => true },
];

function summariseQueryMix(rows) {
  const buckets = QUERY_BUCKETS.map(b => ({ key: b.key, label: b.label, queries: 0, clicks: 0, impressions: 0, weighted: 0 }));
  for (const r of rows) {
    const q = String(r.keys[0] || '').toLowerCase();
    const i = QUERY_BUCKETS.findIndex(b => b.test(q));
    const b = buckets[i < 0 ? buckets.length - 1 : i];
    b.queries++;
    b.clicks += r.clicks;
    b.impressions += r.impressions;
    b.weighted += r.position * r.impressions;
  }
  return buckets.map(({ weighted, ...b }) => ({
    ...b,
    position: b.impressions ? Number((weighted / b.impressions).toFixed(2)) : null,
  }));
}

// ─── page × query ────────────────────────────────────────────────────────────
//
// The one pull that settles whether apex genuinely outranks www or the two
// hosts are simply serving different query mixes. `page` and `query` were only
// ever fetched as separate dimensions, so that question has been open — and it
// is load-bearing: it decides whether the host split is a ranking problem or a
// reporting artifact.
async function fetchHostQueries(token, window) {
  const rows = await querySearchConsole(token, {
    ...window, dataState: 'final', type: 'web', rowLimit: 25000,
    dimensions: ['page', 'query'],
  });

  const byQuery = new Map();
  for (const r of rows) {
    const [page, query] = r.keys;
    const host = HOST_BUCKETS.find(h => new RegExp(h.regex, 'i').test(page));
    if (!host) continue;
    const entry = byQuery.get(query) || (byQuery.set(query, { query, total: 0, hosts: {} }), byQuery.get(query));
    entry.total += r.impressions;
    const h = entry.hosts[host.key] || (entry.hosts[host.key] = { clicks: 0, impressions: 0, weighted: 0 });
    h.clicks += r.clicks;
    h.impressions += r.impressions;
    h.weighted += r.position * r.impressions;
  }

  // Only the queries where more than one host appears are interesting, plus the
  // watch terms regardless — those are the ones the decision hangs on.
  const shaped = [...byQuery.values()]
    .filter(e => Object.keys(e.hosts).length > 1 || WATCH_TERMS.includes(e.query.toLowerCase()))
    .sort((a, b) => b.total - a.total)
    .slice(0, 30)
    .map(e => ({
      query: e.query,
      hosts: Object.fromEntries(Object.entries(e.hosts).map(([k, v]) => [k, {
        clicks: v.clicks,
        impressions: v.impressions,
        position: Number((v.weighted / v.impressions).toFixed(2)),
      }])),
    }));

  return { split: shaped, pairs: rows.length };
}

// Sums a slice of the daily series. Used for 7-day vs previous-7-day, which is
// the smallest comparison that is genuinely non-overlapping — unlike the 28-day
// snapshot deltas, a move here happened in the week it is reported in.
function sumWindow(days, bucket, fromDate, toDate) {
  let clicks = 0, impressions = 0, weighted = 0;
  for (const [date, entry] of Object.entries(days)) {
    if (date < fromDate || date > toDate) continue;
    const t = entry?.[bucket];
    if (!t) continue;
    clicks += t[0];
    impressions += t[1];
    weighted += t[2] * t[1];
  }
  return { clicks, impressions, position: impressions ? weighted / impressions : null };
}

// ─── Change log ──────────────────────────────────────────────────────────────
//
// A ranking series answers "what changed and when". It cannot answer "because
// of what" without the other half: a dated record of what WE changed. Git
// already is that record, so this derives annotations from it rather than
// asking anyone to maintain a second list by hand — which also means the
// backfilled ranking history lands next to a backfilled change history.
const ANNOTATION_NOISE = /^(Arlo: rank snapshot|docs:|Merge branch|Merge pull request)/i;

function buildAnnotations() {
  let raw = '';
  try {
    raw = execSync(
      `git log --since="${SERIES_BACKFILL_DAYS} days ago" --date=short --pretty=format:'%ad|%s' --no-merges`,
      { maxBuffer: 8 * 1024 * 1024 }
    ).toString();
  } catch (e) {
    console.log(`::warning title=${AGENT_NAME}::Could not read git log for SEO annotations: ${e.message}`);
    return [];
  }

  const events = [];
  for (const line of raw.split('\n')) {
    const sep = line.indexOf('|');
    if (sep < 0) continue;
    const date = line.slice(0, sep).replace(/'/g, '').trim();
    const subject = line.slice(sep + 1).replace(/'/g, '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !subject || ANNOTATION_NOISE.test(subject)) continue;
    const kind = /^Auto-publish: new blog post/i.test(subject) ? 'post'
      : /sitemap|robots|redirect|canonical|vercel\.json|title|meta|schema|seo/i.test(subject) ? 'seo'
      : 'site';
    events.push({ date, kind, subject: subject.slice(0, 140) });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  writeJsonFile(ANNOTATIONS_FILE, {
    note: 'Derived from git history each run. Line these up against daily-series.json to attribute a ranking move.',
    updatedAt: today(),
    events,
  });
  return events;
}

async function getSearchConsoleStats() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) {
    console.log(`::warning title=${AGENT_NAME}::GOOGLE_SA_KEY is not set — no Search Console rankings in today's report.`);
    return null;
  }

  let credentials;
  try {
    credentials = JSON.parse(saKey);
  } catch {
    console.log(`::warning title=${AGENT_NAME}::GOOGLE_SA_KEY is not valid JSON — skipping Search Console.`);
    return null;
  }

  try {
    const token = await getGoogleAccessToken(credentials, 'https://www.googleapis.com/auth/webmasters.readonly');

    // GSC finalises data ~3 days behind. A 28-day window keeps these numbers
    // directly comparable to the manual export the current baseline came from.
    const end = new Date(Date.now() - 3 * 864e5);
    const start = new Date(end.getTime() - 27 * 864e5);
    const iso = d => d.toISOString().split('T')[0];
    const window = { startDate: iso(start), endDate: iso(end) };
    const base = { ...window, dataState: 'final', type: 'web' };

    const [totalsRows, queryRows, pageRows] = await Promise.all([
      querySearchConsole(token, { ...base }),
      querySearchConsole(token, { ...base, dimensions: ['query'], rowLimit: 500 }),
      querySearchConsole(token, { ...base, dimensions: ['page'], rowLimit: 250 }),
    ]);

    const t = totalsRows[0];
    const totals = t
      ? { clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, position: t.position }
      : { clicks: 0, impressions: 0, ctr: 0, position: null };

    const byQuery = new Map(queryRows.map(r => [r.keys[0].toLowerCase(), r]));
    // A watched term absent from the top 500 is signal, not an error — record it
    // as null rather than dropping the row, so a fall-off is visible as a gap.
    const watch = WATCH_TERMS.map(q => {
      const r = byQuery.get(q);
      return r
        ? { query: q, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }
        : { query: q, clicks: 0, impressions: 0, ctr: 0, position: null };
    });

    const shape = r => ({
      key: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    });
    // ⚠️ topQueries is top-by-CLICKS (GSC's sort order). Keeping only that is
    // what produced the 2026-08-03 misreading — see summariseQueryMix(). These
    // three lines are a set: the click view, the impression view, and the mix
    // over EVERY row. Do not drop the last two back out.
    const topQueries = queryRows.slice(0, 25).map(shape);
    const topByImpressions = [...queryRows].sort((a, b) => b.impressions - a.impressions).slice(0, 25).map(shape);
    const queryMix = summariseQueryMix(queryRows);
    const topPages = pageRows.slice(0, 25).map(shape);

    // The commercial basket: the only totals worth steering on. The site-wide
    // average blends three hosts and an unmeasured tail of address lookups, so
    // it cannot move in response to anything we do — it is not reported.
    const commercial = queryMix.find(b => b.key === 'commercial') || null;

    // Split the same window by host. Computed over the full 250-row page pull,
    // not the 25 kept for the email, so the shares are the real ones.
    const hosts = HOST_BUCKETS.map(h => {
      const re = new RegExp(h.regex, 'i');
      const rows = pageRows.filter(r => re.test(r.keys[0]));
      const impressions = rows.reduce((n, r) => n + r.impressions, 0);
      return {
        key: h.key,
        label: h.label,
        pages: rows.length,
        clicks: rows.reduce((n, r) => n + r.clicks, 0),
        impressions,
        position: impressions
          ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions
          : null,
      };
    });

    // page × query — fails soft like the series files. Its absence costs the
    // host-attribution card, nothing else.
    let hostQueries = null;
    try {
      hostQueries = await fetchHostQueries(token, window);
    } catch (e) {
      console.log(`::warning title=${AGENT_NAME}::page×query unavailable: ${e.message}`);
    }

    const snapshot = {
      runDate: today(), window, totals, watch,
      topQueries, topByImpressions, queryMix, topPages, hosts,
      hostQueries: hostQueries?.split || [],
    };

    // The series files are the point of this whole block — see the comment on
    // SERIES_BACKFILL_DAYS. They fail soft individually: a broken series must
    // never cost the report its 28-day snapshot, which is what already works.
    let daily = {}, backfilled = false, watchSeries = {};
    try {
      ({ days: daily, backfilled } = await fetchDailySeries(token, window.endDate));
    } catch (e) {
      console.log(`::warning title=${AGENT_NAME}::Daily series unavailable: ${e.message}`);
    }
    try {
      watchSeries = await fetchWatchSeries(token, window.endDate);
    } catch (e) {
      console.log(`::warning title=${AGENT_NAME}::Watch-term series unavailable: ${e.message}`);
    }
    const annotations = buildAnnotations();

    // 7 days vs the 7 before them — genuinely non-overlapping, unlike the
    // snapshot-to-snapshot delta the email used to lead with.
    const wEnd = window.endDate;
    const wStart = dayOffset(3 + 6);
    const pEnd = dayOffset(3 + 7);
    const pStart = dayOffset(3 + 13);
    const trend = {
      current: { from: wStart, to: wEnd, ...sumWindow(daily, 'total', wStart, wEnd) },
      previous: { from: pStart, to: pEnd, ...sumWindow(daily, 'total', pStart, pEnd) },
      days: Object.keys(daily).length,
      backfilled,
      annotations: annotations.filter(a => a.date >= pStart && a.date <= wEnd),
    };

    const history = readRankHistory();
    const previous = history.length ? history[history.length - 1] : null;
    // One snapshot per day — a re-run replaces rather than duplicating.
    const filtered = history.filter(h => h.runDate !== snapshot.runDate);
    filtered.push(snapshot);
    writeRankHistory(filtered);

    const money = watch.find(w => w.query === 'bronx property management');
    console.log(`GSC: ${totals.clicks} clicks / ${totals.impressions} impressions, "bronx property management" position ${money?.position?.toFixed(1) ?? 'not in top 500'}`);
    console.log(`GSC hosts: ${hosts.map(h => `${h.key} ${h.impressions} impr @ ${h.position?.toFixed(1) ?? '—'}`).join(' · ')}`);
    console.log(`GSC series: ${trend.days} days on file${backfilled ? ' (backfilled this run)' : ''}, ${Object.keys(watchSeries).length} watch terms, ${annotations.length} change-log entries`);
    console.log(`GSC query mix (${queryRows.length} rows): ${queryMix.map(b => `${b.key} ${b.impressions} impr / ${b.clicks} clk`).join(' · ')}`);
    console.log(`GSC page×query: ${hostQueries ? `${hostQueries.pairs} pairs, ${hostQueries.split.length} queries served by >1 host` : 'unavailable'}`);

    return { snapshot, previous, trend, watchSeries };
  } catch (e) {
    // ⚠️ A 403 here has TWO very different causes and they need different fixes.
    // Before 2026-08-03 every 401/403/404 was reported as "not connected yet —
    // add the service account in Search Console", which was correct only on the
    // first run. Once the connection is live, the same 403 usually means the
    // shared credential died (deleted project, revoked key) — and telling the
    // owner to re-add a user who is already there wastes the morning. Classify
    // it and let the email say which one it actually is.
    const failure = googleFailure(`${e.status || ''} ${e.message}`, {
      clientEmail: credentials.client_email || null,
    });
    if (FATAL_CREDENTIAL_KINDS.has(failure.kind)) {
      console.log(`::error title=${AGENT_NAME}::Search Console failed because the GOOGLE_SA_KEY credential itself is dead (${failure.kind}): ${e.message}. GA4 and the lead sheets use the same key, so they are down too. No history was written.`);
    } else if (failure.kind === 'access' || failure.kind === 'api-disabled') {
      console.log(`::warning title=${AGENT_NAME}::No Search Console access for ${GSC_SITE_URL}. Add ${credentials.client_email || 'the service account'} as a user on the doryangel.com Domain property (Search Console → Settings → Users and permissions → Add user → Restricted), and enable the Search Console API in the same Google Cloud project. No history was written.`);
    } else {
      console.log(`::warning title=${AGENT_NAME}::Search Console query failed: ${e.message}`);
    }
    return { error: failure };
  }
}

// ─── Lead stats from all 3 Google Sheets ─────────────────────────────────────

const LEAD_SHEETS = [
  {
    id:    '18El2tatb8w8gxbaEhEsu2-562waRDwZMow7jHGcMaxs',
    label: 'Owner leads (voice)',
    tsCol: 16,   // "Date and time" column
    nameCol: 4,  // full_name
    tabs: ['new owners', 'vendors', 'brokers', 'looking for rent', 'anything else'],
  },
  {
    id:    '1YEFPfjyifDXsiujQHFpf871-xDdXJ93Fb6hNGXlbF60',
    label: 'Apartment inquiries (voice)',
    tsCol: 11,   // "date and time" column
    nameCol: 0,  // full_name
  },
  {
    id:    '1druOTrJhRVhrbAPrGBWD8HtMNkxy-h-PiJcYEhGsuHk',
    label: 'Hailey chat leads',
    tsCol: 0,     // "Timestamp" column
    nameCol: 2,   // full_name (col C)
    chat: true,   // Hailey web-chat agent — track success rate
    phoneCol: 3,  // callback_phone (col D)
    emailCol: 4,  // email_address (col E)
  },
  {
    id:    '1-9IDAD1VmlnCvTdU3JqDWahjEFQaUFtRG-WayHZ9N8o',
    label: 'Newsletter subscribers',
    tsCol: 3,    // "date subscribed" column
    nameCol: 0,  // name
  },
  {
    id:    '1KbVggQNhKbX9370zq-thBzHmN1j1R4g9YI8gKm8_R-o',
    label: 'PM tool subscribers',
    tsCol: 3,    // "signup_date" column
    nameCol: 0,  // email (most reliable identifier)
  },
];

async function getMakeStats() {
  const saKey = process.env.GOOGLE_SA_KEY;
  if (!saKey) return null;

  try {
    const credentials = JSON.parse(saKey);
    const token = await getGoogleAccessToken(
      credentials,
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    );

    const now = Date.now();
    const msDay  = 86400000;
    const cutDay   = now - msDay;
    const cutWeek  = now - 7 * msDay;
    const cutMonth = now - 30 * msDay;

    const results = await Promise.all(LEAD_SHEETS.map(async (sheet) => {
      try {
        const tabNames = sheet.tabs || ['Sheet1'];
        const tabResults = await Promise.all(tabNames.map(async (tab) => {
          const res = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values/${encodeURIComponent(tab)}`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          if (!res.ok) throw new Error(`${res.status} on tab "${tab}"`);
          const data = await res.json();
          return (data.values || []).slice(1); // skip header row per tab
        }));
        const rows = tabResults.flat();

        const valid = rows.filter(r => {
          const ts = r[sheet.tsCol] && new Date(r[sheet.tsCol]).getTime();
          return ts && !isNaN(ts);
        });

        const inPeriod = (r, cut) => new Date(r[sheet.tsCol]).getTime() >= cut;
        const isLead   = r => !!(r[sheet.nameCol]);

        const out = {
          label: sheet.label,
          day:   valid.filter(r => inPeriod(r, cutDay)   && isLead(r)).length,
          week:  valid.filter(r => inPeriod(r, cutWeek)  && isLead(r)).length,
          month: valid.filter(r => inPeriod(r, cutMonth) && isLead(r)).length,
          total: valid.filter(r => isLead(r)).length,
        };

        // Hailey chat agent: success rate = qualified leads / total chat sessions.
        // `chat_successful` is unreliable (Make.com leaves it blank), so we treat a
        // session as "successful" when it captured a name AND a phone or email.
        if (sheet.chat) {
          const qualified = r =>
            !!r[sheet.nameCol] && !!(r[sheet.phoneCol] || r[sheet.emailCol]);
          const sessions = valid.length;              // every logged chat = one session
          const wins     = valid.filter(qualified).length;
          out.chat = {
            sessions,
            qualified: wins,
            successRate: sessions ? Math.round((wins / sessions) * 100) : 0,
          };
        }

        return out;
      } catch (e) {
        return { label: sheet.label, day: 0, week: 0, month: 0, total: 0, error: e.message };
      }
    }));

    // Aggregate totals
    const totals = results.reduce(
      (acc, s) => ({
        day:   acc.day   + s.day,
        week:  acc.week  + s.week,
        month: acc.month + s.month,
        total: acc.total + s.total,
      }),
      { day: 0, week: 0, month: 0, total: 0 }
    );

    // ⚠️ A failed sheet read contributes 0, so when EVERY sheet fails the totals
    // row still renders a tidy "0 leads, 0 all time" table — which reads as a
    // collapsed business rather than a broken credential. Say so instead.
    const failed = results.filter(s => s.error);
    if (failed.length === results.length) {
      const failure = googleFailure(failed[0].error);
      console.log(`::${FATAL_CREDENTIAL_KINDS.has(failure.kind) ? 'error' : 'warning'} title=${AGENT_NAME}::All ${results.length} lead sheets failed to read (${failure.message}) — today's lead counts are UNKNOWN, not zero.`);
      return { totals, sources: results, error: failure };
    }

    return { totals, sources: results };
  } catch (err) {
    console.log(`::warning title=${AGENT_NAME}::Lead stats failed: ${err.message}`);
    return { error: googleFailure(err.message) };
  }
}

// ─── Microsoft Clarity behavioral insights ────────────────────────────────────
// One call to the live-insights endpoint (last 3 days) returns traffic, scroll
// depth, engagement, and the friction signals (dead/rage/quickback clicks,
// script errors) plus top pages + device breakdown. Consent-gated on our site,
// so it captures only cookie-accepters and structurally undercounts — treat it
// as directional behavior, not volume. Returns null when the token is absent
// (integration stays dormant until CLARITY_API_TOKEN is set).
async function getClarityStats() {
  const token = process.env.CLARITY_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Clarity ${res.status}`);
    const data = await res.json();

    const byName = {};
    for (const m of data) byName[m.metricName] = m.information || [];
    const first = (arr) => (arr && arr[0]) || {};

    const traffic = first(byName.Traffic);
    const scroll  = first(byName.ScrollDepth);
    const eng     = first(byName.EngagementTime);
    // Friction metrics carry a total count (subTotal) + % of sessions affected.
    const friction = (name) => {
      const info = first(byName[name]);
      return { count: +(info.subTotal || 0), pctSessions: info.sessionsWithMetricPercentage || 0 };
    };
    const topPages = (byName.PopularPages || [])
      .map(p => ({ url: p.url, visits: +(p.visitsCount || 0) }))
      .sort((a, b) => b.visits - a.visits).slice(0, 5);
    const devices = (byName.Device || [])
      .map(d => ({ name: d.name, sessions: +(d.sessionsCount || 0) }));
    const sources = (byName.ReferrerUrl || [])
      .map(r => ({ name: r.name || 'direct', sessions: +(r.sessionsCount || 0) }))
      .sort((a, b) => b.sessions - a.sessions).slice(0, 5);

    return {
      windowDays: 3,
      sessions:        +(traffic.totalSessionCount || 0),
      botSessions:     +(traffic.totalBotSessionCount || 0),
      users:           +(traffic.distinctUserCount || 0),
      pagesPerSession: Math.round((traffic.pagesPerSessionPercentage || 0) * 100) / 100,
      avgScrollDepth:  scroll.averageScrollDepth ?? null,
      engagementSec:   +(eng.totalTime || 0),
      activeSec:       +(eng.activeTime || 0),
      deadClicks:      friction('DeadClickCount'),
      rageClicks:      friction('RageClickCount'),
      quickbacks:      friction('QuickbackClick'),
      scriptErrors:    friction('ScriptErrorCount'),
      topPages,
      devices,
      sources,
    };
  } catch (err) {
    console.warn(`Clarity fetch failed: ${err.message}`);
    return null;
  }
}

// ─── Auto-implementable improvements (highest priority first) ─────────────────

const AUTO_TASKS = [
  {
    id: 'clarity-gdpr-fix',
    label: 'Fix Clarity GDPR violation',
    why: 'Clarity loads unconditionally in <head> before cookie consent. This violates GDPR — the consent-gated version at the bottom is the correct one and already handles all tracking.',
    priority: 10,
    isNeeded: (s) => s.checks.clarityGdprViolation,
    apply: (html) => {
      // Remove the standalone unconditional clarity block from head
      return html.replace(
        /<script type="text\/javascript">\n\s*\(function\(c,l,a,r,i,t,y\)\{[\s\S]*?\}\)\(window, document, "clarity", "script", "[^"]+"\);\n<\/script>\n/,
        ''
      );
    },
  },
  {
    id: 'dns-prefetch-analytics',
    label: 'Add dns-prefetch for analytics hosts',
    why: 'preconnect is set for Google Fonts but analytics hosts (GA4, Clarity) are missing dns-prefetch. Saves 100-200ms on first tracking ping.',
    priority: 7,
    isNeeded: (s) => !s.checks.hasDnsPrefetch,
    apply: (html) => {
      const hints = '<link rel="dns-prefetch" href="https://www.google-analytics.com">\n<link rel="dns-prefetch" href="https://www.clarity.ms">';
      return html.replace(
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        hints + '\n<link rel="preconnect" href="https://fonts.googleapis.com">'
      );
    },
  },
  {
    id: 'faq-schema',
    label: 'Add FAQPage JSON-LD schema',
    why: 'FAQ structured data triggers Google rich results (expandable Q&A in SERPs), significantly boosting CTR from organic search.',
    priority: 8,
    isNeeded: (s) => !s.checks.hasFaqSchema && s.html.toLowerCase().includes('faq'),
    apply: (html) => {
      // Extract FAQ items from the HTML
      const faqSchema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much does DoryAngel property management cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "DoryAngel offers flat-fee property management starting at $99/unit/month — no percentage of rent, no hidden fees. The Professional Plan is $199/unit/month and includes full service."
      }
    },
    {
      "@type": "Question",
      "name": "What areas does DoryAngel serve?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "DoryAngel serves the Bronx, Queens, Yonkers, Mount Vernon, New Rochelle, and North Jersey. We have been managing NYC rental properties since 2010."
      }
    },
    {
      "@type": "Question",
      "name": "What is included in DoryAngel's flat-fee property management?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Our flat-fee plans include tenant screening, rent collection, maintenance coordination, HPD violation management, real-time owner dashboards, and 24/7 emergency response."
      }
    },
    {
      "@type": "Question",
      "name": "How is DoryAngel different from traditional property managers?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Traditional property managers charge 8-12% of monthly rent. DoryAngel charges a flat $99/unit/month regardless of rent amount — saving Bronx and NYC landlords hundreds of dollars per month."
      }
    }
  ]
}
</script>`;
      return html.replace('</head>', faqSchema + '\n</head>');
    },
  },
];

// ─── GitHub Issue creation ────────────────────────────────────────────────────

async function createGitHubIssue(title, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${GH_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ title, body, labels: ['enhancement', 'automation'] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.html_url;
}

// ─── Claude — generate a fresh issue idea ─────────────────────────────────────

async function generateIssueIdea(state, openIssueTitles, ga4, clarity) {
  const catSummary = Object.entries(state.categoryCounts)
    .map(([c, n]) => `${c}: ${n} posts`).join(', ');

  // `ga4` can now also be an { error } object — never treat a failed fetch as
  // real data, and never let the idea generator "explain" a credential outage
  // as a traffic collapse.
  const ga4Line = ga4?.sessions
    ? `${ga4.sessions.month} sessions / ${ga4.users.month} users (30d); top pages: ${ga4.topPages.slice(0, 3).map(p => `${p.path} (${p.sessions})`).join(', ') || 'n/a'}`
    : ga4?.error
      ? 'UNAVAILABLE today (API error, not a traffic drop) — ignore traffic in your reasoning'
      : 'not connected';

  const clarityLine = clarity
    ? `${clarity.sessions} sessions / ${clarity.users} users (last 3d — consent-gated, so it UNDERCOUNTS and skews to power users; treat as directional, not volume). `
      + `Avg scroll depth ${clarity.avgScrollDepth ?? 'n/a'}%. Friction: dead-clicks ${clarity.deadClicks.pctSessions}% of sessions, rage-clicks ${clarity.rageClicks.pctSessions}%, quickbacks ${clarity.quickbacks.pctSessions}%, script-errors ${clarity.scriptErrors.pctSessions}%. `
      + `Top pages: ${clarity.topPages.slice(0, 3).map(p => `${p.url} (${p.visits})`).join(', ') || 'n/a'}`
    : 'not connected';

  const prompt = `You are the growth advisor for DoryAngel LLC, a NYC flat-fee property management company targeting Bronx landlords.

Current website state:
- Blog posts: ${state.postCount} total — ${catSummary}
- Most recent posts: ${state.recentPosts.map(p => `"${p.title}" (${p.category})`).join(', ')}
- Recent activity: ${state.gitLog.split('\n').slice(0, 8).join(' | ')}

Real user analytics — GROUND your suggestion in this actual behavior, don't guess:
- GA4 traffic: ${ga4Line}
- Clarity behavior: ${clarityLine}

If the behavioral data reveals a concrete UX problem — low scroll depth on a key page, meaningful dead/rage clicks, high quickbacks (instant bounces), or script errors — PRIORITIZE a task that fixes it, and cite the specific number in your "## Why". Only fall back to a generic growth idea when the behavioral data shows no clear problem. Ignore metrics that are near-zero on a tiny sample.

Open improvement issues already created (avoid duplicating these):
${openIssueTitles.length ? openIssueTitles.map(t => `- ${t}`).join('\n') : '- None yet'}

Generate ONE specific, high-value website improvement task that is NOT already in the open issues list.
Focus on what would most increase organic traffic, leads, or conversions for a Bronx property management company.

Options to consider (pick the single best one for today):
- Content: specific blog post topic or content series idea
- SEO: technical or on-page improvement
- Conversion: lead capture, CTA, or form improvement
- Social proof: reviews, testimonials, case studies
- Distribution: social automation, email, backlinks
- Analytics: tracking gaps

Return ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "title": "GitHub issue title (under 72 chars)",
  "body": "Full GitHub issue body in markdown — include: ## Why, ## What to build, ## Acceptance criteria. Be specific and actionable. 200-400 words.",
  "why_today": "One sentence explaining why this is the right task to do now"
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

// Hard dedupe gate: the prompt-level "avoid duplicating these" instruction is
// unreliable (the model re-proposes the same hub/calculator idea in different
// words). This SEMANTIC check runs after generation and blocks filing when the
// new idea is substantially the same work as an existing open issue. Fails open
// (returns null) on any error so a hiccup never blocks a genuinely new idea.
async function findDuplicateOpenIssue(idea, openIssueTitles) {
  if (!openIssueTitles.length) return null;
  const prompt = `You are a strict deduplication gate for a website-improvement backlog.

NEW idea title: "${idea.title}"
NEW idea summary: ${String(idea.body || '').replace(/\s+/g, ' ').slice(0, 600)}

EXISTING open issues:
${openIssueTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Does the NEW idea deliver substantially the SAME work as any EXISTING issue — same page, hub, tool, or content topic — even if worded differently? Treat any pillar/hub/internal-linking idea as a duplicate of any other pillar/hub/internal-linking idea, and any cost/ROI/savings calculator as a duplicate of any other. Only answer false if the core deliverable is genuinely different.

Return ONLY JSON: {"duplicate": true|false, "of": "<exact existing title, or empty>"}`;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return parsed.duplicate ? (parsed.of || 'an existing open issue') : null;
  } catch (err) {
    console.warn(`Dedupe gate check failed (${err.message}) — filing anyway`);
    return null;
  }
}

// ─── Email digest ─────────────────────────────────────────────────────────────

async function sendDigest({ taskLabel, taskWhy, resultType, resultLink, state, ga4, make, clarity, gsc }) {
  const { stats, categoryCounts, postCount } = state;

  // ── Shared-credential banner ─────────────────────────────────────────────────
  // One card, at the very top, when the single service account behind GA4 +
  // Search Console + the lead sheets is what broke. Without it the reader gets
  // three unrelated-looking yellow cards, each proposing a fix for a connection
  // that is already correctly configured.
  const sa = readServiceAccount();
  const googleErrors = [ga4?.error, gsc?.error, make?.error].filter(Boolean);
  const fatal = googleErrors.find(e => FATAL_CREDENTIAL_KINDS.has(e.kind));
  let credentialBanner = '';
  if (fatal) {
    const down = [
      ga4?.error && 'Website traffic (GA4)',
      gsc?.error && 'Google rankings (Search Console)',
      make?.error && 'Lead counts (all 5 Google Sheets)',
    ].filter(Boolean);
    // Partial outages are real and common: after a project is restored, Google's
    // services drop the stale "deleted" state at different rates, so GA4 and
    // Sheets typically come back before Search Console. Claiming all three are
    // down when two are visibly reporting numbers is the same over-claiming bug
    // this banner exists to fix — so say exactly which ones are actually out.
    const partial = down.length > 0 && down.length < 3;
    const fixSteps = fatal.kind === 'project-deleted'
      ? `${partial ? '<li><strong>If you already restored the project, stop here and just re-run the audit in an hour</strong> — a source that is still reporting the old error while the others recover is a stale cache, not a second fault.</li>' : ''}
         <li>Open <a href="https://console.cloud.google.com/cloud-resource-manager" style="color:#B91C1C;">Cloud Resource Manager</a> → <strong>Resources pending deletion</strong> → <strong>Restore</strong> the project. Google keeps a deleted project recoverable for <strong>30 days</strong>; restoring it brings all three integrations back with no other changes.</li>
           <li>If the 30 days are gone: create a new project, create a service account, enable the <strong>Analytics Data</strong>, <strong>Search Console</strong> and <strong>Sheets</strong> APIs, then re-grant it in <em>three</em> places — GA4 property, the doryangel.com Domain property in Search Console, and each of the 5 lead sheets — and paste the new JSON key into the <code>GOOGLE_SA_KEY</code> repo secret.</li>`
      : `<li>The key in <code>GOOGLE_SA_KEY</code> is no longer valid (revoked, or the service account was deleted). Mint a fresh JSON key for <code>${sa?.client_email || 'the service account'}</code> in Google Cloud → IAM &amp; Admin → Service Accounts → Keys, and update the <code>GOOGLE_SA_KEY</code> repo secret.</li>
           <li>If the service account itself is gone, recreate it and re-grant it on the GA4 property, the Search Console Domain property, and all 5 lead sheets.</li>`;
    credentialBanner = `
    <div style="background:#FEF2F2;border:2px solid #B91C1C;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#B91C1C;font-size:14px;font-weight:700;">${partial ? '🚨 Google service account is partly down — one credential, not several problems' : '🚨 Google service account is down — this is ONE problem, not three'}</p>
      <p style="margin:8px 0 0;color:#7F1D1D;font-size:12px;">GA4, Search Console and the lead sheets all authenticate with the same key.${partial ? ' The other sources in this email are reading fine, so the credential is partly working — if you just restored the project, the rest is still catching up. Blank today:' : ' It stopped working, so these sections are blank today:'}</p>
      <p style="margin:6px 0 0;color:#7F1D1D;font-size:12px;"><strong>${down.join(' · ') || 'Google data sources'}</strong></p>
      <p style="margin:10px 0 0;color:#7F1D1D;font-size:12px;">Google says: <span style="font-family:monospace;">${fatal.message}</span></p>
      ${sa ? `<p style="margin:6px 0 0;color:#7F1D1D;font-size:12px;font-family:monospace;word-break:break-all;">${sa.client_email || ''}${sa.project_id ? ` (project ${sa.project_id})` : ''}</p>` : ''}
      <p style="margin:10px 0 4px;color:#7F1D1D;font-size:12px;font-weight:700;">How to fix</p>
      <ol style="margin:0;padding-left:18px;color:#7F1D1D;font-size:12px;">${fixSteps}</ol>
      <p style="margin:10px 0 0;color:#7F1D1D;font-size:12px;">${partial
        ? 'Nothing needs re-granting. If the project was just restored, the remaining source is almost certainly still holding a cached copy of the old state — wait up to an hour and re-run the audit before changing anything.'
        : 'Nothing needs re-adding in Search Console or the sheets — those grants are still in place. Ranking history stops accumulating until this is fixed.'}</p>
    </div>`;
  }

  const resultColor     = resultType === 'code' ? '#E8F8E8' : '#E7F3FF';
  const resultBorder    = resultType === 'code' ? '#8FCB8F' : '#8FBCEB';
  const resultTextColor = resultType === 'code' ? '#1B6B1B' : '#1B4F8A';
  const resultIcon      = resultType === 'code' ? '✅ Implemented — PR opened' : '📋 GitHub Issue created';

  // ── Activity table rows ──────────────────────────────────────────────────────
  function statRow(label, { day, week, month }, color, bg) {
    return `<tr style="background:${bg};">
      <td style="padding:10px 12px;color:#556070;font-size:13px;">${label}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${day}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${week}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:${color};font-size:20px;">${month}</td>
    </tr>`;
  }

  // ── Category bar chart ───────────────────────────────────────────────────────
  const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const maxCat = sortedCats[0]?.[1] || 1;
  const catBars = sortedCats.map(([cat, n], i) => {
    const pct = Math.round((n / maxCat) * 100);
    const bg  = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
    const label = cat.replace(/-/g, ' ');
    return `<tr style="background:${bg};">
      <td style="padding:6px 12px;color:#556070;font-size:12px;width:38%;">${label}</td>
      <td style="padding:6px 12px;width:50%;">
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="width:${pct}%;background:#1E5AA8;height:10px;border-radius:3px;"></td>
          <td style="width:${100 - pct}%;"></td>
        </tr></table>
      </td>
      <td style="padding:6px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;width:12%;">${n}</td>
    </tr>`;
  }).join('');

  // ── Recent posts ─────────────────────────────────────────────────────────────
  const recentRows = state.recentPosts.map((p, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
    return `<tr style="background:${bg};">
      <td style="padding:5px 12px;color:#0F2847;font-size:12px;">${p.title}</td>
      <td style="padding:5px 12px;color:#8B9BAE;font-size:11px;white-space:nowrap;">${p.date}</td>
    </tr>`;
  }).join('');

  // ── GA4 traffic section ───────────────────────────────────────────────────────
  let ga4Section = '';
  if (ga4?.sessions) {
    const maxSessions = Math.max(ga4.topPages[0]?.sessions || 1, 1);
    const topPageRows = ga4.topPages.map((p, i) => {
      const pct = Math.round((p.sessions / maxSessions) * 100);
      const bg  = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
      const label = p.path.length > 42 ? p.path.slice(0, 42) + '…' : p.path;
      return `<tr style="background:${bg};">
        <td style="padding:5px 12px;color:#556070;font-size:12px;width:42%;font-family:monospace;">${label}</td>
        <td style="padding:5px 12px;width:46%;">
          <table style="width:100%;border-collapse:collapse;"><tr>
            <td style="width:${pct}%;background:#5B9FEA;height:8px;border-radius:3px;"></td>
            <td style="width:${100 - pct}%;"></td>
          </tr></table>
        </td>
        <td style="padding:5px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;width:12%;">${p.sessions}</td>
      </tr>`;
    }).join('');

    ga4Section = `
    <!-- GA4 traffic -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🌐 Website traffic (GA4)</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#F4F7FA;">
        <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:34%;">Metric</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">Today</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">7 days</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">30 days</th>
      </tr>
      ${statRow('Sessions', ga4.sessions, '#1E5AA8', '#ffffff')}
      ${statRow('Active users', ga4.users, '#0F2847', '#F8FAFB')}
      ${statRow('Page views', ga4.pageviews, '#5B7A9F', '#ffffff')}
    </table>
    <p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">Top pages — last 30 days</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      ${topPageRows}
    </table>`;
  } else if (ga4?.error) {
    // Configured, but the call failed. Never print "add the secret" here — the
    // secret is set, and that advice sent the owner looking in the wrong place.
    ga4Section = fatal ? '' : `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">⚠️ GA4 traffic unavailable today — this is not a traffic drop</p>
      <p style="margin:4px 0 0;color:#92400E;font-size:12px;">The Analytics Data API call failed, so today's numbers are unknown rather than zero.</p>
      <p style="margin:6px 0 0;color:#92400E;font-size:12px;font-family:monospace;word-break:break-all;">${ga4.error.message}</p>
      ${ga4.error.kind === 'api-disabled' ? '<p style="margin:6px 0 0;color:#92400E;font-size:12px;">Enable the <strong>Google Analytics Data API</strong> in the Cloud project that owns the service account.</p>' : ''}
      ${ga4.error.kind === 'access' ? `<p style="margin:6px 0 0;color:#92400E;font-size:12px;">Add <code>${sa?.client_email || 'the service account'}</code> as a <strong>Viewer</strong> on the GA4 property.</p>` : ''}
    </div>`;
  } else {
    ga4Section = `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">🔌 GA4 not connected</p>
      <p style="margin:4px 0 0;color:#92400E;font-size:12px;">Add <code>GA4_PROPERTY_ID</code> and <code>GOOGLE_SA_KEY</code> as GitHub secrets to see traffic data here.</p>
    </div>`;
  }

  // ── Search Console rankings ──────────────────────────────────────────────────
  // The point of this block: position is the bottleneck, not content volume.
  // "bronx property management" sitting at ~12 means top of page 2 — impressions
  // without clicks. Page 1 starts at position 10, so that line is marked.
  let gscSection = '';
  if (gsc?.snapshot) {
    const { snapshot, previous, trend } = gsc;
    const prevPos = q => previous?.watch?.find(w => w.query === q)?.position ?? null;
    const fmtPos = p => (p == null ? '—' : p.toFixed(1));
    const delta = (now, before) => {
      if (now == null || before == null) return '<span style="color:#8B9BAE;">—</span>';
      const d = before - now; // positive = moved UP the results
      if (Math.abs(d) < 0.1) return '<span style="color:#8B9BAE;">no change</span>';
      const up = d > 0;
      return `<span style="color:${up ? '#1E9E6A' : '#B91C1C'};font-weight:700;">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</span>`;
    };

    const money = snapshot.watch.find(w => w.query === 'bronx property management');
    const moneyPos = money?.position ?? null;
    const onPage1 = moneyPos != null && moneyPos <= 10;

    // ⚠️ The site-wide "avg position" USED to sit here and has been removed on
    // purpose. It averages three hosts that rank 6, 12 and 48, over a query set
    // that is mostly building-address lookups — so it cannot respond to anything
    // we do, and steering on it wasted real effort. Report the commercial basket
    // instead. Do not put the site average back.
    const commercialBucket = (snapshot.queryMix || []).find(b => b.key === 'commercial');
    const commercialLine = commercialBucket
      ? `Property-management queries: <strong>${commercialBucket.clicks}</strong> clicks · <strong>${commercialBucket.impressions}</strong> impressions · avg position ${fmtPos(commercialBucket.position)} <span style="color:#8B9BAE;">(site-wide average deliberately not shown — it blends hosts and address lookups)</span>`
      : `Site totals: <strong>${snapshot.totals.clicks}</strong> clicks · <strong>${snapshot.totals.impressions}</strong> impressions`;

    const watchRows = snapshot.watch.map((w, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
      const posColor = w.position == null ? '#8B9BAE' : w.position <= 10 ? '#1E9E6A' : w.position <= 20 ? '#B7791F' : '#556070';
      return `<tr style="background:${bg};">
        <td style="padding:6px 12px;color:#556070;font-size:12px;">${w.query}</td>
        <td style="padding:6px 12px;text-align:center;font-weight:700;color:${posColor};font-size:14px;">${fmtPos(w.position)}</td>
        <td style="padding:6px 12px;text-align:center;font-size:12px;">${delta(w.position, prevPos(w.query))}</td>
        <td style="padding:6px 12px;text-align:right;color:#0F2847;font-size:12px;">${w.impressions}</td>
        <td style="padding:6px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;">${w.clicks}</td>
      </tr>`;
    }).join('');

    // Which pages the impressions are actually landing on — the other half of
    // the ranking picture, and the thing that says where to spend effort next.
    const pageRowsHtml = snapshot.topPages.slice(0, 8).map((p, i) => {
      const path = p.key.replace('https://www.doryangel.com', '') || '/';
      const label = path.length > 46 ? path.slice(0, 46) + '…' : path;
      return `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#F8FAFB'};">
        <td style="padding:5px 12px;color:#556070;font-size:12px;font-family:monospace;">${label}</td>
        <td style="padding:5px 12px;text-align:right;color:#556070;font-size:12px;">pos ${fmtPos(p.position)}</td>
        <td style="padding:5px 12px;text-align:right;color:#0F2847;font-size:12px;">${p.impressions} impr</td>
        <td style="padding:5px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;">${p.clicks}</td>
      </tr>`;
    }).join('');

    const areaBlock = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">Top pages by impressions</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      ${pageRowsHtml}
    </table>`;

    // ── 7 days vs the previous 7 ────────────────────────────────────────────
    // The big number above is a 28-day average, and the "change" beside it is
    // two 28-day averages that share 27 days. This block is the honest one:
    // two windows that do not touch, off the per-day series.
    let trendBlock = '';
    if (trend?.current?.impressions || trend?.previous?.impressions) {
      const pct = (now, before) => {
        if (!before) return '<span style="color:#8B9BAE;">—</span>';
        const d = ((now - before) / before) * 100;
        if (Math.abs(d) < 1) return '<span style="color:#8B9BAE;">flat</span>';
        return `<span style="color:${d > 0 ? '#1E9E6A' : '#B91C1C'};font-weight:700;">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</span>`;
      };
      const posMove = (now, before) => {
        if (now == null || before == null) return '<span style="color:#8B9BAE;">—</span>';
        const d = before - now;
        if (Math.abs(d) < 0.1) return '<span style="color:#8B9BAE;">flat</span>';
        return `<span style="color:${d > 0 ? '#1E9E6A' : '#B91C1C'};font-weight:700;">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</span>`;
      };
      const changed = (trend.annotations || []).slice(-6).map(a =>
        `<li style="margin:0 0 2px;">${a.date} · <span style="color:#8B9BAE;">${a.kind}</span> — ${a.subject.replace(/[<>&]/g, '')}</li>`
      ).join('');

      trendBlock = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">Last 7 days vs the 7 before (no overlap)</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:12px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
        <tr style="background:#F4F7FA;">
          <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Metric</th>
          <th style="padding:8px 12px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Prev 7d</th>
          <th style="padding:8px 12px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Last 7d</th>
          <th style="padding:8px 12px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Move</th>
        </tr>
        <tr><td style="padding:6px 12px;font-size:12px;color:#556070;">Impressions</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${trend.previous.impressions}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:700;color:#0F2847;">${trend.current.impressions}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;">${pct(trend.current.impressions, trend.previous.impressions)}</td></tr>
        <tr style="background:#F8FAFB;"><td style="padding:6px 12px;font-size:12px;color:#556070;">Clicks</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${trend.previous.clicks}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:700;color:#0F2847;">${trend.current.clicks}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;">${pct(trend.current.clicks, trend.previous.clicks)}</td></tr>
        <tr><td style="padding:6px 12px;font-size:12px;color:#556070;">Avg position</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${fmtPos(trend.previous.position)}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:700;color:#0F2847;">${fmtPos(trend.current.position)}</td>
          <td style="padding:6px 12px;text-align:right;font-size:12px;">${posMove(trend.current.position, trend.previous.position)}</td></tr>
      </table>
      ${changed ? `<p style="font-size:12px;color:#8B9BAE;margin:0 0 4px;">What changed in that fortnight</p>
      <ul style="margin:0 0 20px;padding-left:18px;font-size:12px;color:#556070;">${changed}</ul>` : '<div style="margin-bottom:20px;"></div>'}`;
    }

    // ── Host split ──────────────────────────────────────────────────────────
    // Google still serves the pre-cutover hosts for some queries, and they rank
    // nothing like www does, so the site-wide average is a blend of three very
    // different things. Showing the split is what stops that average being read
    // as one number — and tracks whether consolidation is actually progressing.
    let hostBlock = '';
    const hostRows = (snapshot.hosts || []).filter(h => h.impressions > 0);
    if (hostRows.length > 1) {
      const totalImpr = hostRows.reduce((n, h) => n + h.impressions, 0) || 1;
      const rows = hostRows.map((h, i) => `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#F8FAFB'};">
        <td style="padding:6px 12px;font-size:12px;color:${h.key === 'www' ? '#0F2847' : '#B7791F'};font-family:monospace;">${h.label}${h.key === 'www' ? '' : ' <span style="font-family:inherit;">(legacy)</span>'}</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${Math.round((h.impressions / totalImpr) * 100)}%</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${h.impressions} impr</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${h.clicks} clicks</td>
        <td style="padding:6px 12px;text-align:right;font-size:14px;font-weight:700;color:#0F2847;">pos ${fmtPos(h.position)}</td>
      </tr>`).join('');
      const legacyShare = Math.round(
        (hostRows.filter(h => h.key !== 'www').reduce((n, h) => n + h.impressions, 0) / totalImpr) * 100
      );
      hostBlock = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">Which host Google is showing (all 308-redirect to www)</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:6px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">${rows}</table>
      <p style="font-size:11px;color:#8B9BAE;margin:0 0 20px;">${legacyShare}% of impressions still land on a pre-cutover URL. Until that reaches 0, the site-wide average position above is a blend of hosts and should not be read as one number.</p>`;
    }

    // ── What the traffic is actually made of ────────────────────────────────
    // Every query row, bucketed. This replaces guessing at the tail from a
    // click-sorted top-25, which is how a claim that 93% of impressions were
    // address lookups got made without the tail ever being measured.
    let mixBlock = '';
    const mix = (snapshot.queryMix || []).filter(b => b.impressions > 0);
    if (mix.length) {
      const totalImpr = mix.reduce((n, b) => n + b.impressions, 0) || 1;
      const rows = mix.sort((a, b) => b.impressions - a.impressions).map((b, i) => `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#F8FAFB'};">
        <td style="padding:6px 12px;font-size:12px;color:${b.key === 'commercial' ? '#0F2847' : '#556070'};font-weight:${b.key === 'commercial' ? 700 : 400};">${b.label}</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${b.queries} queries</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${Math.round((b.impressions / totalImpr) * 100)}%</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;color:#556070;">${b.impressions} impr</td>
        <td style="padding:6px 12px;text-align:right;font-size:12px;font-weight:700;color:#0F2847;">${b.clicks} clicks</td>
      </tr>`).join('');
      mixBlock = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">What the search traffic is made of (all ${mix.reduce((n, b) => n + b.queries, 0)} queries, not a top-25 sample)</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">${rows}</table>`;
    }

    // ── Which host serves which query ───────────────────────────────────────
    // The answer to "does the old URL actually outrank the new one, or do they
    // just serve different queries" — unanswerable until page×query existed.
    let splitBlock = '';
    const split = (snapshot.hostQueries || []).filter(e => Object.keys(e.hosts).length > 1).slice(0, 8);
    if (split.length) {
      const rows = split.map((e, i) => {
        const cells = HOST_BUCKETS.map(h => {
          const v = e.hosts[h.key];
          return `<td style="padding:5px 10px;text-align:right;font-size:12px;color:${v ? (v.position <= 10 ? '#1E9E6A' : '#556070') : '#C9D2DC'};">${v ? `${fmtPos(v.position)} <span style="color:#8B9BAE;">(${v.impressions})</span>` : '—'}</td>`;
        }).join('');
        return `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#F8FAFB'};">
          <td style="padding:5px 10px;font-size:12px;color:#556070;">${e.query.replace(/[<>&]/g, '')}</td>${cells}</tr>`;
      }).join('');
      splitBlock = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">Same query, different host — position (impressions)</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:6px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
        <tr style="background:#F4F7FA;">
          <th style="padding:8px 10px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Query</th>
          ${HOST_BUCKETS.map(h => `<th style="padding:8px 10px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">${h.key}</th>`).join('')}
        </tr>${rows}
      </table>
      <p style="font-size:11px;color:#8B9BAE;margin:0 0 20px;">These queries are served under more than one host at once. Where a legacy host ranks better than www on the SAME query, the old URL is holding the position — that is a consolidation problem, not a content problem.</p>`;
    }

    gscSection = `
    <!-- Search Console rankings -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🔍 Google rankings (last 28 days)</h3>
    <div style="background:${onPage1 ? '#ECFDF5' : '#EBF3FD'};border:1px solid ${onPage1 ? '#6EE7B7' : '#BFDBFE'};border-radius:8px;padding:14px 16px;margin-bottom:12px;">
      <p style="margin:0;font-size:12px;color:#556070;">"bronx property management"</p>
      <p style="margin:2px 0 0;font-size:28px;font-weight:700;color:#0F2847;">${fmtPos(moneyPos)} ${delta(moneyPos, prevPos('bronx property management'))}</p>
      <p style="margin:4px 0 0;font-size:12px;color:#556070;">${onPage1 ? 'On page 1.' : 'Page 1 starts at position 10.'} ${commercialLine}</p>
    </div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:14px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#F4F7FA;">
        <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Query</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Pos</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Change</th>
        <th style="padding:8px 12px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Impr</th>
        <th style="padding:8px 12px;text-align:right;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Clicks</th>
      </tr>
      ${watchRows}
    </table>
    ${trendBlock}
    ${mixBlock}
    ${splitBlock}
    ${hostBlock}
    ${areaBlock}`;
  } else if (gsc?.error && !FATAL_CREDENTIAL_KINDS.has(gsc.error.kind)) {
    // Only the genuine "you haven't granted access yet" case gets the
    // add-a-user instructions. A dead credential is covered by the banner above
    // — repeating the setup steps there would send the owner to the wrong screen.
    const rankingsWereWorking = readRankHistory().length > 0;
    gscSection = `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">🔍 ${rankingsWereWorking ? 'Search Console access lost' : 'Search Console not connected yet — 2 minutes to fix'}</p>
      ${rankingsWereWorking ? '<p style="margin:6px 0 0;color:#92400E;font-size:12px;">Rankings were being collected until now, so the grant was in place and something changed. Check both halves:</p>' : '<p style="margin:6px 0 0;color:#92400E;font-size:12px;">Open Search Console → the <strong>doryangel.com</strong> Domain property → Settings → Users and permissions → Add user → paste:</p>'}
      <p style="margin:6px 0 0;color:#92400E;font-size:12px;font-family:monospace;word-break:break-all;">${gsc.error.clientEmail || sa?.client_email || 'the service account address in GOOGLE_SA_KEY'}</p>
      <p style="margin:6px 0 0;color:#92400E;font-size:12px;">Permission level <strong>Restricted</strong> is enough. The "Google Search Console API" must also be enabled in the same Google Cloud project — missing either half produces this same error.</p>
      <p style="margin:6px 0 0;color:#92400E;font-size:12px;font-family:monospace;word-break:break-all;">${gsc.error.message}</p>
    </div>`;
  }

  // ── Clarity behavioral section ────────────────────────────────────────────────
  let claritySection = '';
  if (clarity) {
    const devLine = clarity.devices.map(d => `${d.name} ${d.sessions}`).join(' · ') || '—';
    const pageRows = clarity.topPages.map((p, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
      const label = p.url.length > 46 ? p.url.slice(0, 46) + '…' : p.url;
      return `<tr style="background:${bg};">
        <td style="padding:5px 12px;color:#556070;font-size:12px;font-family:monospace;">${label}</td>
        <td style="padding:5px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;">${p.visits}</td>
      </tr>`;
    }).join('');
    const frictionCell = (lbl, m) => {
      const color = m.pctSessions >= 20 ? '#B91C1C' : m.pctSessions >= 5 ? '#B7791F' : '#0F2847';
      return `<td style="padding:10px 6px;text-align:center;border-right:1px solid #E2E8F0;">
        <div style="font-size:18px;font-weight:700;color:${color};">${m.pctSessions}%</div>
        <div style="font-size:10px;color:#8B9BAE;text-transform:uppercase;">${lbl}</div>
      </td>`;
    };
    claritySection = `
    <!-- Clarity behavior -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🖱 User behavior (Clarity, last ${clarity.windowDays}d)</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:6px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#ffffff;">
        <td style="padding:12px;text-align:center;width:33%;border-right:1px solid #E2E8F0;">
          <div style="font-size:22px;font-weight:700;color:#0F2847;">${clarity.sessions}</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Sessions</div>
        </td>
        <td style="padding:12px;text-align:center;width:33%;border-right:1px solid #E2E8F0;">
          <div style="font-size:22px;font-weight:700;color:#0F2847;">${clarity.users}</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Users</div>
        </td>
        <td style="padding:12px;text-align:center;width:34%;">
          <div style="font-size:22px;font-weight:700;color:#1E5AA8;">${clarity.avgScrollDepth ?? '—'}%</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Avg scroll</div>
        </td>
      </tr>
    </table>
    <p style="font-size:11px;color:#8B9BAE;margin:0 0 8px;">Friction — % of sessions affected (lower is better)</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#ffffff;">
        ${frictionCell('Dead clicks', clarity.deadClicks)}
        ${frictionCell('Rage clicks', clarity.rageClicks)}
        ${frictionCell('Quickbacks', clarity.quickbacks)}
        <td style="padding:10px 6px;text-align:center;">
          <div style="font-size:18px;font-weight:700;color:${clarity.scriptErrors.pctSessions >= 5 ? '#B91C1C' : '#0F2847'};">${clarity.scriptErrors.pctSessions}%</div>
          <div style="font-size:10px;color:#8B9BAE;text-transform:uppercase;">Script errors</div>
        </td>
      </tr>
    </table>
    <p style="font-size:11px;color:#8B9BAE;margin:0 0 8px;">Top pages · devices: ${devLine}</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      ${pageRows}
    </table>
    <p style="font-size:11px;color:#8B9BAE;margin:-12px 0 24px;font-style:italic;">Consent-gated — captures only cookie-accepters, so it undercounts. Directional behavior, not volume.</p>`;
  } else {
    claritySection = `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">🔌 Clarity not connected</p>
      <p style="margin:4px 0 0;color:#92400E;font-size:12px;">Add a <code>CLARITY_API_TOKEN</code> GitHub secret (Clarity → Settings → Data export) to feed user-behavior signals into Arlo.</p>
    </div>`;
  }

  // ── Make.com Hailey leads section ─────────────────────────────────────────────
  let makeSection = '';
  if (make?.sources && !make.error) {
    const sourceRows = make.sources.map((s, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
      const errMsg   = s.error === '403' ? 'share sheet with service account' : s.error;
      const errBadge = s.error ? ` <span style="color:#B91C1C;font-size:10px;">(${errMsg})</span>` : '';
      return `<tr style="background:${bg};">
        <td style="padding:8px 12px;color:#556070;font-size:12px;">${s.label}${errBadge}</td>
        <td style="padding:8px 12px;text-align:center;color:#0F2847;font-size:12px;font-weight:600;">${s.day}</td>
        <td style="padding:8px 12px;text-align:center;color:#0F2847;font-size:12px;font-weight:600;">${s.week}</td>
        <td style="padding:8px 12px;text-align:center;color:#0F2847;font-size:12px;font-weight:600;">${s.month}</td>
        <td style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;">${s.total} total</td>
      </tr>`;
    }).join('');

    makeSection = `
    <!-- All lead sources -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">📞 Leads — all channels</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#F4F7FA;">
        <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:30%;">Source</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:14%;">Today</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:14%;">7 days</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:14%;">30 days</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:16%;">All time</th>
      </tr>
      ${sourceRows}
      <tr style="background:#EBF3FD;">
        <td style="padding:10px 12px;color:#0F2847;font-size:13px;font-weight:700;">Total</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;color:#0F2847;font-size:15px;">${make.totals.day}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;color:#0F2847;font-size:15px;">${make.totals.week}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;color:#0F2847;font-size:15px;">${make.totals.month}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;color:#0D7B4E;font-size:18px;">${make.totals.total}</td>
      </tr>
    </table>
    <p style="font-size:11px;color:#8B9BAE;margin:0 0 24px;">Sources: Google Sheets via Retell voice + Hailey chat agents</p>`;

    // Hailey success-rate panel
    const hailey = make.sources.find(s => s.chat);
    if (hailey && hailey.chat) {
      const h = hailey.chat;
      const rateColor = h.successRate >= 40 ? '#0D7B4E' : h.successRate >= 20 ? '#B7791F' : '#B91C1C';
      makeSection += `
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🤖 Hailey chat success rate</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:6px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#ffffff;">
        <td style="padding:12px;text-align:center;width:33%;border-right:1px solid #E2E8F0;">
          <div style="font-size:22px;font-weight:700;color:#0F2847;">${h.sessions}</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Chat sessions</div>
        </td>
        <td style="padding:12px;text-align:center;width:33%;border-right:1px solid #E2E8F0;">
          <div style="font-size:22px;font-weight:700;color:#0F2847;">${h.qualified}</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Qualified leads</div>
        </td>
        <td style="padding:12px;text-align:center;width:34%;">
          <div style="font-size:22px;font-weight:700;color:${rateColor};">${h.successRate}%</div>
          <div style="font-size:11px;color:#8B9BAE;text-transform:uppercase;">Success rate</div>
        </td>
      </tr>
    </table>
    <p style="font-size:11px;color:#8B9BAE;margin:0 0 24px;">A chat counts as a win when it captures a name + phone or email. (Make.com leaves <code>chat_successful</code> blank, so this is the reliable proxy.)</p>`;
    }
  } else if (make?.error) {
    // ⚠️ Deliberately NOT a table of zeros. Every sheet read failed, so the true
    // lead count is unknown — printing 0/0/0 here would look like a dead month.
    makeSection = fatal ? '' : `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">⚠️ Lead counts unknown today — not zero</p>
      <p style="margin:4px 0 0;color:#92400E;font-size:12px;">Every lead sheet failed to read, so no counts are shown rather than showing zeros. Leads themselves are unaffected — Make still writes every submission to the sheets.</p>
      <p style="margin:6px 0 0;color:#92400E;font-size:12px;font-family:monospace;word-break:break-all;">${make.error.message}</p>
      ${make.error.kind === 'access' ? `<p style="margin:6px 0 0;color:#92400E;font-size:12px;">Share each lead sheet with <code>${sa?.client_email || 'the service account'}</code> (Viewer is enough).</p>` : ''}
    </div>`;
  } else {
    makeSection = `
    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
      <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">🔌 Lead stats not available</p>
      <p style="margin:4px 0 0;color:#92400E;font-size:12px;">Set <code>GOOGLE_SA_KEY</code> and share the 3 lead sheets with the service account to enable this.</p>
    </div>`;
  }

  // ⚠️ The Resend SDK does NOT throw on an API error — it resolves with
  // { data: null, error: {...} }. Ignoring the return value and logging
  // "Digest sent" is the exact silent-success bug that hid Vera's Facebook
  // failures for over a month on a green checkmark. Inspect the result.
  const { data, error } = await resend.emails.send({
    from: `${AGENT_NAME} by DoryAngel <onboarding@resend.dev>`,
    to: NOTIFY_EMAIL,
    subject: `🔧 ${AGENT_NAME} — ${taskLabel}`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1A2740;">

  <!-- Header -->
  <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;font-size:18px;margin:0;">🔧 ${AGENT_NAME} — Daily Website Audit</h1>
    <p style="color:rgba(255,255,255,0.65);font-size:13px;margin:5px 0 0;">${today()} — automated improvement loop</p>
  </div>

  <div style="padding:20px 24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">

    <!-- Shared Google credential outage (only when the one key behind GA4 +
         Search Console + the lead sheets is what broke) -->
    ${credentialBanner}

    <!-- Today's task -->
    <h2 style="font-size:15px;color:#0F2847;margin:0 0 5px;">Today: ${taskLabel}</h2>
    <p style="color:#556070;font-size:13px;margin:0 0 14px;">${taskWhy}</p>
    <div style="background:${resultColor};border:1px solid ${resultBorder};border-radius:8px;padding:12px 16px;margin-bottom:28px;">
      <p style="margin:0 0 4px;color:${resultTextColor};font-weight:700;font-size:13px;">${resultIcon}</p>
      <a href="${resultLink}" style="color:#1E5AA8;font-size:12px;word-break:break-all;">${resultLink}</a>
    </div>

    <!-- Activity stats: Day / Week / Month -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">📊 Activity</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      <tr style="background:#F4F7FA;">
        <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:34%;">Metric</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">Today</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">7 days</th>
        <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;width:22%;">30 days</th>
      </tr>
      ${statRow('Blog posts published', stats.posts, '#0F2847', '#ffffff')}
      ${statRow('Site commits', stats.commits, '#1E5AA8', '#F8FAFB')}
      <tr style="background:#ffffff;">
        <td style="padding:10px 12px;color:#556070;font-size:13px;">Total posts (all time)</td>
        <td colspan="3" style="padding:10px 12px;text-align:center;font-weight:700;color:#0F2847;font-size:20px;">${postCount}</td>
      </tr>
    </table>

    <!-- Category bar chart -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">📂 Blog categories</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
      ${catBars}
    </table>

    <!-- Search Console rankings -->
    ${gscSection}

    <!-- GA4 traffic -->
    ${ga4Section}

    <!-- Clarity user behavior -->
    ${claritySection}

    <!-- Make.com Hailey leads -->
    ${makeSection}

    <!-- Recent posts -->
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🗒 Latest posts</h3>
    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;font-size:12px;">
      ${recentRows}
    </table>

    <!-- Footer -->
    <p style="margin:28px 0 0;font-size:11px;color:#8B9BAE;text-align:center;">
      ${AGENT_NAME} runs every day at 9 AM EST<br>
      <a href="https://github.com/${REPO}/pulls" style="color:#8B9BAE;">Open PRs</a> ·
      <a href="https://github.com/${REPO}/issues" style="color:#8B9BAE;">Open issues</a>
    </p>
  </div>
</div>`,
  });

  if (error) {
    // The most likely cause: `onboarding@resend.dev` is Resend's SANDBOX
    // sender, which may only deliver to the address that owns the Resend
    // account. If the account is not registered to NOTIFY_EMAIL, every send is
    // rejected and, before this check existed, the run still logged success.
    // Verifying doryangel.com in Resend removes the restriction for good.
    console.log(`::error title=${AGENT_NAME}::Daily digest was NOT delivered to ${NOTIFY_EMAIL} — Resend rejected it: ${error.message || JSON.stringify(error)}. If this mentions a testing/sandbox restriction, the sender onboarding@resend.dev can only reach the address that owns the Resend account; verify doryangel.com in Resend, or send to the account owner's address.`);
    return false;
  }
  if (!data?.id) {
    console.log(`::error title=${AGENT_NAME}::Resend returned no message id — treating the digest as NOT delivered. Response: ${JSON.stringify(data)}`);
    return false;
  }
  return data.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[daily-audit] ${today()}`);

  const state = readState();
  console.log(`Posts: ${state.postCount} | Categories: ${JSON.stringify(state.categoryCounts)}`);
  console.log(`Checks: ${JSON.stringify(state.checks)}`);

  // Pull live analytics up front so Arlo's idea generator can learn from real
  // user behavior (GA4 traffic + Clarity friction signals), not just guess.
  const [ga4, make, clarity, gsc] = await Promise.all([
    getGA4Stats(), getMakeStats(), getClarityStats(), getSearchConsoleStats(),
  ]);
  console.log(`GA4: ${ga4?.sessions ? `sessions today=${ga4.sessions.day}` : ga4?.error ? `FAILED (${ga4.error.kind})` : 'not configured'}`);
  console.log(`Leads: ${make?.error ? `UNKNOWN — sheet reads failed (${make.error.kind})` : make ? `total=${make.totals.total}, 30d=${make.totals.month}` : 'not configured'}`);
  console.log(`Clarity: ${clarity ? `${clarity.sessions} sessions/3d, scroll ${clarity.avgScrollDepth}%` : 'not configured'}`);

  // One loud line when the shared credential is the cause. Three data sources
  // failing on a green checkmark is the same silent-success class that hid
  // Vera's skipped Facebook posts for a month — it should be impossible to miss
  // in the Actions log, not just in the email.
  const fatalCredential = [ga4?.error, gsc?.error, make?.error]
    .filter(Boolean).find(e => FATAL_CREDENTIAL_KINDS.has(e.kind));
  if (fatalCredential) {
    const acct = readServiceAccount();
    const downNames = [
      ga4?.error && 'GA4',
      gsc?.error && 'Search Console',
      make?.error && 'the lead sheets',
    ].filter(Boolean);
    // Name only what actually failed. During a project restore the services
    // recover at different rates, and asserting "all three are down" while two
    // of them are printing real numbers two lines above is exactly the kind of
    // wrong-but-confident report this whole change set exists to stop.
    const scope = downNames.length === 3
      ? 'GA4, Search Console and the lead sheets are ALL down until it is fixed'
      : `${downNames.join(' and ')} ${downNames.length > 1 ? 'are' : 'is'} down (the other Google sources read fine this run — if the project was just restored, this is a stale cache and should clear within the hour)`;
    console.log(`::error title=${AGENT_NAME}::GOOGLE_SA_KEY failure (${fatalCredential.kind}) — ${scope}. Account: ${acct?.client_email || 'unknown'}${acct?.project_id ? `, project ${acct.project_id}` : ''}. Google says: ${fatalCredential.message}`);
  }

  if (make?.sources) {
    const h = make.sources.find(s => s.chat);
    if (h && h.chat) console.log(`Hailey: ${h.chat.qualified}/${h.chat.sessions} sessions = ${h.chat.successRate}% success rate`);
  }

  // Find the first pending auto-task
  const pendingTask = AUTO_TASKS.find(t => t.isNeeded(state));

  let taskLabel, taskWhy, resultType, resultLink;

  if (pendingTask) {
    console.log(`Auto-task: ${pendingTask.id}`);
    const updatedHtml = pendingTask.apply(state.html);

    if (updatedHtml && updatedHtml !== state.html) {
      writeFileSync('./index.html', updatedHtml);
      console.log(`Applied: ${pendingTask.id}`);
    } else {
      console.warn(`apply() returned unchanged HTML for ${pendingTask.id} — skipping commit`);
    }

    // Signal the workflow: there are file changes to commit + PR
    writeFileSync('/tmp/audit-changed.txt', 'true');
    writeFileSync('/tmp/audit-task.txt', pendingTask.label);

    taskLabel = pendingTask.label;
    taskWhy = pendingTask.why;
    resultType = 'code';
    resultLink = `https://github.com/${REPO}/pulls`;

  } else {
    console.log('All auto-tasks done — generating GitHub Issue idea via Claude');

    const openIssues = await getOpenIssues();
    console.log(`Open issues: ${openIssues.length}`);

    const idea = await generateIssueIdea(state, openIssues, ga4, clarity);
    console.log(`Idea: ${idea.title}`);

    // Hard dedupe gate — if the idea duplicates an open issue, do NOT file it.
    const dupOf = await findDuplicateOpenIssue(idea, openIssues);
    if (dupOf) {
      console.log(`Dedupe gate: idea duplicates existing issue "${dupOf}" — not filing a new one.`);
      resultLink = `https://github.com/${REPO}/issues`;
      taskLabel = idea.title;
      taskWhy = `Deduped — overlaps the existing open issue "${dupOf}", so Arlo did not file a duplicate.`;
    } else {
      // Issue creation is best-effort — a failure here (e.g. bad token) must not
      // crash the run and block the daily digest email below.
      try {
        resultLink = await createGitHubIssue(idea.title, idea.body);
        console.log(`Issue created: ${resultLink}`);
      } catch (err) {
        console.warn(`Issue creation failed (${err.message}) — sending digest anyway`);
        resultLink = `https://github.com/${REPO}/issues`;
      }
      taskLabel = idea.title;
      taskWhy = idea.why_today;
    }

    writeFileSync('/tmp/audit-changed.txt', 'false');
    writeFileSync('/tmp/audit-task.txt', idea.title);
    resultType = 'issue';
  }

  // Report what actually happened. This line used to print unconditionally,
  // so a rejected email still read as "Digest sent" in the run log.
  const messageId = await sendDigest({ taskLabel, taskWhy, resultType, resultLink, state, ga4, make, clarity, gsc });
  console.log(messageId
    ? `Digest delivered to ${NOTIFY_EMAIL} (Resend id ${messageId})`
    : `Digest NOT delivered to ${NOTIFY_EMAIL} — see the error annotation above.`);
}

main().catch(err => {
  console.error('daily-audit error:', err.message);
  process.exit(1);
});
