// scripts/traffic-compare.js
// Agent "Tally" — compares website traffic between the two DoryAngel sites and
// emails a learn-and-improve digest:
//   • beta.doryangel.com  → Google Analytics 4 (GA4 Data API)
//   • doryangel.com (old) → Wix Analytics Data API
// On top of the raw side-by-side numbers the digest adds three analysis sections:
//   1. Plain-language read   (Claude)
//   2. Marketing next steps  (Claude, grounded in the real top pages + category mix)
//   3. Performance compare   (Google PageSpeed Insights — public API)
//
// Tally is READ-ONLY: it never edits site content, opens PRs, or creates issues.
// It degrades gracefully — any source whose secret/credential is missing is shown
// as a "not connected" panel and the digest still sends. Modeled on agent Arlo
// (scripts/daily-audit.js); the GA4 helpers below are duplicated from Arlo on
// purpose so Tally stays standalone and doesn't trigger Arlo's module side effects.

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { readFileSync, writeFileSync } from 'fs';
import { createSign } from 'crypto';

const NOTIFY_EMAIL = 'dror75p@gmail.com';
const AGENT_NAME = 'Tally';
const BETA_URL = 'https://beta.doryangel.com/';
const OLD_URL = 'https://doryangel.com/';

// SDK clients are constructed only when their key exists — the Anthropic SDK
// throws at construction on a missing key, which would defeat graceful degradation.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 })
  : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgoISO(n) { return new Date(Date.now() - n * 86400000).toISOString().split('T')[0]; }

// ─── Google Analytics 4 (beta.doryangel.com) ─────────────────────────────────
// Duplicated from scripts/daily-audit.js (agent Arlo) — GA4 Data API is stable.

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

async function getGA4Stats() {
  const saKey      = process.env.GOOGLE_SA_KEY;
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!saKey || !propertyId) return null;

  try {
    const credentials = JSON.parse(saKey);
    const token = await getGoogleAccessToken(credentials);

    // sessions + users + pageviews across 7-day and 30-day ranges in one call
    const reportRes = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [
            { startDate: '7daysAgo',  endDate: 'today', name: 'week'  },
            { startDate: '30daysAgo', endDate: 'today', name: 'month' },
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

    const byRange = {};
    report.rows.forEach(row => {
      byRange[row.dimensionValues?.[0]?.value] = {
        sessions:  parseInt(row.metricValues[0].value) || 0,
        users:     parseInt(row.metricValues[1].value) || 0,
        pageviews: parseInt(row.metricValues[2].value) || 0,
      };
    });

    // top 5 pages by sessions (last 30 days)
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
      sessions:  { week: byRange['week']?.sessions  ?? 0, month: byRange['month']?.sessions  ?? 0 },
      users:     { week: byRange['week']?.users      ?? 0, month: byRange['month']?.users      ?? 0 },
      pageviews: { week: byRange['week']?.pageviews  ?? 0, month: byRange['month']?.pageviews  ?? 0 },
      topPages,
    };
  } catch (err) {
    console.warn(`GA4 fetch failed: ${err.message}`);
    return null;
  }
}

// ─── Wix Analytics (old doryangel.com) ───────────────────────────────────────
// Reads the Wix Analytics Data REST API with a Wix API key (WIX_API_KEY) scoped
// to the site (WIX_SITE_ID). NOTE: the exact endpoint/measurement-enum could not
// be confirmed against the Wix docs during build (the Wix MCP docs tool was behind
// an approval gate). Any error here → null → "Wix not connected" panel; verify the
// endpoint/shape below once WIX_API_KEY is provisioned, then re-run.
const WIX_MEASUREMENTS = ['TOTAL_SESSIONS', 'TOTAL_UNIQUE_VISITORS', 'TOTAL_PAGE_VIEWS'];

