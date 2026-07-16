// scripts/seo/audit.js  —  Arlo SEO suite ENTRY COMMAND (READ-ONLY)
//
// Runs the five data sub-skills in sequence, then the reporter, and writes a
// single dated report to reports/seo/YYYY-MM-DD.md.
//
//   npm run seo:audit            # full audit
//   node scripts/seo/audit.js    # same
//
// Trigger-agnostic: this is a plain Node entry point. Run it by hand today, or
// wrap it later with n8n or a GitHub Actions cron — no code change needed.
// A DISABLED weekly-cron example lives at .github/workflows/seo-audit.yml.disabled.
//
// READ-ONLY: reads the live site (or the checked-out build) + read-only APIs,
// and only ever writes a report file under reports/seo/. It never edits,
// publishes, or deploys the site.

import { run as technical } from './technical-audit.js';
import { run as gsc } from './gsc-quickwins.js';
import { run as traffic } from './traffic-report.js';
import { run as nap } from './local-nap.js';
import { run as contentGap } from './content-gap.js';
import { writeReport } from './reporter.js';

const SUB_SKILLS = [
  ['technical-audit', technical],
  ['gsc-quickwins', gsc],
  ['traffic-report', traffic],
  ['local-nap', nap],
  ['content-gap', contentGap],
];

export async function runAudit() {
  const results = [];
  for (const [name, fn] of SUB_SKILLS) {
    const started = Date.now();
    let res;
    try { res = await fn(); }
    catch (err) { res = { skill: name, status: 'error', note: `uncaught: ${err.message}` }; }
    const ms = Date.now() - started;
    const badge = res.status === 'ok' ? 'ok' : res.status === 'skipped' ? 'skipped' : 'ERROR';
    console.error(`[seo] ${name.padEnd(16)} ${badge.padEnd(8)} ${ms}ms${res.note ? ' — ' + res.note : ''}`);
    results.push(res);
  }
  const out = writeReport(results);
  console.error(`[seo] report written → ${out.path}${out.diffedAgainst ? ` (diffed vs ${out.diffedAgainst})` : ''}`);
  return { results, ...out };
}

// Run when invoked directly.
import { fileURLToPath } from 'url';
import { resolve } from 'path';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAudit()
    .then(out => {
      // Print the paste-ready row to stdout for easy piping.
      console.log(out.tsvRow);
    })
    .catch(err => { console.error('[seo] fatal:', err.message); process.exit(1); });
}
