// scripts/lib/__verify__/verify-lead-counts.js
//
// Proves Arlo's owner-lead count (scripts/lib/lead-counts.js) on the shape that
// produced the inflated number on 2026-11-09: one real owner row in 30 days,
// 15 other phone contacts filed under the same "owner" label, plus apartment
// inquiries and newsletter sign-ups added into one "Total". Offline, no secrets.
//   node scripts/lib/__verify__/verify-lead-counts.js

import { readFileSync } from 'fs';
import {
  KIND, isOwnerRole, isTestRow, countWindows, tallySheet, errorEntries, summariseByKind,
} from '../lead-counts.js';

let failures = 0, checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${label}`); }
}

const NOW = Date.parse('2026-11-09T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

// Rows are positional like the real sheets. Phone sheet: name col 4, time col 16.
const phoneRow = (name, d) => { const r = new Array(17).fill(''); r[4] = name; r[16] = daysAgo(d); return r; };
// Chat sheet: time col 0, role col 1, name col 2, phone col 3, email col 4.
const chatRow = (role, name, d, phone = '', email = '') => [daysAgo(d), role, name, phone, email];
// Simple sheets: name col 0, time col 3 (or 11).
const simpleRow = (name, d, tsCol = 3) => { const r = new Array(tsCol + 1).fill(''); r[0] = name; r[tsCol] = daysAgo(d); return r; };

const PHONE = {
  label: 'Phone calls', ownerLabel: 'Owners — phone', otherLabel: 'Phone — other',
  tsCol: 16, nameCol: 4,
  tabs: ['new owners', 'vendors', 'brokers', 'looking for rent', 'anything else'],
  ownerTabs: ['new owners'],
};
const CHAT = {
  label: 'Hailey', ownerLabel: 'Owners — chat', otherLabel: 'Chat — other',
  tsCol: 0, nameCol: 2, roleCol: 1, chat: true, phoneCol: 3, emailCol: 4,
};
const APTS = { label: 'Apartment inquiries', kind: KIND.OTHER, tsCol: 11, nameCol: 0 };
const NEWS = { label: 'Newsletter', kind: KIND.SUBSCRIBER, tsCol: 3, nameCol: 0 };

// ── Roles ──
check('"new owner" is an owner', isOwnerRole('new owner'));
check('"Owner" is an owner', isOwnerRole('Owner'));
check('leaked punctuation still reads as owner', isOwnerRole("new owner'}"));
check('broker is not an owner', !isOwnerRole('broker'));
check('vendor is not an owner', !isOwnerRole('vendor'));
check("\"other'}\" is not an owner", !isOwnerRole("other'}"));
check('"non-owner" is not an owner', !isOwnerRole('non-owner'));
check('"not an owner" is not an owner', !isOwnerRole('not an owner'));
check('blank role is not an owner', !isOwnerRole(''));
check('"TEST lead source check" is a test row', isTestRow('TEST lead source check - ignore'));
check('"Testa" is a real name, not a test', !isTestRow('Maria Testa'));

// ── The 2026-11-09 shape: 1 owner row + 15 other phone rows in 30 days ──
const tabRows = {
  'new owners': [phoneRow('Real Owner', 8), phoneRow('Old Owner', 200), phoneRow('TEST lead source check - ignore', 9)],
  'vendors': [phoneRow('V1', 2), phoneRow('V2', 5), phoneRow('V3', 12), phoneRow('V4', 20)],
  'brokers': [phoneRow('B1', 3), phoneRow('B2', 15), phoneRow('B3', 25)],
  'looking for rent': [phoneRow('R1', 1.5), phoneRow('R2', 4), phoneRow('R3', 6), phoneRow('R4', 10), phoneRow('R5', 18)],
  'anything else': [phoneRow('X1', 0.5), phoneRow('X2', 22), phoneRow('X3', 29), phoneRow('', 3)],
};
const phone = tallySheet(PHONE, tabRows, NOW);
const phoneOwner = phone.find(e => e.kind === KIND.OWNER);
const phoneOther = phone.find(e => e.kind === KIND.OTHER);
check('phone sheet splits into two entries', phone.length === 2);
check('owner count over 30 days is 1 (the old code said 16)', phoneOwner.month === 1);
check('owner all-time skips the test row', phoneOwner.total === 2);
check('other phone contacts are 15 in 30 days', phoneOther.month === 15);
check('a row with no name is not counted', phoneOther.total === 15);
check('7-day window', phoneOther.week === 7);
check('today window', phoneOther.day === 1);

// ── Web chat ──
const chatRows = [
  chatRow('new owner', 'Chat Owner', 3, '7185550100'),
  chatRow("new owner'}", 'Chat Owner Two', 40, '', 'a@b.co'),
  chatRow('broker', 'Chat Broker', 2, '7185550101'),
  chatRow("other'}", '', 1),
  chatRow('other', 'Someone', 5),
  ['', '2026-05-06T13:19:33.556Z'], // a malformed row the real sheet holds
];
const chat = tallySheet(CHAT, { Sheet1: chatRows }, NOW);
const chatOwner = chat.find(e => e.kind === KIND.OWNER);
const chatOther = chat.find(e => e.kind === KIND.OTHER);
check('chat owner 30d = 1', chatOwner.month === 1);
check('chat owner all-time = 2', chatOwner.total === 2);
check('chat other 30d = 2 (broker + named other)', chatOther.month === 2);
check('chat success stats travel with the owner chat entry', chatOwner.chat && chatOwner.chat.sessions === 5);
check('chat qualified = name + phone or email', chatOwner.chat.qualified === 3);
check('chat success rate', chatOwner.chat.successRate === 60);

// ── Apartment inquiries and newsletter ──
const apts = tallySheet(APTS, { Sheet1: [simpleRow('Renter', 2, 11), simpleRow('Renter2', 50, 11)] }, NOW);
const news = tallySheet(NEWS, { Sheet1: [simpleRow('Reader', 1), simpleRow('Reader2', 3)] }, NOW);
check('apartment inquiries are "other"', apts[0].kind === KIND.OTHER && apts[0].month === 1);
check('newsletter is "subscriber"', news[0].kind === KIND.SUBSCRIBER && news[0].month === 2);

// ── Totals by kind: never one grand total ──
const all = [...phone, ...chat, ...apts, ...news];
const byKind = summariseByKind(all);
check('owner leads 30d = 2 (phone 1 + chat 1)', byKind.owner.month === 2);
check('other inquiries 30d = 18 (phone 15 + chat 2 + apartments 1)', byKind.other.month === 18);
check('subscribers 30d = 2', byKind.subscriber.month === 2);
check('nothing is partial when every sheet read', !byKind.owner.partial && !byKind.other.partial);
check('no grand total key exists', !('all' in byKind) && !('total' in byKind));

// ── A failed owner source marks the owner number partial, not zero-and-fine ──
const failedPhone = errorEntries(PHONE, '403 on tab "new owners"');
const withFailure = summariseByKind([...failedPhone, ...chat, ...apts, ...news]);
check('failed phone sheet still reports both labels', failedPhone.length === 2 && failedPhone.every(e => e.error));
check('owner total is marked partial when the phone sheet failed', withFailure.owner.partial === true);
check('subscribers are not marked partial by a phone failure', withFailure.subscriber.partial === false);

// ── Counts only: no personal value leaves the module ──
const keys = new Set(all.flatMap(e => Object.keys(e)));
check('entries carry counts and labels only', [...keys].every(k => ['label', 'kind', 'day', 'week', 'month', 'total', 'chat', 'error'].includes(k)));
check('no contact name appears in any entry', !JSON.stringify(all).includes('Real Owner'));

// ── Wiring in daily-audit.js ──
const audit = readFileSync('./scripts/daily-audit.js', 'utf8');
const leadSrc = audit.slice(audit.indexOf('const LEAD_SHEETS'), audit.indexOf('async function getClarityStats'));
check('the phone sheet names only "new owners" as an owner tab', /ownerTabs:\s*\['new owners'\]/.test(leadSrc));
check('the chat sheet reads caller_role from column B', /roleCol:\s*1\b/.test(leadSrc));
check('apartment inquiries are tagged other', /Apartment inquiries[\s\S]{0,80}kind:\s*KIND\.OTHER/.test(leadSrc));
check('both subscriber sheets are tagged subscriber', (leadSrc.match(/kind:\s*KIND\.SUBSCRIBER/g) || []).length === 2);
check('getMakeStats no longer builds a grand total', !/const totals = results\.reduce/.test(leadSrc));
check('the email no longer prints a mixed "Total" row', !/make\.totals/.test(audit));
check('the email leads with owner leads', /🏠 Owner leads/.test(audit));

console.log(`verify-lead-counts: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