async function fetchWixRange(apiKey, siteId, startDate, endDate) {
  const res = await fetch('https://www.wixapis.com/analytics-data/v1/data/query', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,        // Wix REST API keys go in Authorization as-is (no "Bearer")
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dateRange: { startDate, endDate }, measurementTypes: WIX_MEASUREMENTS }),
  });
  if (!res.ok) throw new Error(`Wix ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();

  // Expected shape: { data: [ { type: 'TOTAL_SESSIONS', total: N, values: [...] }, ... ] }
  const byType = {};
  (json.data || []).forEach(d => {
    const total = (d.total ?? (d.values || []).reduce((a, v) => a + (v.value || 0), 0));
    byType[d.type] = Math.round(total) || 0;
  });
  return {
    sessions:  byType['TOTAL_SESSIONS'] ?? 0,
    users:     byType['TOTAL_UNIQUE_VISITORS'] ?? 0,
    pageviews: byType['TOTAL_PAGE_VIEWS'] ?? 0,
  };
}

async function getWixStats() {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) return null;

  try {
    const end = today();
    const [week, month] = await Promise.all([
      fetchWixRange(apiKey, siteId, daysAgoISO(7), end),
      fetchWixRange(apiKey, siteId, daysAgoISO(30), end),
    ]);
    return {
      sessions:  { week: week.sessions,  month: month.sessions  },
      users:     { week: week.users,     month: month.users     },
      pageviews: { week: week.pageviews, month: month.pageviews },
    };
  } catch (err) {
    console.warn(`Wix fetch failed: ${err.message}`);
    return null;
  }
}

// ─── Performance (Google PageSpeed Insights — public API) ─────────────────────

async function getPageSpeed(url) {
  try {
    const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key}`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`PSI ${res.status}`);
    const json = await res.json();
    const lh = json.lighthouseResult;
    if (!lh) throw new Error('no lighthouseResult');
    return {
      score: Math.round((lh.categories?.performance?.score ?? 0) * 100),
      lcp:   lh.audits?.['largest-contentful-paint']?.displayValue ?? 'n/a',
      cls:   lh.audits?.['cumulative-layout-shift']?.displayValue ?? 'n/a',
    };
  } catch (err) {
    console.warn(`PageSpeed failed for ${url}: ${err.message}`);
    return null;
  }
}

// ─── Blog category mix (grounds the marketing next-steps) ─────────────────────

function readBlogShape() {
  try {
    const posts = JSON.parse(readFileSync('./content/blog/posts-index.json', 'utf8'));
    const counts = {};
    posts.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
    return { total: posts.length, counts, recentTitles: posts.slice(0, 8).map(p => p.title) };
  } catch {
    return { total: 0, counts: {}, recentTitles: [] };
  }
}

// ─── Claude — plain-language read + marketing next steps ──────────────────────

