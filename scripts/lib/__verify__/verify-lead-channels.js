// Offline check for lib/lead-channels.js (leads by channel and site in Arlo's email).
// It cannot prove GA4 accepts the field names: check the first real run's log for
// "Lead actions (GA4, last 7 days):" and no matching ::warning::.
import { LEAD_EVENTS, leadChannelsRequest, siteOf, channelOf, summariseLeadChannels, leadChannelsLine, leadChannelsTable, isWeeklyDay } from '../lead-channels.js';

let checks = 0, failures = 0;
const check = (name, ok) => { checks++; if (!ok) { failures++; console.log(`FAIL: ${name}`); } };
const row = (dims, n) => ({ dimensionValues: dims.map(value => ({ value })), metricValues: [{ value: String(n) }] });

const req = leadChannelsRequest();
check('request filters to the lead events', JSON.stringify(req.dimensionFilter.filter.inListFilter.values) === JSON.stringify(LEAD_EVENTS));
check('request has 3 named ranges', req.dateRanges.map(r => r.name).join() === 'yesterday,last7,prev7');
check('request splits by host', req.dimensions.some(d => d.name === 'hostName'));
check('the two 7-day windows do not touch', req.dateRanges[1].startDate === '7daysAgo' && req.dateRanges[2].endDate === '8daysAgo');

check('www is website', siteOf('www.doryangel.com') === 'website');
check('apex is website', siteOf('doryangel.com') === 'website');
check('chatgpt.site is ai-tools', siteOf('doryangel-compliance-check.dror75p.chatgpt.site') === 'ai-tools');
check('tools subdomain is ai-tools', siteOf('tools.doryangel.com') === 'ai-tools');
check('vercel preview is other', siteOf('x.vercel.app') === 'other');
check('campaign wins over source', channelOf('facebook', 'blog-autopost') === 'blog-autopost');
check('(organic) campaign falls back to source', channelOf('google', '(organic)') === 'google');
check('(direct) source reads direct', channelOf('(direct)', '(direct)') === 'direct');
check('gbp campaign kept', channelOf('google', 'gbp') === 'gbp');

const rows = [
  row(['phone_click', 'www.doryangel.com', 'google', 'gbp', 'yesterday'], 2),
  row(['generate_lead', 'www.doryangel.com', 'facebook', '(not set)', 'yesterday'], 1),
  row(['phone_click', 'www.doryangel.com', 'google', 'gbp', 'last7'], 5),
  row(['lead_capture', 'x.chatgpt.site', '(direct)', '(direct)', 'last7'], 3),
  row(['generate_lead', 'www.doryangel.com', 'facebook', '(not set)', 'prev7'], 4),
  row(['page_view', 'www.doryangel.com', 'google', 'gbp', 'last7'], 99),
  row(['phone_click', 'www.doryangel.com', 'google', 'gbp', 'bogus'], 7),
];
const lc = summariseLeadChannels(rows);
check('yesterday phone taps', lc.yesterday.byEvent.phone_click === 2);
check('non-lead events ignored', lc.last7.byEvent.phone_click === 5);
check('unknown range ignored', lc.yesterday.byEvent.phone_click === 2 && lc.last7.byEvent.phone_click === 5);
check('keyed by site and channel', lc.last7.byKey['website|gbp'].phone_click === 5);
check('ai tools kept apart', lc.last7.byKey['ai-tools|direct'].lead_capture === 3);
check('previous week kept', lc.prev7.byKey['website|facebook'].generate_lead === 4);

const line = leadChannelsLine(lc);
check('daily line when yesterday moved', line.includes('2 phone taps') && line.includes('1 forms') && line.includes('gbp (website)'));
const quiet = summariseLeadChannels([row(['phone_click', 'www.doryangel.com', 'google', 'gbp', 'last7'], 5)]);
check('no daily line on a quiet day', leadChannelsLine(quiet) === '');
check('no daily line on error', leadChannelsLine({ error: 'x' }) === '');

const table = leadChannelsTable(lc);
check('weekly table lists both sites', table.includes('website') && table.includes('ai-tools'));
check('weekly table shows prior week in brackets', table.includes('0 <span style="color:#8B9BAE;">(4)</span>'));
check('weekly table never totals', !/total/i.test(table.replace('never added up', '')));
check('weekly table on error says unknown', leadChannelsTable({ error: 'x' }).includes('Unknown, not zero'));
check('weekly table empty case', leadChannelsTable(summariseLeadChannels([])).includes('No lead actions'));
check('channel names escaped', leadChannelsTable(summariseLeadChannels([row(['phone_click', 'www.doryangel.com', '<b>', '(not set)', 'last7'], 1)])).includes('&lt;b&gt;'));

check('Sunday is the weekly day', isWeeklyDay(new Date('2026-11-29T14:00:00Z')) === true);
check('Wednesday is not', isWeeklyDay(new Date('2026-11-25T14:00:00Z')) === false);

console.log(`verify-lead-channels: ${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
