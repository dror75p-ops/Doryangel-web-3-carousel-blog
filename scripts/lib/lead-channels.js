// Leads by channel and site, from GA4 lead events (pure, no I/O).
//
// Owner asked 2026-11-25 to count every lead tap, by channel and by site
// (www.doryangel.com and the AI tools site, one GA4 property, two streams).
// Lead events: generate_lead (forms), phone_click, whatsapp_click, and from the
// AI tools site lead_capture + tool_complete.
//
// The email shows the full table once a week (Sunday UTC). Other days it adds
// ONE line, and only when yesterday had a lead event. No grand total adds forms
// to phone taps: a tap is not a lead until someone answers it.

export const LEAD_EVENTS = ['generate_lead', 'phone_click', 'whatsapp_click', 'lead_capture', 'tool_complete'];
const EVENT_LABEL = {
  generate_lead: 'forms', phone_click: 'phone taps', whatsapp_click: 'WhatsApp taps',
  lead_capture: 'tool sign-ups', tool_complete: 'tool reports',
};

// The GA4 runReport body: event × site × source × campaign over three ranges.
export function leadChannelsRequest() {
  return {
    dateRanges: [
      { startDate: 'yesterday',  endDate: 'yesterday', name: 'yesterday' },
      { startDate: '7daysAgo',   endDate: 'yesterday', name: 'last7' },
      { startDate: '14daysAgo',  endDate: '8daysAgo',  name: 'prev7' },
    ],
    dimensions: [{ name: 'eventName' }, { name: 'hostName' }, { name: 'sessionSource' }, { name: 'sessionCampaignName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: LEAD_EVENTS } } },
    limit: 500,
  };
}

export function siteOf(host) {
  const h = String(host || '').toLowerCase();
  if (!h || h === '(not set)') return 'unknown';
  if (h.includes('chatgpt.site') || h.startsWith('tools.') || h.includes('ai-tools')) return 'ai-tools';
  if (h.endsWith('doryangel.com')) return 'website';
  return 'other';
}

// Channel = campaign when the link carried one, else the source.
export function channelOf(source, campaign) {
  const c = String(campaign || '').trim();
  if (c && c !== '(not set)' && c !== '(direct)' && c !== '(organic)' && c !== '(referral)') return c.toLowerCase();
  const s = String(source || '').trim().toLowerCase();
  if (!s || s === '(not set)') return 'unknown';
  if (s === '(direct)') return 'direct';
  return s;
}

const blank = () => Object.fromEntries(LEAD_EVENTS.map(e => [e, 0]));

// rows → { yesterday, last7, prev7 } each { byEvent, byKey: { 'site|channel': byEvent } }
export function summariseLeadChannels(rows) {
  const out = {};
  for (const range of ['yesterday', 'last7', 'prev7']) out[range] = { byEvent: blank(), byKey: {} };
  for (const r of rows || []) {
    const d = (r.dimensionValues || []).map(x => x?.value);
    const [event, host, source, campaign, range] = d;
    const bucket = out[range];
    if (!bucket || !LEAD_EVENTS.includes(event)) continue;
    const n = parseInt(r.metricValues?.[0]?.value) || 0;
    const key = `${siteOf(host)}|${channelOf(source, campaign)}`;
    bucket.byEvent[event] += n;
    (bucket.byKey[key] ||= blank())[event] += n;
  }
  return out;
}

const anyLead = (byEvent) => LEAD_EVENTS.some(e => byEvent[e] > 0);
export const isWeeklyDay = (now = new Date()) => now.getUTCDay() === 0;

function describe(byEvent) {
  return LEAD_EVENTS.filter(e => byEvent[e] > 0).map(e => `${byEvent[e]} ${EVENT_LABEL[e]}`).join(' · ');
}
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Daily: one line, or '' when nothing moved yesterday.
export function leadChannelsLine(lc) {
  if (!lc || lc.error) return '';
  const y = lc.yesterday;
  if (!anyLead(y.byEvent)) return '';
  const where = Object.entries(y.byKey)
    .filter(([, ev]) => anyLead(ev))
    .sort((a, b) => sumOf(b[1]) - sumOf(a[1]))
    .slice(0, 4)
    .map(([k, ev]) => { const [site, ch] = k.split('|'); return `${esc(ch)} (${site}): ${describe(ev)}`; })
    .join('; ');
  return `<p style="font-size:12px;color:#0F2847;background:#EBF3FD;border:1px solid #C9DDF5;border-radius:6px;padding:8px 12px;margin:0 0 16px;"><strong>🎯 Lead actions yesterday:</strong> ${describe(y.byEvent)}<br><span style="color:#52637A;">${where}</span></p>`;
}
const sumOf = (ev) => LEAD_EVENTS.reduce((s, e) => s + (ev[e] || 0), 0);

// Weekly: a table of the last 7 days by site and channel, with the 7 before.
export function leadChannelsTable(lc) {
  if (!lc) return '';
  const head = `<p style="font-size:12px;color:#8B9BAE;margin:0 0 8px;">🎯 Lead actions by channel — last 7 days vs the 7 before (GA4)</p>`;
  if (lc.error) return head + `<p style="font-size:12px;color:#B45309;margin:0 0 16px;">Unavailable this week (GA4 call failed). Unknown, not zero.</p>`;
  const keys = new Set([...Object.keys(lc.last7.byKey), ...Object.keys(lc.prev7.byKey)]);
  const rows = [...keys]
    .map(k => ({ k, now: lc.last7.byKey[k] || blank(), before: lc.prev7.byKey[k] || blank() }))
    .filter(r => sumOf(r.now) || sumOf(r.before))
    .sort((a, b) => sumOf(b.now) - sumOf(a.now) || sumOf(b.before) - sumOf(a.before))
    .slice(0, 12);
  if (!rows.length) return head + `<p style="font-size:12px;color:#556070;margin:0 0 16px;">No lead actions in the last 14 days.</p>`;
  const cell = (v, p) => `${v}${p !== v ? ` <span style="color:#8B9BAE;">(${p})</span>` : ''}`;
  const th = (t) => `<th style="padding:6px 8px;text-align:center;color:#8B9BAE;font-size:10px;text-transform:uppercase;">${t}</th>`;
  const body = rows.map((r, i) => {
    const [site, ch] = r.k.split('|');
    const bg = i % 2 ? '#F8FAFB' : '#ffffff';
    return `<tr style="background:${bg};"><td style="padding:6px 8px;color:#0F2847;">${esc(ch)}</td><td style="padding:6px 8px;color:#556070;">${site}</td>` +
      ['generate_lead', 'phone_click', 'whatsapp_click', 'lead_capture'].map(e => `<td style="padding:6px 8px;text-align:center;">${cell(r.now[e], r.before[e])}</td>`).join('') + '</tr>';
  }).join('');
  return head + `<table style="border-collapse:collapse;width:100%;margin-bottom:6px;border:1px solid #E2E8F0;font-size:12px;">
      <tr style="background:#F4F7FA;">${th('Channel')}${th('Site')}${th('Forms')}${th('Phone')}${th('WhatsApp')}${th('Tool sign-ups')}</tr>${body}</table>
    <p style="font-size:11px;color:#8B9BAE;margin:0 0 16px;">(n) = the 7 days before. A tap is not a lead until someone answers it, so the columns are never added up. Channel is the UTM campaign when the link had one, otherwise the source.</p>`;
}