async function generateInsights({ ga4, wix, betaPerf, oldPerf, blog }) {
  if (!anthropic) return null;

  const fmt = (s) => s ? `7d ${s.sessions.week} sessions / ${s.users.week} users / ${s.pageviews.week} views · 30d ${s.sessions.month} sessions / ${s.users.month} users / ${s.pageviews.month} views` : 'no data';
  const catSummary = Object.entries(blog.counts).map(([c, n]) => `${c}: ${n}`).join(', ') || 'none';
  const topPages = (ga4?.topPages || []).map(p => `${p.path} (${p.sessions})`).join('; ') || 'n/a';

  const prompt = `You are the growth analyst for DoryAngel LLC, a NYC flat-fee property management company targeting Bronx landlords. You are comparing traffic between the new site (beta.doryangel.com, the future of the brand) and the old site (doryangel.com, being retired).

DATA (last 7 and 30 days):
- NEW beta.doryangel.com (GA4): ${fmt(ga4)}
- OLD doryangel.com (Wix): ${fmt(wix)}
- New site top pages (30d, by sessions): ${topPages}
- Performance (mobile Lighthouse): beta score ${betaPerf?.score ?? 'n/a'} (LCP ${betaPerf?.lcp ?? 'n/a'}), old score ${oldPerf?.score ?? 'n/a'} (LCP ${oldPerf?.lcp ?? 'n/a'})
- Blog library: ${blog.total} posts — ${catSummary}
- Recent post titles: ${blog.recentTitles.join(' | ')}

DoryAngel's validated title formula (from real traffic): owner-targeted, problem-first titles that lead with the landlord's pain/cost, address them as "you/your", include a number/$/law, and anchor to the Bronx (an adjacent borough like Queens/Manhattan is OK when natural). Generic, geo-less marketing-speak titles get zero traffic.

Return ONLY valid JSON (no markdown):
{
  "read": "3-5 sentence plain-language read of the comparison: which site is winning, on which metric, the trend, and what stands out. Be concrete and reference the actual numbers.",
  "nextSteps": ["2-3 specific, data-driven marketing actions grounded in the top pages, category mix, and title formula above. Each item one sentence, actionable."]
}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON returned');
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.nextSteps)) parsed.nextSteps = parsed.nextSteps ? [String(parsed.nextSteps)] : [];
    return parsed;
  } catch (err) {
    console.warn(`Insights generation failed: ${err.message}`);
    return null;
  }
}

// ─── Email digest (Arlo visual style) ─────────────────────────────────────────

const NOT_CONNECTED = (title, body) => `
  <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px 16px;margin-bottom:24px;">
    <p style="margin:0;color:#92400E;font-size:12px;font-weight:700;">🔌 ${title}</p>
    <p style="margin:4px 0 0;color:#92400E;font-size:12px;">${body}</p>
  </div>`;

function num(v) { return (v === null || v === undefined) ? '—' : v.toLocaleString('en-US'); }

function comparisonTable(ga4, wix) {
  const row = (label, metric) => {
    const b = ga4 ? ga4[metric] : null;
    const o = wix ? wix[metric] : null;
    return `<tr>
      <td style="padding:10px 12px;color:#556070;font-size:13px;border-top:1px solid #EEF2F6;">${label}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:#1E5AA8;font-size:16px;border-top:1px solid #EEF2F6;">${num(b?.week)}</td>
      <td style="padding:10px 12px;text-align:center;color:#8B9BAE;font-size:16px;border-top:1px solid #EEF2F6;">${num(o?.week)}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:700;color:#1E5AA8;font-size:16px;border-top:1px solid #EEF2F6;">${num(b?.month)}</td>
      <td style="padding:10px 12px;text-align:center;color:#8B9BAE;font-size:16px;border-top:1px solid #EEF2F6;">${num(o?.month)}</td>
    </tr>`;
  };
  return `
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
    <tr style="background:#0F2847;">
      <th style="padding:8px 12px;text-align:left;color:#fff;font-size:11px;text-transform:uppercase;">Metric</th>
      <th style="padding:8px 12px;text-align:center;color:#9CC2F0;font-size:11px;text-transform:uppercase;">beta · 7d</th>
      <th style="padding:8px 12px;text-align:center;color:#B7C2D0;font-size:11px;text-transform:uppercase;">old · 7d</th>
      <th style="padding:8px 12px;text-align:center;color:#9CC2F0;font-size:11px;text-transform:uppercase;">beta · 30d</th>
      <th style="padding:8px 12px;text-align:center;color:#B7C2D0;font-size:11px;text-transform:uppercase;">old · 30d</th>
    </tr>
    ${row('Sessions', 'sessions')}
    ${row('Unique users', 'users')}
    ${row('Page views', 'pageviews')}
  </table>
  <p style="font-size:11px;color:#8B9BAE;margin:0 0 24px;">beta = beta.doryangel.com (GA4) · old = doryangel.com (Wix). GA4 and Wix count sessions/visitors slightly differently — read trends, not exact parity.</p>`;
}

function performanceTable(betaPerf, oldPerf) {
  const row = (label, p, accent) => `<tr>
    <td style="padding:9px 12px;color:#556070;font-size:13px;border-top:1px solid #EEF2F6;">${label}</td>
    <td style="padding:9px 12px;text-align:center;font-weight:700;color:${accent};font-size:16px;border-top:1px solid #EEF2F6;">${p ? p.score : '—'}</td>
    <td style="padding:9px 12px;text-align:center;color:#556070;font-size:12px;border-top:1px solid #EEF2F6;">${p ? p.lcp : '—'}</td>
    <td style="padding:9px 12px;text-align:center;color:#556070;font-size:12px;border-top:1px solid #EEF2F6;">${p ? p.cls : '—'}</td>
  </tr>`;
  return `
  <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">⚡ Performance (mobile Lighthouse)</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
    <tr style="background:#F4F7FA;">
      <th style="padding:8px 12px;text-align:left;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Site</th>
      <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;">Perf score</th>
      <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;">LCP</th>
      <th style="padding:8px 12px;text-align:center;color:#8B9BAE;font-size:11px;text-transform:uppercase;">CLS</th>
    </tr>
    ${row('beta.doryangel.com', betaPerf, '#1E5AA8')}
    ${row('doryangel.com (old)', oldPerf, '#8B9BAE')}
  </table>
  <p style="font-size:11px;color:#8B9BAE;margin:0 0 24px;">Score 0–100 (higher is better). Slow load is a common cause of lost traffic — watch this next to the numbers above.</p>`;
}

function topPagesTable(ga4) {
  if (!ga4 || !ga4.topPages?.length) return '';
  const max = Math.max(ga4.topPages[0]?.sessions || 1, 1);
  const rows = ga4.topPages.map((p, i) => {
    const pct = Math.round((p.sessions / max) * 100);
    const bg = i % 2 === 0 ? '#ffffff' : '#F8FAFB';
    const label = p.path.length > 42 ? p.path.slice(0, 42) + '…' : p.path;
    return `<tr style="background:${bg};">
      <td style="padding:5px 12px;color:#556070;font-size:12px;width:42%;font-family:monospace;">${label}</td>
      <td style="padding:5px 12px;width:46%;"><table style="width:100%;border-collapse:collapse;"><tr><td style="width:${pct}%;background:#5B9FEA;height:8px;border-radius:3px;"></td><td style="width:${100 - pct}%;"></td></tr></table></td>
      <td style="padding:5px 12px;text-align:right;font-weight:700;color:#0F2847;font-size:12px;width:12%;">${p.sessions}</td>
    </tr>`;
  }).join('');
  return `
  <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🔥 beta top pages (30d)</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">${rows}</table>`;
}

