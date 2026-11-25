// Offline check for the broker-email campaign line in Arlo's daily email.
// Stubs Google (token + GA4) and Resend; proves the request, the sums and the
// rendered line. It cannot prove GA4 accepts the field names: check the first
// real run's log for "Broker campaign (GA4):" and no matching ::warning::.
import { generateKeyPairSync } from 'crypto';

let checks = 0, failures = 0;
const check = (name, ok) => { checks++; if (!ok) { failures++; console.log(`FAIL: ${name}`); } };

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.env.GOOGLE_SA_KEY = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey });
process.env.GA4_PROPERTY_ID = '123';
process.env.RESEND_API_KEY = 're_test';

const row = (dims, mets) => ({ dimensionValues: dims.map(value => ({ value })), metricValues: mets.map(v => ({ value: String(v) })) });
let campaignBody = null, campaignFails = false;
const sent = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const json = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 'stub-token', expires_in: 3600 });
  if (u.includes('resend')) { sent.push(JSON.parse(opts.body)); return json({ id: 'x' }); }
  if (u.includes(':runReport')) {
    const b = JSON.parse(opts.body);
    if (b.dimensionFilter?.filter?.fieldName === 'sessionCampaignName') {
      campaignBody = b;
      if (campaignFails) return new Response(JSON.stringify({ error: { code: 400, message: 'bad field' } }), { status: 400 });
      return json({ rows: [
        row(['/broker-partner.html', 'yesterday'], [2, 2, 3]),
        row(['/', 'yesterday'], [1, 1, 1]),
        row(['/broker-partner.html', 'since'], [3, 3, 4]),
        row(['/', 'since'], [1, 1, 2]),
      ] });
    }
    if (b.dimensions?.[0]?.name === 'pagePath') return json({ rows: [row(['/'], [10])] });
    return json({ rows: [row(['day'], [5, 4, 9]), row(['week'], [30, 25, 60]), row(['month'], [100, 80, 200])] });
  }
  return json({});
};

const m = await import('../../daily-audit.js');

const ga4 = await m.getGA4Stats();
check('GA4 main stats still come back', ga4?.sessions?.day === 5);
check('campaign filter is exact bronx-broker-pilot', campaignBody?.dimensionFilter.filter.stringFilter.value === 'bronx-broker-pilot' && campaignBody.dimensionFilter.filter.stringFilter.matchType === 'EXACT');
check('ranges are yesterday and since 2026-11-24', campaignBody?.dateRanges[0].startDate === 'yesterday' && campaignBody.dateRanges[1].startDate === '2026-11-24');
const bc = ga4?.brokerCampaign;
check('yesterday sums sessions across pages', bc?.yesterday.sessions === 3 && bc.yesterday.users === 3);
check('yesterday counts only broker-page views', bc?.yesterday.brokerPageViews === 3);
check('since-start sums', bc?.since.sessions === 4 && bc.since.brokerPageViews === 4);

const state = { stats: { posts: { day: 0, week: 0, month: 0, total: 1 }, commits: { day: 0, week: 0, month: 0 } }, categoryCounts: {}, postCount: 1, recentPosts: [] };
const base = { taskLabel: 't', taskWhy: 'w', resultLink: 'https://github.com/x', resultType: 'deduped', state, make: null, clarity: null, gsc: null, improvement: null };
await m.sendDigest({ ...base, ga4 });
const html = sent[0]?.html || '';
check('email shows the broker campaign line', html.includes('Broker emails (bronx-broker-pilot)'));
check('email shows yesterday and since numbers', /yesterday 3 sessions · 3 users · 3 broker-page views/.test(html) && /since 2026-11-24: 4 sessions · 4 users · 4 broker-page views/.test(html));

campaignFails = true;
const ga4b = await m.getGA4Stats();
check('a failed campaign call does not blank GA4', ga4b?.sessions?.day === 5 && ga4b.brokerCampaign?.error);
await m.sendDigest({ ...base, ga4: ga4b });
check('failed campaign call reads as unknown, not zero', /Broker emails[^<]*:<\/strong> unavailable today/.test(sent[1]?.html || ''));

console.log(`Broker campaign: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
