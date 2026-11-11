// scripts/lib/report-hygiene.js
//
// Small, pure helpers that keep Arlo's daily email honest. Offline-testable by
// scripts/lib/__verify__/verify-report-hygiene.js.
//
//   splitClarityPages()  — Clarity's "top pages" counted visits to Vercel
//                          preview addresses (measured 2026-11-09: 7 of 34
//                          visits). Those are test builds, not visitors.
//   runScheduleLine()    — the footer said "runs every day at 9 AM EST". The
//                          cron is 14:00 UTC, and GitHub routinely starts it
//                          hours late (the email lands 20:00-00:30 Israel), so
//                          the footer now states the schedule and the real
//                          build time of this report.

// ⚠️ Keep in step with the cron in .github/workflows/daily-website-audit.yml.
// The verifier fails if the two drift apart.
export const SCHEDULED_UTC = '14:00';

/** True for a page on the live site (www or apex doryangel.com). */
export function isLiveSitePage(url) {
  const m = String(url || '').match(/^(?:https?:\/\/)?([^/?#:]+)/i);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === 'www.doryangel.com' || host === 'doryangel.com';
}

/**
 * Splits Clarity's popular pages into live-site pages and everything else
 * (Vercel previews, localhost, GitHub Pages copies).
 * @param pages [{ url, visits }]
 * @returns { live: [...], excluded: [...], excludedVisits: number }
 */
export function splitClarityPages(pages) {
  const live = [], excluded = [];
  for (const p of pages || []) (isLiveSitePage(p?.url) ? live : excluded).push(p);
  const excludedVisits = excluded.reduce((s, p) => s + (Number(p?.visits) || 0), 0);
  return { live, excluded, excludedVisits };
}

function fmt(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replace(',', '');
}

/** The footer line: the real schedule, and when THIS report was built. */
export function runScheduleLine(now = new Date()) {
  return `Runs once a day, scheduled for ${SCHEDULED_UTC} UTC; GitHub often starts it hours late. `
    + `This report was built ${fmt(now, 'America/New_York')} New York · ${fmt(now, 'Asia/Jerusalem')} Israel.`;
}