async function sendDigest({ ga4, wix, betaPerf, oldPerf, insights }) {
  if (!resend) { console.warn('RESEND_API_KEY missing — digest not emailed'); return; }

  const readBlock = insights?.read
    ? `<div style="background:#EBF3FD;border:1px solid #BBD4F2;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
         <p style="margin:0 0 4px;color:#0F2847;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">🗣 The read</p>
         <p style="margin:0;color:#1A2740;font-size:13px;line-height:1.5;">${insights.read}</p>
       </div>`
    : '';

  const stepsBlock = insights?.nextSteps?.length
    ? `<h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🎯 Marketing next steps</h3>
       <ol style="margin:0 0 24px;padding-left:20px;color:#1A2740;font-size:13px;line-height:1.6;">
         ${insights.nextSteps.map(s => `<li style="margin-bottom:6px;">${s}</li>`).join('')}
       </ol>`
    : '';

  const ga4Missing = !ga4 ? NOT_CONNECTED('GA4 not connected', 'Add <code>GA4_PROPERTY_ID</code> + <code>GOOGLE_SA_KEY</code> secrets (same ones Arlo uses) to populate the beta column.') : '';
  const wixMissing = !wix ? NOT_CONNECTED('Wix not connected', 'Add a <code>WIX_API_KEY</code> (Wix dashboard → API Keys, Analytics read) + <code>WIX_SITE_ID</code> secret to populate the old-site column.') : '';

  await resend.emails.send({
    from: `${AGENT_NAME} by DoryAngel <onboarding@resend.dev>`,
    to: NOTIFY_EMAIL,
    subject: `📊 ${AGENT_NAME} — Traffic compare (${today()})`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#1A2740;">
  <div style="background:#0F2847;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;font-size:18px;margin:0;">📊 ${AGENT_NAME} — Traffic Comparison</h1>
    <p style="color:rgba(255,255,255,0.65);font-size:13px;margin:5px 0 0;">${today()} — beta.doryangel.com vs doryangel.com (old)</p>
  </div>
  <div style="padding:20px 24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
    ${readBlock}
    <h3 style="font-size:13px;color:#0F2847;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;">🌐 Traffic — side by side</h3>
    ${comparisonTable(ga4, wix)}
    ${ga4Missing}
    ${wixMissing}
    ${performanceTable(betaPerf, oldPerf)}
    ${topPagesTable(ga4)}
    ${stepsBlock}
    <p style="margin:28px 0 0;font-size:11px;color:#8B9BAE;text-align:center;">
      ${AGENT_NAME} runs on demand · read-only, no site changes<br>
      <a href="https://github.com/dror75p-ops/Doryangel-web-3-carousel-blog/actions" style="color:#8B9BAE;">Actions</a>
    </p>
  </div>
</div>`,
  });
}

// ─── Results to logs + job summary ────────────────────────────────────────────

function printResults(payload) {
  const json = JSON.stringify(payload, null, 2);
  console.log('===TRAFFIC_JSON_START===');
  console.log(json);
  console.log('===TRAFFIC_JSON_END===');
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try { writeFileSync(summaryPath, `## Tally — Traffic compare (${today()})\n\n\`\`\`json\n${json}\n\`\`\`\n`, { flag: 'a' }); } catch {}
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[traffic-compare] ${today()}`);
  const blog = readBlogShape();

  const [ga4, wix] = await Promise.all([getGA4Stats(), getWixStats()]);
  const [betaPerf, oldPerf] = await Promise.all([getPageSpeed(BETA_URL), getPageSpeed(OLD_URL)]);
  console.log(`GA4: ${ga4 ? `30d sessions=${ga4.sessions.month}` : 'not configured'}`);
  console.log(`Wix: ${wix ? `30d sessions=${wix.sessions.month}` : 'not configured'}`);
  console.log(`Perf: beta=${betaPerf?.score ?? 'n/a'} old=${oldPerf?.score ?? 'n/a'}`);

  const insights = await generateInsights({ ga4, wix, betaPerf, oldPerf, blog });

  printResults({
    generatedAt: today(),
    beta: ga4,
    old: wix,
    performance: { beta: betaPerf, old: oldPerf },
    insights,
  });

  await sendDigest({ ga4, wix, betaPerf, oldPerf, insights });
  console.log('Done.');
}

main().catch(err => {
  console.error('traffic-compare error:', err.message);
  process.exit(1);
});
