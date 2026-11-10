// scripts/lib/lead-counts.js
//
// How Arlo counts leads, kept PURE (no network) so it can be tested offline.
// daily-audit.js reads the sheets and hands the rows to tallySheet().
//
// ⚠️ WHY THIS EXISTS. Measured 2026-11-09: the email showed 16 "Owner leads
// (voice)" in 30 days, but the "new owners" tab held ONE row. The old code read
// five tabs of the phone sheet (owners, vendors, brokers, renters, anything
// else) under one "owner" label, and its "Total" also added apartment
// inquiries and newsletter sign-ups. So the number the owner steers by was
// inflated about 16 times.
//
// The rule now:
//   - OWNER lead = a row in the phone sheet's "new owners" tab, or a web chat
//     whose caller_role says owner. Nothing else.
//   - OTHER inquiry = vendors, brokers, renters, apartment seekers, other chats.
//   - SUBSCRIBER = newsletter and tool sign-ups. Not a lead at all.
// The three are never added together. Joy's manual sheet stays the official
// record of real leads; this count is the early signal.
//
// ⚠️ Counts only. No name, email or phone value ever leaves this module.

export const KIND = Object.freeze({ OWNER: 'owner', OTHER: 'other', SUBSCRIBER: 'subscriber' });

export const KIND_LABEL = Object.freeze({
  owner: 'Owner leads',
  other: 'Other inquiries',
  subscriber: 'Subscribers (not leads)',
});

const MS_DAY = 86400000;

// "new owner", "Owner", "new owner'}" (the chat agent sometimes leaks JSON
// punctuation into the cell). "Non-owner" or "not an owner" must not match.
export function isOwnerRole(role) {
  const r = String(role || '').toLowerCase();
  if (/\b(non[- ]?owner|not (an |the )?owner)\b/.test(r)) return false;
  return /\bowner\b/.test(r);
}

// A row the owner or a developer typed to test the pipeline is not a lead.
export function isTestRow(name) {
  return /\btest\b/i.test(String(name || ''));
}

function timestampOf(row, tsCol) {
  const raw = row[tsCol];
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

/** Today / 7 days / 30 days / all time for rows that are real contacts. */
export function countWindows(rows, { tsCol, nameCol, now }) {
  const out = { day: 0, week: 0, month: 0, total: 0 };
  for (const r of rows) {
    const ts = timestampOf(r, tsCol);
    if (!ts || isNaN(ts)) continue;
    const name = r[nameCol];
    if (!name || isTestRow(name)) continue;
    out.total++;
    if (ts >= now - 30 * MS_DAY) out.month++;
    if (ts >= now - 7 * MS_DAY) out.week++;
    if (ts >= now - MS_DAY) out.day++;
  }
  return out;
}

/**
 * Splits one sheet's rows into report entries.
 * @param sheet   a LEAD_SHEETS entry from daily-audit.js
 * @param tabRows { [tabName]: rows[] } with header rows already removed
 * @param now     epoch ms
 * @returns entries: [{ label, kind, day, week, month, total, chat? }]
 */
export function tallySheet(sheet, tabRows, now) {
  const opts = { tsCol: sheet.tsCol, nameCol: sheet.nameCol, now };
  const tabs = Object.keys(tabRows);

  // Phone sheet: the tab decides the kind.
  if (sheet.ownerTabs) {
    const owner = tabs.filter(t => sheet.ownerTabs.includes(t)).flatMap(t => tabRows[t]);
    const other = tabs.filter(t => !sheet.ownerTabs.includes(t)).flatMap(t => tabRows[t]);
    return [
      { label: sheet.ownerLabel, kind: KIND.OWNER, ...countWindows(owner, opts) },
      { label: sheet.otherLabel, kind: KIND.OTHER, ...countWindows(other, opts) },
    ];
  }

  const rows = tabs.flatMap(t => tabRows[t]);

  // Web chat: the caller_role column decides the kind.
  if (sheet.roleCol !== undefined) {
    const owner = rows.filter(r => isOwnerRole(r[sheet.roleCol]));
    const other = rows.filter(r => !isOwnerRole(r[sheet.roleCol]));
    const ownerEntry = { label: sheet.ownerLabel, kind: KIND.OWNER, ...countWindows(owner, opts) };
    if (sheet.chat) ownerEntry.chat = chatSuccess(rows, sheet);
    return [ownerEntry, { label: sheet.otherLabel, kind: KIND.OTHER, ...countWindows(other, opts) }];
  }

  return [{ label: sheet.label, kind: sheet.kind, ...countWindows(rows, opts) }];
}

// Hailey: a chat "wins" when it captured a name AND a phone or email.
// `chat_successful` is unreliable (Make.com leaves it blank).
export function chatSuccess(rows, sheet) {
  const valid = rows.filter(r => { const ts = timestampOf(r, sheet.tsCol); return ts && !isNaN(ts); });
  const wins = valid.filter(r => !!r[sheet.nameCol] && !!(r[sheet.phoneCol] || r[sheet.emailCol])).length;
  return {
    sessions: valid.length,
    qualified: wins,
    successRate: valid.length ? Math.round((wins / valid.length) * 100) : 0,
  };
}

/** The labels a sheet reports under, used when the sheet fails to read. */
export function errorEntries(sheet, message) {
  const zero = { day: 0, week: 0, month: 0, total: 0, error: message };
  if (sheet.ownerTabs || sheet.roleCol !== undefined) {
    return [
      { label: sheet.ownerLabel, kind: KIND.OWNER, ...zero },
      { label: sheet.otherLabel, kind: KIND.OTHER, ...zero },
    ];
  }
  return [{ label: sheet.label, kind: sheet.kind, ...zero }];
}

/**
 * One total per kind. Never one grand total: adding subscribers and vendors to
 * owners is exactly the inflation this module exists to stop.
 * `partial` is true when a source of that kind failed to read.
 */
export function summariseByKind(entries) {
  const out = {};
  for (const kind of Object.values(KIND)) {
    const of = entries.filter(e => e.kind === kind);
    out[kind] = of.reduce(
      (acc, e) => ({
        day: acc.day + e.day, week: acc.week + e.week,
        month: acc.month + e.month, total: acc.total + e.total,
        partial: acc.partial || !!e.error,
      }),
      { day: 0, week: 0, month: 0, total: 0, partial: false },
    );
  }
  return out;
}
